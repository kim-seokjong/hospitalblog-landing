import { createClient } from '@supabase/supabase-js'
import { provisionClinicSite } from '@/content/lib/clinic-site/provision'
import type { ProvisionOutcome } from '@/content/lib/clinic-site/provision'
import { purgeCareCredentials } from './care-retention'
import type { Payment, PaymentStatus, Profile, BillingKey } from './types'
import type { PlanId } from './plans'

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function createPendingPayment(params: {
  id: string
  userId: string
  plan: PlanId
  amount: number
}): Promise<void> {
  const { error } = await getAdmin()
    .from('payments')
    .insert({
      id: params.id,
      user_id: params.userId,
      plan: params.plan,
      amount: params.amount,
      status: 'PENDING',
    })
  if (error) throw new Error(`결제 레코드 생성 실패: ${error.message}`)
}

/**
 * 이 회원에게 아직 결말이 안 난 결제가 있는가.
 *
 * ★ 왜 있는가 (2026-08-03 주간점검 교차검증).
 *   플랜 변경은 "현재 플랜 읽기 → 차액 계산 → 카드 승인" 을 잠금 없이 돈다.
 *   버튼 두 번 클릭·탭 두 개·네트워크 재시도로 요청이 거의 동시에 도착하면
 *   **둘 다 검사를 통과해 같은 차액이 두 번 승인**된다. 결제 레코드는 요청마다
 *   새 UUID 라 서로를 못 본다.
 *
 * ⚠️ 이것은 완전한 잠금이 아니다. 두 요청이 밀리초 단위로 겹치면 둘 다 "없음" 을
 *    볼 수 있다(TOCTOU). 진짜 해결은 DB 유니크 제약이나 advisory lock 이고 그건
 *    마이그레이션이 필요하다(Supabase SQL Editor 수동 적용). 그때까지 **실제로
 *    일어나는 사고(더블클릭·재시도)의 창을 없애는** 값싼 방어로 둔다.
 */
export async function hasRecentPendingPayment(
  userId: string,
  plan: PlanId,
  withinMs: number = 90 * 1000,
): Promise<'yes' | 'no' | 'unknown'> {
  const since = new Date(Date.now() - withinMs).toISOString()
  const { data, error } = await getAdmin()
    .from('payments')
    .select('id')
    .eq('user_id', userId)
    // 같은 플랜의 진행 중 결제만 본다 — 다른 플랜의 버려진 체크아웃까지 막으면
    // 정상 전환이 이유 없이 거부된다.
    .eq('plan', plan)
    .eq('status', 'PENDING')
    .gte('created_at', since)
    .limit(1)
  /**
   * ⚠️ 확인을 못 하면 **막는다**(fail-closed). 2026-08-03 3라운드에서 판단을 뒤집었다.
   *    처음엔 "조회 실패로 정상 결제를 거부하면 매출이 죽는다" 며 통과시켰는데,
   *    바로 다음 `createPendingPayment()` 가 **같은 DB** 를 타므로 조회가 죽은
   *    상황에서 통과시켜 봐야 결제는 어차피 안 된다 — 지킬 매출이 없다.
   *    반대쪽 손해는 대칭이 아니다: 잠깐의 거부는 다시 누르면 끝이지만,
   *    이중 청구는 환불과 고객 대응이 필요한 금전 사고다.
   */
  if (error) {
    console.error('[repository] 진행 중 결제 확인 실패 — 결제를 진행하지 않는다:', error.message)
    return 'unknown'
  }
  return (data ?? []).length > 0 ? 'yes' : 'no'
}

/**
 * 방금 이 플랜으로 **이미 승인된** 업그레이드 결제가 있는가.
 *
 * ★ 왜 필요한가 (2026-08-03 교차검증 2라운드).
 *   차액 승인은 성공했는데 그 뒤 DB 후처리가 실패하면 결제는 `PAID` 로 남고
 *   플랜은 안 바뀐다. 이때 사용자가 다시 시도하면 `isUpgrade()` 가 통과해
 *   **같은 차액이 한 번 더 청구**된다. 이미 받은 돈이 있으면 다시 받지 않고
 *   후처리만 이어서 끝낸다.
 */
export type PaidUpgradeLookup =
  | { readonly state: 'found'; readonly id: string; readonly amount: number }
  | { readonly state: 'none' }
  | { readonly state: 'unknown' }

/**
 * ⚠️ 창을 1시간 → **24시간** 으로 넓혔다 (2026-08-03 5라운드).
 *    1시간이면 "고객이 안내를 보고 고객센터에 문의했다가 오후에 다시 눌렀다" 는
 *    아주 평범한 흐름에서 복구가 만료돼 **같은 차액을 다시 청구**한다.
 *    복구 가능 여부가 사용자의 재시도 속도에 달려 있으면 안 된다.
 *    제대로 된 해법은 결제에 "후처리 완료" 상태를 두고 미완료 PAID 를 시간 제한
 *    없이 찾는 것이다 — 마이그레이션이라 대표 승인 후 별도 처리한다.
 */
const PAID_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000

export async function findRecentPaidUpgrade(
  userId: string,
  plan: PlanId,
  withinMs: number = PAID_RECOVERY_WINDOW_MS,
): Promise<PaidUpgradeLookup> {
  const since = new Date(Date.now() - withinMs).toISOString()
  const { data, error } = await getAdmin()
    .from('payments')
    .select('id, amount')
    .eq('user_id', userId)
    .eq('plan', plan)
    .eq('status', 'PAID')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
  /**
   * ⚠️ 확인을 못 하면 **결제를 진행하지 않는다**(fail-closed, 2026-08-03 4라운드).
   *    이 조회가 실패한 채 통과시키면 "이미 승인된 차액" 을 못 보고 다시 승인한다.
   *    PENDING 검사는 이걸 못 잡는다 — 앞선 결제는 이미 PAID 라서 걸리지 않는다.
   *    조회 장애 중에는 어차피 결제 기록도 못 남기므로 통과시켜 얻을 것이 없다.
   */
  if (error) {
    console.error('[repository] 승인된 업그레이드 결제 확인 실패:', error.message)
    return { state: 'unknown' }
  }
  const row = (data ?? [])[0] as { id: string; amount: number } | undefined
  return row ? { state: 'found', id: row.id, amount: row.amount } : { state: 'none' }
}

export async function findPaymentById(paymentId: string): Promise<Payment | null> {
  const { data, error } = await getAdmin()
    .from('payments')
    .select('*')
    .eq('id', paymentId)
    .single()
  if (error) return null
  return data as Payment
}

export async function markPaymentPaid(params: {
  paymentId: string
  pgTxId: string
  pgProvider: string
  paymentMethod: string
  cardName: string | null
  receiptUrl: string | null
  paidAt: string
  rawResponse: unknown
}): Promise<void> {
  const { error } = await getAdmin()
    .from('payments')
    .update({
      status: 'PAID',
      pg_tx_id: params.pgTxId,
      pg_provider: params.pgProvider,
      payment_method: params.paymentMethod,
      card_name: params.cardName,
      receipt_url: params.receiptUrl,
      paid_at: params.paidAt,
      raw_response: params.rawResponse,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.paymentId)
  if (error) throw new Error(`결제 PAID 업데이트 실패: ${error.message}`)
}

export async function markPaymentFailed(paymentId: string, reason: string): Promise<void> {
  await getAdmin()
    .from('payments')
    .update({ status: 'FAILED', failure_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', paymentId)
}

export async function markPaymentCancelled(params: {
  paymentId: string
  cancellationId: string | null
  cancelledAt: string
  reason: string | null
}): Promise<void> {
  const { error } = await getAdmin()
    .from('payments')
    .update({
      status: 'CANCELLED',
      cancellation_id: params.cancellationId,
      cancelled_at: params.cancelledAt,
      cancel_reason: params.reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.paymentId)
  if (error) throw new Error(`결제 CANCELLED 업데이트 실패: ${error.message}`)
}

export async function expireUserPlan(userId: string): Promise<void> {
  const { error } = await getAdmin()
    .from('profiles')
    .update({
      plan_expires_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
  if (error) throw new Error(`플랜 만료 처리 실패: ${error.message}`)

  /**
   * 구독이 끝나면 위임 자격증명도 끝난다 — 즉시 파기한다.
   *
   * 파기 실패가 만료 처리를 되돌리지는 않는다(만료는 이미 성사된 사실이다).
   * 놓친 건은 일 1회 스윕(`purgeExpiredCareCredentials`)이 다시 잡는다.
   */
  await purgeCareCredentials(userId, '구독 해지·만료로 위임 근거 소멸')
}

export async function cancelActiveBillingKeys(userId: string): Promise<void> {
  await getAdmin()
    .from('billing_keys')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
}

/** 블로그 자동 개설이 결제 응답을 붙잡을 수 있는 최대 시간. */
const PROVISION_BUDGET_MS = 5000

/**
 * 개설 작업에 시간 상한을 둔다. 넘기면 기다리지 않고 'failed' 로 넘어간다.
 *
 * ★ 예산 초과 시 진행 중인 요청을 **실제로 끊는다**(AbortController).
 *   Promise.race 만 걸면 응답을 돌려준 뒤에도 UPDATE 가 살아 있어, 그 사이 고객이
 *   마이페이지에서 바꾼 설정을 뒤늦게 덮어쓸 수 있다. compare-and-set 은 값이
 *   달라진 경합만 막고 "같은 값으로 다시 저장한" 의도는 볼 수 없으므로 취소가 필요하다.
 *   개설은 멱등이라 끊겨도 다음 결제·갱신에서 다시 시도된다.
 */
async function withProvisionBudget(
  run: (signal: AbortSignal) => Promise<ProvisionOutcome>,
): Promise<ProvisionOutcome> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<ProvisionOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve({ status: 'failed', reason: '개설 시간 예산 초과' })
    }, PROVISION_BUDGET_MS)
  })
  try {
    return await Promise.race([run(controller.signal), budget])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function activateUserPlan(params: {
  userId: string
  plan: PlanId
  expiresAt: string
}): Promise<void> {
  const admin = getAdmin()

  /**
   * ⚠️ **여기서 케어 자격증명을 파기하지 않는다** (2026-08-03, 3→4라운드에서 되돌림).
   *
   *   시도했던 것: "이전 `plan_expires_at` 이 이미 지났으면 새 계약이니 파기" 라는
   *   공백 판별식. 목적은 만료 직후 스윕 전에 재구독하면 지난 계약의 비밀번호가
   *   되살아나는 창(최대 하루)을 닫는 것이었다.
   *
   *   되돌린 이유: **정상 고객을 해친다.** 정기결제는 만료 전에 도는 것이 원칙이지만
   *   `billing-retry` 는 실패 후 3일 뒤에 승인되므로 **만료일을 확실히 지난 뒤** 이
   *   함수를 부른다. 그러면 결제가 잠깐 밀렸을 뿐인 멀쩡한 케어 고객이 "새 계약" 으로
   *   판정돼 위임 자격증명이 지워진다. 게다가 사전 조회가 실패하면 갱신까지
   *   새 계약으로 오판한다. 막으려던 위험(≤하루, 재구독한 경우)보다 만드는 위험
   *   (정상 고객의 자격증명 소실)이 크다.
   *
   *   제대로 된 해법은 **계약 인스턴스를 기록하는 것**이다 — `care_onboarding` 에
   *   `delegated_for_period`(또는 `revoked_at`) 컬럼을 두고 현재 계약과 일치할 때만
   *   열람을 허용한다. 마이그레이션이라 대표 승인 후 별도 처리한다.
   *   그때까지 남는 구멍: 만료 후 **일 1회 스윕이 돌기 전에** 재구독하면 지난 계약의
   *   자격증명이 살아 있다. 명시적 해지(`expireUserPlan`)는 즉시 파기되므로 해당 없음.
   */
  const { error } = await admin
    .from('profiles')
    .upsert({
      id: params.userId,
      plan: params.plan,
      plan_started_at: new Date().toISOString(),
      plan_expires_at: params.expiresAt,
      usage_count: 0,
      usage_reset_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  if (error) throw new Error(`플랜 활성화 실패: ${error.message}`)

  // ★ 유료 활성화 = 병원 블로그 자동 개설 시점.
  //   여기(플랜 활성화 단일 관문)에 거는 이유: 최초 빌링 확인(payment/billing/confirm),
  //   일반 결제 확인(verify.verifyAndActivate → payment/confirm · webhook), 정기결제
  //   cron(billing-charge / billing-retry) 이 모두 이 함수를 지나므로 어떤 결제 경로도
  //   빠지지 않는다. 모두 service role 서버 경로라 남의 슬러그 중복 확인이 가능하다.
  //   provisionClinicSite 는 멱등이며(회원당 1회) 절대 throw 하지 않는다 —
  //   개설 실패가 결제 성공을 되돌리면 안 된다.
  //
  //   ★ 시간 예산(PROVISION_BUDGET_MS): 개설은 DB 왕복이 여러 번(프로필 조회 +
  //   슬러그 후보별 조건부 update)이라 최악의 경우 결제 확인 응답을 붙잡을 수 있다.
  //   결제 확인은 사용자가 기다리는 경로이고, 정기결제 cron 은 회원 수만큼 이 함수를
  //   반복 호출한다(maxDuration 300s). 예산을 넘기면 결과를 기다리지 않고 넘어간다 —
  //   개설은 멱등이라 다음 결제·갱신에서 다시 시도된다.
  const outcome = await withProvisionBudget((signal) =>
    provisionClinicSite(admin, params.userId, signal),
  )
  if (outcome.status === 'failed') {
    console.error('[activateUserPlan] 병원 블로그 자동 개설 실패:', params.userId, outcome.reason)
  }
}

/**
 * 업그레이드 전용: profiles 의 plan 만 교체한다 (plan_expires_at 은 전달값 유지).
 * activateUserPlan 과 달리 usage_count / usage_reset_at 을 초기화하지 않는다
 * (업그레이드는 같은 주기 내 즉시 전환이므로 사용량을 유지해야 한다).
 */
export async function setUserPlanKeepUsage(
  userId: string,
  plan: PlanId,
  expiresAt: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = {
    plan,
    updated_at: new Date().toISOString(),
  }
  // plan_expires_at 은 기존 값을 그대로 유지(전달값) — 주기를 변경하지 않는다.
  if (expiresAt != null) patch.plan_expires_at = expiresAt

  const { error } = await getAdmin().from('profiles').update(patch).eq('id', userId)
  if (error) throw new Error(`플랜 전환 실패: ${error.message}`)
}

/**
 * 업그레이드 전용: 활성 빌링키 행의 plan 만 교체한다.
 * next_billing_at / trial_until / status 는 유지한다 (정기결제 주기 불변).
 */
export async function updateActiveBillingKeyPlan(userId: string, plan: PlanId): Promise<void> {
  const { error } = await getAdmin()
    .from('billing_keys')
    .update({ plan, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
  if (error) throw new Error(`빌링키 플랜 전환 실패: ${error.message}`)
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await getAdmin()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) return null
  return data as Profile
}

export async function getUserPayments(userId: string): Promise<Payment[]> {
  const { data, error } = await getAdmin()
    .from('payments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return []
  return data as Payment[]
}

// ── 빌링키 ──────────────────────────────────────────────

export async function createBillingKey(params: {
  userId: string
  billingKey: string
  plan: PlanId
  cardName: string | null
  cardLast4: string | null
  nextBillingAt: string
  trialUntil?: string | null
}): Promise<void> {
  // 기존 활성 빌링키 비활성화
  await getAdmin()
    .from('billing_keys')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
    .eq('user_id', params.userId)
    .eq('status', 'ACTIVE')

  const { error } = await getAdmin()
    .from('billing_keys')
    .insert({
      user_id: params.userId,
      billing_key: params.billingKey,
      plan: params.plan,
      card_name: params.cardName,
      card_last4: params.cardLast4,
      status: 'ACTIVE',
      next_billing_at: params.nextBillingAt,
      trial_until: params.trialUntil ?? null,
    })
  if (error) throw new Error(`빌링키 저장 실패: ${error.message}`)
}

// 무료 체험 자격 판별: 빌링키 이력이 단 1건도 없으면 신규 가입자
export async function hasAnyBillingKeyHistory(userId: string): Promise<boolean> {
  const { count, error } = await getAdmin()
    .from('billing_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (error) return true // 안전 기본값: 이력 있다고 보고 무료 체험 차단
  return (count ?? 0) > 0
}

// 무료 체험 시작 기록 (0원 PAID 결제 레코드)
export async function markPaymentTrialActivated(params: {
  paymentId: string
  paidAt: string
}): Promise<void> {
  const { error } = await getAdmin()
    .from('payments')
    .update({
      status: 'PAID',
      amount: 0,
      pg_provider: 'TRIAL',
      payment_method: 'TRIAL',
      paid_at: params.paidAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.paymentId)
  if (error) throw new Error(`무료 체험 결제 레코드 갱신 실패: ${error.message}`)
}

export async function getActiveBillingKey(userId: string): Promise<BillingKey | null> {
  const { data, error } = await getAdmin()
    .from('billing_keys')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (error) return null
  return data as BillingKey
}

export async function cancelBillingKeyById(billingKeyId: string): Promise<void> {
  await getAdmin()
    .from('billing_keys')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
    .eq('id', billingKeyId)
}
