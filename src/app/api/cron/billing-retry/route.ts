// 매일 실행 — 1차 실패 후 3일 경과 사용자 자동 재시도
// 성공 시: 정상 활성화 + 성공 메일, failure_count=0
// 실패 시: failure_count=2, 재시도 실패 메일 (4일 후 자동 해지 예고)

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/dev/lib/cron-auth'
import { findKeysForRetry, recordChargeAttempt, claimRetryAttempt } from '@/payment/lib/dunning-repository'
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
import { paymentSuccessEmail, paymentRetryFailedEmail } from '@/payment/email/templates'
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

      // 이중청구 방어①: 재시도 직전 원자적 선점. 동시/중복 실행 시 한 쪽만 진행.
      let claimed = false
      try {
        claimed = await claimRetryAttempt(bk.id, now)
      } catch (e) {
        failures.push({ billingKeyId: bk.id, reason: e instanceof Error ? e.message : 'claim 실패' })
        continue
      }
      if (!claimed) continue

      const profile = await getProfile(bk.user_id)
      const paymentId = randomUUID().replace(/-/g, '')
      let charged = false
      let chargeResult: Awaited<ReturnType<typeof chargeWithBillingKey>> | null = null

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
        chargeResult = result

        if (result.status !== 'PAID') {
          throw new Error(`결제 응답 status=${result.status}`)
        }
        charged = true // 이 지점 이후 오류는 "과금 성공/후처리 실패" → 절대 FAILED·재청구 금지

        const paidAt = result.paidAt ?? now.toISOString()
        const expiresAt = addMonths(paidAt, 1)

        // 이중청구 방어②: 결제 PAID 확정 + next_billing 먼저 전진 → 활성화 순.
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

        await recordChargeAttempt({
          billingKeyId: bk.id,
          status: 'SUCCESS',
          attemptedAt: now.toISOString(),
          resetFailureCount: true,
          nextBillingAt: expiresAt,
        })

        await activateUserPlan({ userId: bk.user_id, plan: planId, expiresAt })

        if (profile?.email) {
          const { subject, html } = paymentSuccessEmail({
            planName: plan.name,
            amount: plan.price,
            paidAt,
            expiresAt,
          })
          await sendEmail({ to: profile.email, subject, html, feature: 'billing-retry' }).catch(() => {})
        }

        succeeded++
      } catch (e) {
        const reason = e instanceof Error ? e.message : '결제 실패'

        if (charged && chargeResult) {
          // 이중청구 방어③: 카드 이미 결제됨 → FAILED 금지. 실제 결과로 best-effort 재정합화 + 크리티컬 로그.
          const paidAt = chargeResult.paidAt ?? now.toISOString()
          const expiresAt = addMonths(paidAt, 1)
          await markPaymentPaid({
            paymentId,
            pgTxId: chargeResult.transactionId,
            pgProvider: chargeResult.pgProvider,
            paymentMethod: 'CARD',
            cardName: chargeResult.cardName,
            receiptUrl: chargeResult.receiptUrl,
            paidAt,
            rawResponse: chargeResult,
          }).catch(() => {})
          await recordChargeAttempt({
            billingKeyId: bk.id, status: 'SUCCESS', attemptedAt: now.toISOString(),
            resetFailureCount: true, nextBillingAt: expiresAt,
          }).catch(() => {})
          await activateUserPlan({ userId: bk.user_id, plan: planId, expiresAt }).catch(() => {})
          console.error('[billing-retry] CRITICAL 과금성공/후처리실패 — 수동확인 필요', { paymentId, billingKeyId: bk.id, userId: bk.user_id, reason })
          succeeded++
          continue
        }

        failed++
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
          await sendEmail({ to: profile.email, subject, html, feature: 'billing-retry' }).catch(() => {})
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
