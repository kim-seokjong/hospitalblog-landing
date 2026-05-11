import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { chargeWithBillingKey } from '@/lib/payment/billing-client'
import {
  findPaymentById,
  markPaymentPaid,
  markPaymentFailed,
  activateUserPlan,
  createBillingKey,
} from '@/lib/payment/repository'
import { PLANS } from '@/lib/payment/plans'
import type { PlanId } from '@/lib/payment/plans'
import { sendCAPIEvent } from '@/lib/meta-capi'
import { headers } from 'next/headers'

function addOneMonth(isoDate: string): string {
  const d = new Date(isoDate)
  d.setMonth(d.getMonth() + 1)
  return d.toISOString()
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
    const { paymentId, billingKey } = body

    if (!paymentId || typeof paymentId !== 'string') {
      return NextResponse.json({ error: 'paymentId가 필요합니다' }, { status: 400 })
    }
    if (!billingKey || typeof billingKey !== 'string') {
      return NextResponse.json({ error: 'billingKey가 필요합니다' }, { status: 400 })
    }

    // 1. DB에서 결제 레코드 확인
    const dbPayment = await findPaymentById(paymentId)
    if (!dbPayment) {
      return NextResponse.json({ error: '결제 레코드를 찾을 수 없습니다' }, { status: 404 })
    }

    if (dbPayment.user_id !== user.id) {
      return NextResponse.json({ error: '결제 권한이 없습니다' }, { status: 403 })
    }

    // 멱등 처리: 이미 완료된 결제
    if (dbPayment.status === 'PAID') {
      const expiresAt = addOneMonth(dbPayment.paid_at ?? new Date().toISOString())
      return NextResponse.json({ success: true, plan: dbPayment.plan, expiresAt })
    }

    const plan = PLANS[dbPayment.plan as PlanId]

    const { data: profile } = await supabase
      .from('profiles')
      .select('phone')
      .eq('id', dbPayment.user_id)
      .single()

    const customerId = dbPayment.user_id.replace(/-/g, '').slice(0, 20)

    // 2. 빌링키로 첫 결제 (서버에서 직접 실행)
    let chargeResult
    try {
      chargeResult = await chargeWithBillingKey({
        paymentId,
        billingKey,
        orderName: `닥터포스트 ${plan.name} 플랜 1개월`,
        amount: plan.price,
        customerId,
        customerEmail: user.email ?? '',
        customerPhone: profile?.phone ?? undefined,
      })
    } catch (e) {
      await markPaymentFailed(paymentId, e instanceof Error ? e.message : '빌링키 결제 실패')
      throw e
    }

    if (chargeResult.status !== 'PAID') {
      await markPaymentFailed(paymentId, `결제 상태: ${chargeResult.status}`)
      return NextResponse.json(
        { error: `결제가 완료되지 않았습니다 (상태: ${chargeResult.status})` },
        { status: 400 },
      )
    }

    const paidAt = chargeResult.paidAt ?? new Date().toISOString()
    const expiresAt = addOneMonth(paidAt)

    // 3. 결제 완료 기록
    await markPaymentPaid({
      paymentId,
      pgTxId: chargeResult.transactionId,
      pgProvider: chargeResult.pgProvider,
      paymentMethod: 'CARD',
      cardName: chargeResult.cardName,
      receiptUrl: chargeResult.receiptUrl,
      paidAt,
      rawResponse: chargeResult,
    })

    // 4. 플랜 활성화
    await activateUserPlan({
      userId: dbPayment.user_id,
      plan: dbPayment.plan,
      expiresAt,
    })

    // 5. 빌링키 저장
    await createBillingKey({
      userId: dbPayment.user_id,
      billingKey,
      plan: dbPayment.plan,
      cardName: chargeResult.cardName,
      cardLast4: null,
      nextBillingAt: expiresAt,
    })

    // Meta CAPI
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
        value: plan.price,
        predicted_ltv: plan.price * 12,
      },
    }).catch(err => console.error('[CAPI] Subscribe(billing) event failed:', err))

    return NextResponse.json({ success: true, plan: dbPayment.plan, expiresAt })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '결제 처리 실패'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
