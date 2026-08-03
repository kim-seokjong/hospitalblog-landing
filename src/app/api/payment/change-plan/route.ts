import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { chargeWithBillingKey } from '@/payment/lib/billing-client'
import {
  getProfile,
  getActiveBillingKey,
  createPendingPayment,
  findRecentPaidUpgrade,
  hasRecentPendingPayment,
  markPaymentPaid,
  markPaymentFailed,
  setUserPlanKeepUsage,
  updateActiveBillingKeyPlan,
} from '@/payment/lib/repository'
import { PLANS, isUpgrade, isCarePlanId, proratedUpgradeCharge } from '@/payment/lib/plans'
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

    /**
     * 반쯤 끝난 유료 전환을 **먼저** 이어서 끝낸다.
     *
     * ⚠️ 이 검사는 반드시 `isUpgrade()` 앞에 있어야 한다 (2026-08-03 3라운드 지적).
     *    차액 승인 후 `profiles` 는 바뀌고 `billing_keys` 갱신이 실패한 상태에서는
     *    프로필이 이미 목표 플랜이라 `isUpgrade()` 가 먼저 거부해 버린다 —
     *    복구 코드가 뒤에 있으면 **영영 도달하지 못하고** 빌링키가 옛 플랜에 묶인 채
     *    다음 정기결제가 옛 금액으로 돈다.
     *
     * 여기서 하는 일은 재청구가 아니라 **후처리 재개**다(돈은 이미 받았다).
     */
    if (currentPlanId === target && billingKey && billingKey.plan !== target) {
      const priorPaid = await findRecentPaidUpgrade(user.id, target)
      if (priorPaid.state === 'unknown') {
        // 일시 장애를 "업그레이드 불가"(400)로 뭉개면 원인을 알 수 없다.
        return NextResponse.json(
          { error: '결제 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
          { status: 409 },
        )
      }
      if (priorPaid.state === 'found') {
        console.warn(`[change-plan] 반쯤 끝난 전환 복구 — 빌링키 플랜 정합화 (user=${user.id})`)
        await updateActiveBillingKeyPlan(user.id, target)
        return NextResponse.json({
          success: true,
          plan: target,
          charged: 0,
          trial: false,
          recovered: true,
        })
      }
    }

    if (!isUpgrade(currentPlanId, target)) {
      return NextResponse.json(
        { error: '해당 플랜으로는 업그레이드할 수 없습니다' },
        { status: 400 },
      )
    }

    // 케어 플랜 전환 = 특약(약관 제8조의2) 동의 필수. 무료체험 0원 전환 경로도
    // 이 지점을 지나므로 "결제 시 동의 간주"가 성립하지 않는 경우까지 커버된다.
    if (isCarePlanId(target) && body?.careTermsAgreed !== true) {
      return NextResponse.json(
        { error: '케어 플랜 전환에는 계정 위임·발행 대행 특약(이용약관 제8조의2) 동의가 필요합니다' },
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

    /**
     * 플랜 전환의 두 갱신은 원자적이지 않다 — **돈이 오갔는지에 따라 순서를 바꾼다.**
     *
     * 중간에 실패하면 둘 중 하나가 남는데, 어느 쪽이 덜 나쁜지가 경로마다 다르다.
     *
     * ① 돈이 안 오간 경로(체험·차액 0원): `billing_keys` → `profiles` 순.
     *    프로필이 옛 플랜으로 남으므로 **재시도가 `isUpgrade()` 를 그대로 통과**한다.
     *    빌링키 갱신은 멱등이라 두 번 돌아도 무해하다. 잃을 돈이 없으니 재시도가 답이다.
     *
     * ② 돈이 오간 경로(차액 결제): `profiles` → `billing_keys` 순.
     *    여기서 재시도를 열어주면 **이미 승인된 차액이 한 번 더 청구**된다
     *    (2026-08-03 교차검증 2라운드 지적). 프로필을 먼저 바꿔 재시도를
     *    `isUpgrade()` 에서 막고, 남은 빌링키 불일치는 로그로 수동 정합화한다.
     *    ①의 순서를 유료 경로에 그대로 쓰면 안 되는 이유가 이것이다.
     */
    const applyPlanChangeUnpaid = async () => {
      await updateActiveBillingKeyPlan(user.id, target)
      await setUserPlanKeepUsage(user.id, target, existingExpiresAt)
    }
    const applyPlanChangePaid = async () => {
      await setUserPlanKeepUsage(user.id, target, existingExpiresAt)
      await updateActiveBillingKeyPlan(user.id, target)
    }

    // ── 무료체험 중: 결제 없이 즉시 전환 ──
    if (isTrialNow(billingKey.trial_until)) {
      await applyPlanChangeUnpaid()
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
      await applyPlanChangeUnpaid()
      return NextResponse.json({ success: true, plan: target, charged: 0, trial: false })
    }

    /**
     * 이미 이 플랜으로 승인된 차액이 있으면 **다시 받지 않고 후처리만 이어서 끝낸다.**
     *
     * 차액 승인 성공 후 DB 후처리가 실패한 상태에서 사용자가 다시 시도하는 경우다.
     * 돈은 이미 받았으므로 여기서 또 청구하면 그게 이중청구다.
     */
    const alreadyPaid = await findRecentPaidUpgrade(user.id, target)
    if (alreadyPaid.state === 'unknown') {
      // 이미 받은 돈이 있는지 확인을 못 했다 — 여기서 승인하면 이중청구가 될 수 있다.
      return NextResponse.json(
        { error: '결제 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 409 },
      )
    }
    if (alreadyPaid.state === 'found') {
      console.warn(
        `[change-plan] 승인된 차액 발견 — 재청구 없이 후처리만 재개 ` +
          `(user=${user.id}, payment=${alreadyPaid.id})`,
      )
      await applyPlanChangePaid()
      return NextResponse.json({
        success: true,
        plan: target,
        charged: 0,
        trial: false,
        recovered: true,
      })
    }

    /**
     * 같은 회원의 같은 플랜 결제가 아직 진행 중이면 새로 승인하지 않는다.
     *
     * 더블클릭·탭 두 개·네트워크 재시도로 같은 차액이 두 번 승인되는 것을 막는다.
     * (완전한 잠금이 아닌 이유는 `hasRecentPendingPayment` 주석 참조.)
     */
    const pendingState = await hasRecentPendingPayment(user.id, target)
    if (pendingState !== 'no') {
      return NextResponse.json(
        {
          error:
            pendingState === 'yes'
              ? '이전 결제가 아직 처리 중입니다. 잠시 후 마이페이지에서 결과를 확인해 주세요. (중복 결제 방지)'
              : '결제 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        },
        { status: 409 },
      )
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
    await applyPlanChangePaid()

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
