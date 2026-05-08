import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { PLANS, PAID_PLAN_IDS } from '@/lib/payment/plans'
import { createPendingPayment } from '@/lib/payment/repository'
import type { PlanId } from '@/lib/payment/plans'

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

    if (!PAID_PLAN_IDS.includes(plan)) {
      return NextResponse.json({ error: '유효하지 않은 플랜입니다' }, { status: 400 })
    }

    const channelKey = process.env.PORTONE_CHANNEL_KEY_KPN_BILLING
    if (!channelKey) {
      return NextResponse.json(
        { error: 'PORTONE_CHANNEL_KEY_KPN_BILLING 환경변수 미설정' },
        { status: 500 },
      )
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('id', user.id)
      .single()

    const fullName = profile?.full_name?.trim()
      || (user.email ? user.email.split('@')[0] : null)
      || '구매자'

    const planInfo = PLANS[plan]
    const paymentId = randomUUID().replace(/-/g, '')

    await createPendingPayment({
      id: paymentId,
      userId: user.id,
      plan,
      amount: planInfo.price,
    })

    const customerId = user.id.replace(/-/g, '').slice(0, 20)

    return NextResponse.json({
      paymentId,
      amount: planInfo.price,
      orderName: `닥터포스트 ${planInfo.name} 플랜 자동갱신 구독`,
      channelKey,
      customer: {
        customerId,
        email: user.email ?? '',
        fullName,
        phoneNumber: profile?.phone ?? undefined,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
