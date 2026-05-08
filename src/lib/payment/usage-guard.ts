import { createAdminClient, createServerSupabaseClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { PLANS, isPaidPlanId } from './plans'

export type UsageGuardFailReason =
  | 'unauthenticated'
  | 'no_profile'
  | 'plan_required'
  | 'plan_expired'
  | 'limit_exceeded'

export interface UsageGuardSuccess {
  ok: true
  userId: string
  isAdmin: boolean
  newCount: number
  monthlyLimit: number  // -1 = 무제한
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
    .select('plan, plan_expires_at')
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
    // free/null/unknown → 결제 필요
    if (!isPaidPlanId(profile.plan)) {
      return {
        ok: false,
        reason: 'plan_required',
        message: '구독 플랜이 필요합니다. 요금제 페이지에서 결제 후 이용해주세요.',
        status: 402,
        userId: user.id,
      }
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

    monthlyLimit = PLANS[profile.plan].usageLimit
  }

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
 * 본문 생성이 실패했을 때 사용량을 1 차감한다 (롤백).
 */
export async function refundUsage(userId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.rpc('decrement_usage', { p_user_id: userId })
  } catch {
    // 롤백 실패는 조용히 무시 (사용자에게는 이미 에러를 반환한 상태)
  }
}
