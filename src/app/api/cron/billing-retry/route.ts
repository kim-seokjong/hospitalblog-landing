// 매일 실행 — 1차 실패 후 3일 경과 사용자 자동 재시도
// 성공 시: 정상 활성화 + 성공 메일, failure_count=0
// 실패 시: failure_count=2, 재시도 실패 메일 (4일 후 자동 해지 예고)

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { findKeysForRetry, recordChargeAttempt } from '@/lib/payment/dunning-repository'
import {
  getProfile,
  createPendingPayment,
  markPaymentPaid,
  markPaymentFailed,
  activateUserPlan,
} from '@/lib/payment/repository'
import { chargeWithBillingKey } from '@/lib/payment/billing-client'
import { PLANS, PAID_PLAN_IDS, type PlanId } from '@/lib/payment/plans'
import { sendEmail } from '@/lib/email/client'
import { paymentSuccessEmail, paymentRetryFailedEmail } from '@/lib/email/templates'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function addMonths(iso: string, months: number): string {
  const d = new Date(iso)
  d.setMonth(d.getMonth() + months)
  return d.toISOString()
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  let processed = 0
  let succeeded = 0
  let failed = 0
  const failures: Array<{ billingKeyId: string; reason: string }> = []

  try {
    const keys = await findKeysForRetry(now)

    for (const bk of keys) {
      processed++
      const planId = bk.plan as PlanId
      if (!PAID_PLAN_IDS.includes(planId)) {
        failures.push({ billingKeyId: bk.id, reason: 'invalid_plan' })
        continue
      }
      const plan = PLANS[planId]
      const profile = await getProfile(bk.user_id)
      const paymentId = randomUUID().replace(/-/g, '')

      try {
        await createPendingPayment({
          id: paymentId,
          userId: bk.user_id,
          plan: planId,
          amount: plan.price,
        })

        const customerId = bk.user_id.replace(/-/g, '').slice(0, 20)
        const result = await chargeWithBillingKey({
          paymentId,
          billingKey: bk.billing_key,
          orderName: `닥터포스트 ${plan.name} 플랜 1개월 (자동결제 재시도)`,
          amount: plan.price,
          customerId,
          customerEmail: profile?.email ?? '',
        })

        if (result.status !== 'PAID') {
          throw new Error(`결제 응답 status=${result.status}`)
        }

        const paidAt = result.paidAt ?? now.toISOString()
        const expiresAt = addMonths(paidAt, 1)

        await markPaymentPaid({
          paymentId,
          pgTxId: result.transactionId,
          pgProvider: result.pgProvider,
          paymentMethod: 'CARD',
          cardName: result.cardName,
          receiptUrl: result.receiptUrl,
          paidAt,
          rawResponse: result,
        })

        await activateUserPlan({ userId: bk.user_id, plan: planId, expiresAt })

        await recordChargeAttempt({
          billingKeyId: bk.id,
          status: 'SUCCESS',
          attemptedAt: now.toISOString(),
          resetFailureCount: true,
          nextBillingAt: expiresAt,
        })

        if (profile?.email) {
          const { subject, html } = paymentSuccessEmail({
            planName: plan.name,
            amount: plan.price,
            paidAt,
            expiresAt,
          })
          await sendEmail({ to: profile.email, subject, html })
        }

        succeeded++
      } catch (e) {
        failed++
        const reason = e instanceof Error ? e.message : '결제 실패'

        await markPaymentFailed(paymentId, reason).catch(() => {})
        await recordChargeAttempt({
          billingKeyId: bk.id,
          status: 'FAILED',
          attemptedAt: now.toISOString(),
        })

        if (profile?.email) {
          const { subject, html } = paymentRetryFailedEmail({
            planName: plan.name,
            amount: plan.price,
            reason,
            cancelDate: addDays(now.toISOString(), 4),
          })
          await sendEmail({ to: profile.email, subject, html })
        }

        failures.push({ billingKeyId: bk.id, reason })
      }
    }

    return NextResponse.json({ ok: true, processed, succeeded, failed, failures })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'cron failed'
    return NextResponse.json(
      { ok: false, error: msg, processed, succeeded, failed, failures },
      { status: 500 }
    )
  }
}
