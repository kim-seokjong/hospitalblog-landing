import { createAdminClient, createServerSupabaseClient } from '@/dev/lib/supabase/server'
import { isAdmin } from '@/hr/lib/admin'
import { PLANS, isPaidPlanId } from './plans'

export type UsageGuardFailReason =
  | 'unauthenticated'
  | 'no_profile'
  | 'plan_required'
  | 'plan_expired'
  | 'limit_exceeded'
  | 'profile_required'   // 무료 체험 전 병원 프로필(병원명) 입력 필요

export interface UsageGuardSuccess {
  ok: true
  userId: string
  isAdmin: boolean
  newCount: number
  monthlyLimit: number  // -1 = 무제한
  // 무료 체험(가입 2회) 크레딧으로 소비된 생성 — 환불 시 free 경로로 복구해야 한다
  freeCredit?: boolean
  freeRemaining?: number
}

export interface UsageGuardFailure {
  ok: false
  reason: UsageGuardFailReason
  message: string
  status: number
  userId?: string
  newCount?: number
  monthlyLimit?: number
}

export type UsageGuardResult = UsageGuardSuccess | UsageGuardFailure

interface ConsumeUsageRpcResult {
  ok: boolean
  reason?: 'no_profile' | 'limit_exceeded'
  new_count?: number
  monthly_limit?: number
}

/**
 * 본문 1건 생성 직전 호출. 인증·플랜·사용량을 원자적으로 체크하고 1 증가시킨다.
 * 관리자(ADMIN_EMAILS 환경변수)는 플랜·만료·한도 체크를 모두 우회한다.
 */
export async function checkAndConsumeUsage(): Promise<UsageGuardResult> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return {
      ok: false,
      reason: 'unauthenticated',
      message: '로그인이 필요합니다.',
      status: 401,
    }
  }

  const userIsAdmin = isAdmin(user.email)
  const admin = createAdminClient()

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('plan, plan_expires_at, hospital_name, phone, free_credits')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return {
      ok: false,
      reason: 'no_profile',
      message: '프로필 정보를 불러올 수 없습니다.',
      status: 403,
      userId: user.id,
    }
  }

  let monthlyLimit: number

  if (userIsAdmin) {
    // 관리자는 플랜·만료·한도 체크 모두 우회 (통계용 카운트만 증가)
    monthlyLimit = -1
  } else {
    // free/null/unknown → 가입 무료 2회 크레딧 경로 (2026-07-04 정책, 소진 시 결제 유도)
    if (!isPaidPlanId(profile.plan)) {
      return consumeFreeCredit(admin, user.id, profile)
    }

    // 만료 검사
    if (!profile.plan_expires_at || new Date(profile.plan_expires_at) <= new Date()) {
      return {
        ok: false,
        reason: 'plan_expired',
        message: '구독이 만료되었습니다. 요금제 페이지에서 갱신해주세요.',
        status: 402,
        userId: user.id,
      }
    }

    // 블로그(본문) 월 한도. plan.limits.blog 와 동일(usageLimit 는 deprecated 별칭).
    monthlyLimit = PLANS[profile.plan].limits.blog
  }

  // TODO(clinicflix-integration): 번들 플랜(growth8_standard / pro12_pro)의 영상·채널
  // 사용량은 별도 카운터로 enforce 해야 한다. ClinicFlix 생성 파이프라인이 아직
  // 없으므로 여기서는 블로그 한도만 검사한다. 연동 시:
  //   - plan.limits.video      (월 영상 생성 한도, -1=무제한)
  //   - plan.limits.channels   (월 멀티채널 세트 한도, -1=무제한)
  //   - plan.fairUseCap        (채널 무제한 플랜의 공정사용 소프트캡)
  // 을 각각 별도 consume_usage 류 RPC(예: consume_video_usage / consume_channel_usage)로
  // 원자적 체크+증가하도록 추가한다.

  const { data, error } = await admin.rpc('consume_usage', {
    p_user_id: user.id,
    p_monthly_limit: monthlyLimit,
  })

  if (error) {
    return {
      ok: false,
      reason: 'no_profile',
      message: '사용량 처리 중 오류가 발생했습니다.',
      status: 500,
      userId: user.id,
    }
  }

  const result = data as ConsumeUsageRpcResult

  if (!result.ok) {
    if (result.reason === 'limit_exceeded') {
      return {
        ok: false,
        reason: 'limit_exceeded',
        message: `이번 달 사용 한도(${result.monthly_limit}건)에 도달했습니다. 상위 플랜으로 업그레이드해주세요.`,
        status: 429,
        userId: user.id,
        newCount: result.new_count,
        monthlyLimit: result.monthly_limit,
      }
    }
    return {
      ok: false,
      reason: 'no_profile',
      message: '프로필 정보를 불러올 수 없습니다.',
      status: 403,
      userId: user.id,
    }
  }

  return {
    ok: true,
    userId: user.id,
    isAdmin: userIsAdmin,
    newCount: result.new_count ?? 0,
    monthlyLimit: result.monthly_limit ?? monthlyLimit,
  }
}

/**
 * 가입 무료 2회 크레딧 소비 (비유료 계정 전용, 2026-07-04 정책).
 *
 * 순서: 잔여 확인 → 병원 프로필 게이트(개인화+악용 문턱) → 병원명·전화 중복
 * 소프트 방어(본인인증 DI 머지 전 임시) → RPC 원자적 차감.
 */
interface FreeCreditProfile {
  hospital_name?: string | null
  phone?: string | null
  free_credits?: number | null
}

const FREE_CREDITS_TOTAL = 2
const FREE_EXHAUSTED_MESSAGE =
  '무료 체험 2회를 모두 사용하셨어요. 요금제에서 구독하시면 매달 계속 이용할 수 있습니다.'
/** 기한(가입 후 7일, migration 062)이 지난 경우 — 아직 안 쓴 회원이라 문구가 달라야 한다. */
const FREE_EXPIRED_MESSAGE =
  '가입 시 드린 무료 체험 2회의 사용 기한이 지났어요. 요금제에서 구독하시면 바로 이어서 이용할 수 있습니다.'

async function consumeFreeCredit(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  profile: FreeCreditProfile,
): Promise<UsageGuardResult> {
  const credits = profile.free_credits ?? 0
  if (credits <= 0) {
    return {
      ok: false,
      reason: 'plan_required',
      message: FREE_EXHAUSTED_MESSAGE,
      status: 402,
      userId,
    }
  }

  // ① 프로필 게이트 — 병원명이 있어야 "우리 병원 글" 경험이 되고, 악용 문턱도 된다
  if (!profile.hospital_name || !profile.hospital_name.trim()) {
    return {
      ok: false,
      reason: 'profile_required',
      message: '무료 체험은 병원 정보 입력 후 이용할 수 있어요. 마이페이지 → 프로필에서 병원명을 먼저 입력해주세요.',
      status: 403,
      userId,
    }
  }

  // ② 중복 가입 소프트 방어 — 같은 병원명+전화로 이미 무료를 소진한 다른 계정이 있으면 차단
  //    (본인인증 DI 머지 전 임시 방어. 전화 미입력 계정은 이 검사를 통과하지만
  //     병원명 게이트+원가 소액이라 감수 — DI 도입 시 완전 차단으로 대체)
  if (profile.phone && profile.phone.trim()) {
    const { data: dup } = await admin
      .from('profiles')
      .select('id')
      .eq('hospital_name', profile.hospital_name.trim())
      .eq('phone', profile.phone.trim())
      .neq('id', userId)
      .eq('free_credits', 0)
      .limit(1)
    if (dup && dup.length > 0) {
      return {
        ok: false,
        reason: 'plan_required',
        message: '이미 무료 체험을 사용한 병원입니다. 요금제에서 구독 후 이용해주세요.',
        status: 402,
        userId,
      }
    }
  }

  // ③ 원자적 차감 (잔여 > 0 조건부 UPDATE — 동시 요청 이중차감 방지)
  const { data, error } = await admin.rpc('consume_free_credit', { p_user_id: userId })
  const result = data as { ok?: boolean; remaining?: number; reason?: string } | null
  if (error || !result?.ok) {
    // 만료와 소진은 다른 사유다 (migration 062). 뭉뚱그리면 한 번도 안 쓴 회원에게
    // "2회를 모두 사용하셨어요"라는 틀린 말이 나간다.
    const expired = result?.reason === 'expired'
    return {
      ok: false,
      reason: 'plan_required',
      message: expired ? FREE_EXPIRED_MESSAGE : FREE_EXHAUSTED_MESSAGE,
      status: 402,
      userId,
    }
  }

  const remaining = result.remaining ?? 0
  return {
    ok: true,
    userId,
    isAdmin: false,
    newCount: FREE_CREDITS_TOTAL - remaining,
    monthlyLimit: FREE_CREDITS_TOTAL,
    freeCredit: true,
    freeRemaining: remaining,
  }
}

/**
 * 본문 생성이 실패했을 때 사용량을 1 차감한다 (롤백).
 * freeCredit=true 면 월 사용량이 아니라 무료 크레딧을 복구한다.
 */
export async function refundUsage(
  userId: string,
  opts?: { freeCredit?: boolean },
): Promise<void> {
  try {
    const admin = createAdminClient()
    if (opts?.freeCredit) {
      await admin.rpc('refund_free_credit', { p_user_id: userId })
    } else {
      await admin.rpc('decrement_usage', { p_user_id: userId })
    }
  } catch {
    // 롤백 실패는 조용히 무시 (사용자에게는 이미 에러를 반환한 상태)
  }
}

export type PlanGateFailReason = 'unauthenticated' | 'no_profile' | 'plan_required' | 'plan_expired'

export interface PlanGateSuccess {
  ok: true
  userId: string
  isAdmin: boolean
}

export interface PlanGateFailure {
  ok: false
  reason: PlanGateFailReason
  message: string
  status: number
}

export type PlanGateResult = PlanGateSuccess | PlanGateFailure

/**
 * 사용량 차감 없이 인증·유료플랜·만료만 검사한다. 본문 생성과 함께 호출되는
 * 이미지 라우트(generate-images, regenerate-image)처럼 차감 책임이 다른 라우트에
 * 있는 경우에 사용한다. 비인증·비결제 사용자의 외부 API 비용 발생을 차단한다.
 */
export async function requirePaidPlan(): Promise<PlanGateResult> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, reason: 'unauthenticated', message: '로그인이 필요합니다.', status: 401 }
  }

  const userIsAdmin = isAdmin(user.email)
  if (userIsAdmin) {
    return { ok: true, userId: user.id, isAdmin: true }
  }

  const admin = createAdminClient()
  const { data: profile, error } = await admin
    .from('profiles')
    .select('plan, plan_expires_at, free_credits')
    .eq('id', user.id)
    .single()

  if (error || !profile) {
    return {
      ok: false,
      reason: 'no_profile',
      message: '프로필 정보를 불러올 수 없습니다.',
      status: 403,
    }
  }

  if (!isPaidPlanId(profile.plan)) {
    // 무료 체험 계정: 본문을 최소 1회 생성한 계정(free_credits < 2)은 그 글의
    // 부속 기능(이미지 등)을 허용 — 반쪽 체험은 전환이 안 된다. 본문을 한 번도
    // 안 쓴 계정은 차단(외부 API 비용 방어).
    const fc = (profile as { free_credits?: number | null }).free_credits
    if (typeof fc === 'number' && fc < FREE_CREDITS_TOTAL) {
      return { ok: true, userId: user.id, isAdmin: false }
    }
    return {
      ok: false,
      reason: 'plan_required',
      message: '구독 플랜이 필요합니다. 요금제 페이지에서 결제 후 이용해주세요.',
      status: 402,
    }
  }

  if (!profile.plan_expires_at || new Date(profile.plan_expires_at) <= new Date()) {
    return {
      ok: false,
      reason: 'plan_expired',
      message: '구독이 만료되었습니다. 요금제 페이지에서 갱신해주세요.',
      status: 402,
    }
  }

  return { ok: true, userId: user.id, isAdmin: false }
}
