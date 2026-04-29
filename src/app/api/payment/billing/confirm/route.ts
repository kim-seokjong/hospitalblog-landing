import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { verifyBillingAndActivate } from '@/lib/payment/billing-verify'
import { PLANS } from '@/lib/payment/plans'
import { sendCAPIEvent } from '@/lib/meta-capi'
import { headers } from 'next/headers'

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
    const { paymentId, billingKey } = body

    if (!paymentId || typeof paymentId !== 'string') {
      return NextResponse.json({ error: 'paymentId가 필요합니다' }, { status: 400 })
    }
    if (!billingKey || typeof billingKey !== 'string') {
      return NextResponse.json({ error: 'billingKey가 필요합니다' }, { status: 400 })
    }

    const result = await verifyBillingAndActivate({ paymentId, billingKey })

    const headersList = await headers()
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
    }).catch(err => console.error('[CAPI] Subscribe(billing) event failed:', err))

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '결제 검증 실패'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
