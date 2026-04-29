import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { PLANS, PAID_PLAN_IDS } from '@/lib/payment/plans'
import { createPendingPayment } from '@/lib/payment/repository'
import type { PlanId } from '@/lib/payment/plans'

const CHANNEL_KEYS: Record<string, string | undefined> = {
  CARD:     process.env.PORTONE_CHANNEL_KEY_GALAXIA,
  MOBILE:   process.env.PORTONE_CHANNEL_KEY_DANAL,
  KAKAOPAY: process.env.PORTONE_CHANNEL_KEY_KAKAOPAY,
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } },
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const body = await req.json()
    const plan = body.plan as PlanId
    const paymentMethod: string = body.paymentMethod ?? 'CARD'

    if (!PAID_PLAN_IDS.includes(plan)) {
      return NextResponse.json({ error: '유효하지 않은 플랜입니다' }, { status: 400 })
    }

    const channelKey = CHANNEL_KEYS[paymentMethod]
    if (!channelKey) {
      return NextResponse.json(
        { error: `결제 채널키 미설정: ${paymentMethod}` },
        { status: 500 },
      )
    }

    const planInfo = PLANS[plan]
    const paymentId = randomUUID()

    await createPendingPayment({
      id: paymentId,
      userId: user.id,
      plan,
      amount: planInfo.price,
    })

    return NextResponse.json({
      paymentId,
      amount: planInfo.price,
      orderName: `hospitalblog.kr ${planInfo.name} 플랜 1개월`,
      channelKey,
      customer: { email: user.email ?? '' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
