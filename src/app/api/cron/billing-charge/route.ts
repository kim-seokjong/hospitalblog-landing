// 매일 실행 — 오늘이 결제일인 ACTIVE 빌링키 일괄 자동결제
// 성공 시: profiles.plan_expires_at 갱신, next_billing_at +1개월, 성공 메일
// 실패 시: failure_count=1, 실패 메일 (3일 후 재시도 예고)

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/dev/lib/cron-auth'
import { findKeysForCharge, recordChargeAttempt } from '@/payment/lib/dunning-repository'
import {
  getProfile,
  createPendingPayment,
  markPaymentPaid,
  markPaymentFailed,
  activateUserPlan,
} from '@/payment/lib/repository'
import { chargeWithBillingKey } from '@/payment/lib/billing-client'
import { PLANS, PAID_PLAN_IDS, type PlanId } from '@/payment/lib/plans'
import { sendEmail } from '@/payment/email/client'
import { paymentSuccessEmail, paymentFailedEmail } from '@/payment/email/templates'
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
    const keys = await findKeysForCharge(now)

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
          orderName: `닥터포스트 ${plan.name} 플랜 1개월 (자동결제)`,
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
          const { subject, html } = paymentFailedEmail({
            planName: plan.name,
            amount: plan.price,
            reason,
            retryDate: addDays(now.toISOString(), 3),
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
