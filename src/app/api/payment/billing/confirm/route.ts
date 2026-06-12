import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { chargeWithBillingKey } from '@/payment/lib/billing-client'
import {
  findPaymentById,
  markPaymentPaid,
  markPaymentFailed,
  activateUserPlan,
  createBillingKey,
  hasAnyBillingKeyHistory,
  markPaymentTrialActivated,
} from '@/payment/lib/repository'
import { PLANS } from '@/payment/lib/plans'
import type { PlanId } from '@/payment/lib/plans'
import { sendCAPIEvent } from '@/dev/lib/meta-capi'
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
      // BUG-06: activateUserPlan이 이전에 실패했을 수 있으므로 재시도 (멱등 safe)
      await activateUserPlan({ userId: dbPayment.user_id, plan: dbPayment.plan, expiresAt })
        .catch(err => console.error('[billing/confirm] 멱등 activateUserPlan 재시도 실패:', err, { paymentId }))
      return NextResponse.json({ success: true, plan: dbPayment.plan, expiresAt })
    }

    // BUG-02: 유효하지 않은 plan ID 방어 (DB 오염·마이그레이션 오류 대비)
    const plan = PLANS[dbPayment.plan as PlanId]
    if (!plan) {
      await markPaymentFailed(paymentId, `알 수 없는 플랜: ${dbPayment.plan}`)
      return NextResponse.json({ error: `처리할 수 없는 플랜입니다: ${dbPayment.plan}` }, { status: 400 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('phone')
      .eq('id', dbPayment.user_id)
      .single()

    const customerId = dbPayment.user_id.replace(/-/g, '').slice(0, 20)

    // 무료 체험 자격: 빌링키 이력이 0건인 신규 가입자
    const isTrialEligible = !(await hasAnyBillingKeyHistory(dbPayment.user_id))

    let paidAt: string
    let expiresAt: string
    let chargeResult: Awaited<ReturnType<typeof chargeWithBillingKey>> | null = null

    if (isTrialEligible) {
      // 신규 가입자: 첫 달 가격은 plan.trialPrice 로 결정
      //  - trialAmount === 0 (베이직/스탠다드): 0원 무료 체험 (PortOne 호출 없음)
      //  - trialAmount  > 0 (프로): 첫 달 50% 할인가 실제 결제, 둘째 달부터 정상가
      const trialAmount = plan.trialPrice ?? 0

      if (trialAmount > 0) {
        // 프로: 첫 달 50% 할인가 실제 결제 (기존 회원 분기와 동일 패턴)
        try {
          chargeResult = await chargeWithBillingKey({
            paymentId,
            billingKey,
            orderName: `닥터포스트 ${plan.name} 플랜 1개월 (첫 달 50% 할인)`,
            amount: trialAmount,
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

        paidAt = chargeResult.paidAt ?? new Date().toISOString()
        expiresAt = addOneMonth(paidAt)

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

        await activateUserPlan({
          userId: dbPayment.user_id,
          plan: dbPayment.plan,
          expiresAt,
        })

        // 빌링키 저장 (next_billing_at=30일 후 둘째 달 = cron이 정상가 청구)
        // trial_until 미설정: 무료체험이 아니라 할인 결제이므로
        await createBillingKey({
          userId: dbPayment.user_id,
          billingKey,
          plan: dbPayment.plan,
          cardName: chargeResult.cardName,
          cardLast4: null,
          nextBillingAt: expiresAt,
        })
      } else {
        // 베이직/스탠다드: PortOne 결제 호출 없이 빌링키만 발급 + 30일 후 첫 정상 결제
        paidAt = new Date().toISOString()
        expiresAt = addOneMonth(paidAt)

        // 결제 레코드를 0원 PAID로 갱신 (회계 추적)
        await markPaymentTrialActivated({ paymentId, paidAt })

        // 플랜 활성화 (30일 무료 이용 가능)
        await activateUserPlan({
          userId: dbPayment.user_id,
          plan: dbPayment.plan,
          expiresAt,
        })

        // 빌링키 저장 (trial_until=30일 후, next_billing_at=30일 후 첫 정상 결제일)
        await createBillingKey({
          userId: dbPayment.user_id,
          billingKey,
          plan: dbPayment.plan,
          cardName: null,
          cardLast4: null,
          nextBillingAt: expiresAt,
          trialUntil: expiresAt,
        })
      }
    } else {
      // 기존 회원 (해지 후 재구독 등): 기존 즉시 결제 흐름 유지
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

      paidAt = chargeResult.paidAt ?? new Date().toISOString()
      expiresAt = addOneMonth(paidAt)

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

      await activateUserPlan({
        userId: dbPayment.user_id,
        plan: dbPayment.plan,
        expiresAt,
      })

      await createBillingKey({
        userId: dbPayment.user_id,
        billingKey,
        plan: dbPayment.plan,
        cardName: chargeResult.cardName,
        cardLast4: null,
        nextBillingAt: expiresAt,
      })
    }

    // Meta CAPI
    const headersList = await headers()
    sendCAPIEvent({
      eventName: 'Subscribe',
      eventSourceUrl: 'https://www.hospitalblog.kr/pricing',
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

    return NextResponse.json({
      success: true,
      plan: dbPayment.plan,
      expiresAt,
      trial: isTrialEligible,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '결제 처리 실패'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
