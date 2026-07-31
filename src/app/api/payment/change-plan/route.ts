import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { chargeWithBillingKey } from '@/payment/lib/billing-client'
import {
  getProfile,
  getActiveBillingKey,
  createPendingPayment,
  markPaymentPaid,
  markPaymentFailed,
  setUserPlanKeepUsage,
  updateActiveBillingKeyPlan,
} from '@/payment/lib/repository'
import { PLANS, isUpgrade, proratedUpgradeCharge } from '@/payment/lib/plans'
import type { PlanId } from '@/payment/lib/plans'

function getSupabase() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
}

function isTrialNow(trialUntil: string | null | undefined): boolean {
  return !!trialUntil && new Date(trialUntil) > new Date()
}

/**
 * 업그레이드 미리보기 (결제 없음).
 * GET /api/payment/change-plan?plan=<target>
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const target = req.nextUrl.searchParams.get('plan') as PlanId | null
    if (!target || !PLANS[target]) {
      return NextResponse.json({ error: '유효하지 않은 플랜입니다' }, { status: 400 })
    }

    const [profile, billingKey] = await Promise.all([
      getProfile(user.id),
      getActiveBillingKey(user.id),
    ])

    const currentPlanId = profile?.plan
    if (!currentPlanId || !PLANS[currentPlanId]) {
      return NextResponse.json({ error: '현재 구독 플랜을 확인할 수 없습니다' }, { status: 400 })
    }

    if (!isUpgrade(currentPlanId, target)) {
      return NextResponse.json(
        { error: '해당 플랜으로는 업그레이드할 수 없습니다' },
        { status: 400 },
      )
    }

    const currentPlan = PLANS[currentPlanId]
    const targetPlan = PLANS[target]
    const trial = isTrialNow(billingKey?.trial_until)

    const now = new Date()
    const cycleStart = new Date(profile?.plan_started_at ?? now.toISOString())
    const cycleEnd = new Date(
      billingKey?.next_billing_at ?? profile?.plan_expires_at ?? now.toISOString(),
    )

    const amount = trial
      ? 0
      : proratedUpgradeCharge(currentPlan, targetPlan, now, cycleStart, cycleEnd)

    return NextResponse.json({
      amount,
      isTrial: trial,
      currentPlan: currentPlan.name,
      targetPlan: targetPlan.name,
      cardLast4: billingKey?.card_last4 ?? null,
      nextBillingAt: billingKey?.next_billing_at ?? null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * 업그레이드 실행 (기존 등록 카드로 차액 즉시 결제).
 * POST /api/payment/change-plan  body: { plan: <target> }
 *
 * 정책:
 *  - 무료체험 중: 결제 없음. plan 만 즉시 전환, trial_until/next_billing_at 유지.
 *  - 유료 구독자: 일할 차액 즉시 결제 → 성공 시에만 plan 전환. next_billing_at 불변.
 *  - 실패 시 plan 미변경. usage_count 절대 초기화하지 않음.
 */
export async function POST(req: NextRequest) {
  let pendingPaymentId: string | null = null
  // 카드 승인 완료 여부. true 가 된 뒤의 예외에서는 절대 markPaymentFailed 를 호출하지 않는다 —
  // 실승인된 결제를 FAILED 로 덮으면 사용자가 재시도해 같은 차액이 이중 청구된다.
  let cardCharged = false
  try {
    const supabase = getSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const target = body?.plan as PlanId | undefined
    if (!target || !PLANS[target]) {
      return NextResponse.json({ error: '유효하지 않은 플랜입니다' }, { status: 400 })
    }

    const [profile, billingKey] = await Promise.all([
      getProfile(user.id),
      getActiveBillingKey(user.id),
    ])

    const currentPlanId = profile?.plan
    if (!currentPlanId || !PLANS[currentPlanId]) {
      return NextResponse.json({ error: '현재 구독 플랜을 확인할 수 없습니다' }, { status: 400 })
    }

    if (!isUpgrade(currentPlanId, target)) {
      return NextResponse.json(
        { error: '해당 플랜으로는 업그레이드할 수 없습니다' },
        { status: 400 },
      )
    }

    if (!billingKey) {
      return NextResponse.json(
        { error: '등록된 결제수단이 없습니다. 요금제 페이지에서 구독해 주세요.' },
        { status: 400 },
      )
    }

    const currentPlan = PLANS[currentPlanId]
    const targetPlan = PLANS[target]
    const existingExpiresAt = profile?.plan_expires_at ?? null

    // ── 무료체험 중: 결제 없이 즉시 전환 ──
    if (isTrialNow(billingKey.trial_until)) {
      await setUserPlanKeepUsage(user.id, target, existingExpiresAt)
      await updateActiveBillingKeyPlan(user.id, target)
      return NextResponse.json({ success: true, plan: target, charged: 0, trial: true })
    }

    // ── 유료 구독자: 일할 차액 계산 ──
    const now = new Date()
    const cycleStart = new Date(profile?.plan_started_at ?? now.toISOString())
    const cycleEnd = new Date(
      billingKey.next_billing_at ?? existingExpiresAt ?? now.toISOString(),
    )
    const amount = proratedUpgradeCharge(currentPlan, targetPlan, now, cycleStart, cycleEnd)

    // 차액이 0 이하면 결제 없이 플랜만 전환
    if (amount <= 0) {
      await setUserPlanKeepUsage(user.id, target, existingExpiresAt)
      await updateActiveBillingKeyPlan(user.id, target)
      return NextResponse.json({ success: true, plan: target, charged: 0, trial: false })
    }

    // ── 차액 즉시 결제 ──
    const paymentId = randomUUID().replace(/-/g, '')
    pendingPaymentId = paymentId
    await createPendingPayment({ id: paymentId, userId: user.id, plan: target, amount })

    const { data: phoneRow } = await supabase
      .from('profiles')
      .select('phone')
      .eq('id', user.id)
      .single()

    const customerId = user.id.replace(/-/g, '').slice(0, 20)

    let chargeResult: Awaited<ReturnType<typeof chargeWithBillingKey>>
    try {
      chargeResult = await chargeWithBillingKey({
        paymentId,
        billingKey: billingKey.billing_key,
        orderName: `닥터포스트 ${targetPlan.name} 업그레이드 (차액 일할)`,
        amount,
        customerId,
        customerEmail: user.email ?? '',
        customerPhone: phoneRow?.phone ?? undefined,
      })
    } catch (e) {
      await markPaymentFailed(paymentId, e instanceof Error ? e.message : '차액 결제 실패')
      return NextResponse.json(
        { error: e instanceof Error ? e.message : '차액 결제에 실패했습니다' },
        { status: 400 },
      )
    }

    if (chargeResult.status !== 'PAID') {
      await markPaymentFailed(paymentId, `결제 상태: ${chargeResult.status}`)
      return NextResponse.json(
        { error: `결제가 완료되지 않았습니다 (상태: ${chargeResult.status})` },
        { status: 400 },
      )
    }

    cardCharged = true

    await markPaymentPaid({
      paymentId,
      pgTxId: chargeResult.transactionId,
      pgProvider: chargeResult.pgProvider,
      paymentMethod: 'CARD',
      cardName: chargeResult.cardName,
      receiptUrl: chargeResult.receiptUrl,
      paidAt: chargeResult.paidAt ?? new Date().toISOString(),
      rawResponse: chargeResult,
    })

    // 결제 성공 후에만 플랜 전환 (usage_count·next_billing_at 불변)
    await setUserPlanKeepUsage(user.id, target, existingExpiresAt)
    await updateActiveBillingKeyPlan(user.id, target)

    return NextResponse.json({ success: true, plan: target, charged: amount, trial: false })
  } catch (e) {
    // 카드 승인 후의 예외 = 돈은 나갔고 DB 후처리만 실패한 상태.
    // FAILED 로 덮지 않고(재시도 시 이중 청구), 수동 정합화가 필요함을 로그로 남긴다.
    if (cardCharged) {
      console.error(
        `[change-plan] ⚠️결제 승인 후 후처리 실패 — 수동 확인 필요 (payment=${pendingPaymentId}): ` +
          (e instanceof Error ? e.message : String(e)),
      )
      return NextResponse.json(
        {
          error:
            '결제는 완료되었으나 플랜 전환 처리 중 오류가 발생했습니다. 다시 시도하지 마시고 고객센터로 문의해 주세요.',
        },
        { status: 500 },
      )
    }
    if (pendingPaymentId) {
      await markPaymentFailed(
        pendingPaymentId,
        e instanceof Error ? e.message : '업그레이드 처리 실패',
      ).catch(() => undefined)
    }
    const msg = e instanceof Error ? e.message : '업그레이드 처리에 실패했습니다'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
