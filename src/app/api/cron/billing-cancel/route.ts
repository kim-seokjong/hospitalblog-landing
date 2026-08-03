// 매일 실행 — 재시도(failure_count>=2) 후 7일 경과한 빌링키 자동 해지
// 빌링키 CANCELLED + 해지 통지 메일

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/dev/lib/cron-auth'
import { findKeysForCancel, cancelBillingKey } from '@/payment/lib/dunning-repository'
import { getProfile } from '@/payment/lib/repository'
import { purgeExpiredCareCredentials } from '@/payment/lib/care-retention'
import { PLANS, isPaidPlanId } from '@/payment/lib/plans'
import { deleteBillingKey } from '@/payment/lib/billing-client'
import { sendEmail } from '@/payment/email/client'
import { subscriptionCancelledEmail } from '@/payment/email/templates'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  let processed = 0
  let cancelled = 0
  const failures: Array<{ billingKeyId: string; reason: string }> = []

  try {
    const keys = await findKeysForCancel(now)

    for (const bk of keys) {
      processed++
      try {
        // PG 측 빌링키도 삭제 (실패해도 DB는 해지 처리 진행)
        await deleteBillingKey(bk.billing_key).catch(() => {})

        await cancelBillingKey(bk.id)
        cancelled++

        if (isPaidPlanId(bk.plan)) {
          const plan = PLANS[bk.plan]
          const profile = await getProfile(bk.user_id)
          if (profile?.email) {
            const { subject, html } = subscriptionCancelledEmail({
              planName: plan.name,
              reason: 'PAYMENT_FAILED',
            })
            await sendEmail({ to: profile.email, subject, html, feature: 'billing-cancel' })
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'cancel failed'
        failures.push({ billingKeyId: bk.id, reason: msg })
      }
    }

    /**
     * 구독 근거가 사라진 위임 자격증명 일괄 파기 (하루 1회 스윕).
     *
     * 해지 cron 에 얹는 이유: 자연 만료(결제 없이 기간만 지난 경우)는 어떤 코드도
     * 호출되지 않아 `expireUserPlan` 훅만으로는 안 잡힌다. Vercel Hobby 는 cron 개수·
     * 빈도가 묶여 있어 새 cron 을 늘리는 대신 "구독이 끝나는 일" 을 다루는 이 cron 에 붙인다.
     */
    const purge = await purgeExpiredCareCredentials()
    if (purge.purged > 0 || purge.errors.length > 0) {
      console.warn(
        `[cron/billing-cancel] 케어 자격증명 파기: ${purge.purged}건 / 검사 ${purge.checked}건 / 보류 ${purge.skipped}건` +
          (purge.errors.length > 0 ? ` / 오류: ${purge.errors.join('; ')}` : ''),
      )
    }

    return NextResponse.json({ ok: true, processed, cancelled, failures, carePurge: purge })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'cron failed'
    return NextResponse.json(
      { ok: false, error: msg, processed, cancelled, failures },
      { status: 500 }
    )
  }
}
