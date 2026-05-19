// 매일 실행 — 재시도(failure_count>=2) 후 7일 경과한 빌링키 자동 해지
// 빌링키 CANCELLED + 해지 통지 메일

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/dev/lib/cron-auth'
import { findKeysForCancel, cancelBillingKey } from '@/payment/lib/dunning-repository'
import { getProfile } from '@/payment/lib/repository'
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
            await sendEmail({ to: profile.email, subject, html })
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'cancel failed'
        failures.push({ billingKeyId: bk.id, reason: msg })
      }
    }

    return NextResponse.json({ ok: true, processed, cancelled, failures })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'cron failed'
    return NextResponse.json(
      { ok: false, error: msg, processed, cancelled, failures },
      { status: 500 }
    )
  }
}
