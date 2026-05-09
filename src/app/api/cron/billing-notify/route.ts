// 매일 실행 — 결제 7일 후 예정인 사용자에게 사전고지 메일 발송
// 방통위 자동결제 가이드라인 의무 사항

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { findKeysForBillingNotify, markNotifySent } from '@/lib/payment/dunning-repository'
import { getProfile } from '@/lib/payment/repository'
import { PLANS, isPaidPlanId } from '@/lib/payment/plans'
import { sendEmail } from '@/lib/email/client'
import { billingNotifyEmail } from '@/lib/email/templates'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  let processed = 0
  let sent = 0
  const failures: Array<{ billingKeyId: string; reason: string }> = []

  try {
    const keys = await findKeysForBillingNotify(now)

    for (const bk of keys) {
      processed++
      try {
        if (!isPaidPlanId(bk.plan)) continue
        const plan = PLANS[bk.plan]
        const profile = await getProfile(bk.user_id)
        if (!profile?.email) {
          failures.push({ billingKeyId: bk.id, reason: 'no_email' })
          continue
        }
        if (!bk.next_billing_at) continue

        const { subject, html } = billingNotifyEmail({
          planName: plan.name,
          amount: plan.price,
          nextBillingAt: bk.next_billing_at,
          cardLast4: bk.card_last4,
        })

        const result = await sendEmail({ to: profile.email, subject, html })
        if (!result.success) {
          failures.push({ billingKeyId: bk.id, reason: result.error ?? 'send_failed' })
          continue
        }

        await markNotifySent(bk.id, now.toISOString())
        sent++
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown'
        failures.push({ billingKeyId: bk.id, reason: msg })
      }
    }

    return NextResponse.json({ ok: true, processed, sent, failures })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'cron failed'
    return NextResponse.json({ ok: false, error: msg, processed, sent, failures }, { status: 500 })
  }
}
