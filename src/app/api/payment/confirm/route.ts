import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { verifyAndActivate } from '@/lib/payment/verify'
import { findPaymentById } from '@/lib/payment/repository'
import { PLANS } from '@/lib/payment/plans'
import { sendCAPIEvent } from '@/lib/meta-capi'

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

    const { paymentId } = await req.json()
    if (!paymentId || typeof paymentId !== 'string') {
      return NextResponse.json({ error: 'paymentId가 필요합니다' }, { status: 400 })
    }

    const dbPayment = await findPaymentById(paymentId)
    if (!dbPayment) {
      return NextResponse.json({ error: '결제 레코드를 찾을 수 없습니다' }, { status: 404 })
    }
    if (dbPayment.user_id !== user.id) {
      return NextResponse.json({ error: '결제 권한이 없습니다' }, { status: 403 })
    }

    const result = await verifyAndActivate(paymentId)

    // CAPI: Subscribe 이벤트 서버사이드 전송
    const headersList = await headers();
    sendCAPIEvent({
      eventName: 'Subscribe',
      eventSourceUrl: 'https://hospitalblog.kr/pricing',
      userData: {
        clientIpAddress: headersList.get('x-forwarded-for') || headersList.get('x-real-ip') || '',
        clientUserAgent: headersList.get('user-agent') || '',
      },
      customData: {
        currency: 'KRW',
        value: PLANS[result.plan].price,
        predicted_ltv: PLANS[result.plan].price * 12,
      },
    }).catch(err => console.error('[CAPI] Subscribe event failed:', err));

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '결제 검증 실패'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
