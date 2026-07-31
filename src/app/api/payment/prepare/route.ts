import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { PLANS, PUBLIC_PLAN_IDS, isCarePlanId } from '@/payment/lib/plans'
import { createPendingPayment } from '@/payment/lib/repository'
import type { PlanId } from '@/payment/lib/plans'

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

    // 신규 구독은 공개 판매 플랜만 허용한다. PAID_PLAN_IDS 로 검증하면
    // 판매 중단한 레거시(basic·pro·pro12_pro)를 API 직접 호출로 새로 구매할 수 있다
    // (PAID_PLAN_IDS 는 기존 구독자 enforce 용이지 판매 목록이 아니다).
    if (!PUBLIC_PLAN_IDS.includes(plan)) {
      return NextResponse.json({ error: '유효하지 않은 플랜입니다' }, { status: 400 })
    }

    // 케어 플랜 = 계정 위임·발행 대행 특약(약관 제8조의2) 동의 필수.
    // 클라이언트 체크박스만으로는 API 직접 호출을 못 막으므로 서버에서 강제한다.
    if (isCarePlanId(plan) && body.careTermsAgreed !== true) {
      return NextResponse.json(
        { error: '케어 플랜 구독에는 계정 위임·발행 대행 특약(이용약관 제8조의2) 동의가 필요합니다' },
        { status: 400 },
      )
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
