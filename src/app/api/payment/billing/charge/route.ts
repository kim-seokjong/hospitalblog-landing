// 월 자동 청구 엔드포인트 — 외부 스케줄러(cron)에서 호출
// x-charge-secret 헤더로 인증
import { NextRequest, NextResponse } from 'next/server'
import { chargeWithBillingKey } from '@/lib/payment/billing-client'
import {
  getActiveBillingKey,
  activateUserPlan,
  createPendingPayment,
  getProfile,
} from '@/lib/payment/repository'
import { PLANS, PAID_PLAN_IDS } from '@/lib/payment/plans'
import type { PlanId } from '@/lib/payment/plans'
import { randomUUID } from 'crypto'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-charge-secret')
  if (!secret || secret !== process.env.PORTONE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401 })
  }

  try {
    const { userId } = await req.json()
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId가 필요합니다' }, { status: 400 })
    }

    const bk = await getActiveBillingKey(userId)
    if (!bk) {
      return NextResponse.json({ error: '활성 빌링키가 없습니다' }, { status: 404 })
    }

    if (!PAID_PLAN_IDS.includes(bk.plan as PlanId)) {
      return NextResponse.json({ error: '유효하지 않은 플랜입니다' }, { status: 400 })
    }

    const profile = await getProfile(userId)
    const plan = PLANS[bk.plan as PlanId]
    const paymentId = randomUUID()

    await createPendingPayment({
      id: paymentId,
      userId,
      plan: bk.plan as PlanId,
      amount: plan.price,
    })

    const result = await chargeWithBillingKey({
      paymentId,
      billingKey: bk.billing_key,
      orderName: `hospitalblog.kr ${plan.name} 플랜 1개월`,
      amount: plan.price,
      customerEmail: profile?.email ?? '',
    })

    if (result.status !== 'PAID') {
      return NextResponse.json({ error: `결제 실패: ${result.status}` }, { status: 400 })
    }

    const expiresAt = addOneMonth(result.paidAt ?? new Date().toISOString())
    await activateUserPlan({ userId, plan: bk.plan as PlanId, expiresAt })

    return NextResponse.json({ success: true, paymentId, expiresAt })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '자동 청구 실패'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function addOneMonth(isoDate: string): string {
  const d = new Date(isoDate)
  d.setMonth(d.getMonth() + 1)
  return d.toISOString()
}
