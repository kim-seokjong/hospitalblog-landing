/**
 * 케어 위임 자격증명의 **보유 기간**을 강제한다.
 *
 * ★ 왜 있는가 (2026-08-03 주간점검 교차검증 2라운드).
 *   구독이 끝난 뒤 열람만 막는 것으로는 부족했다. 암호문이 그대로 남아 있으면
 *   두 가지가 계속 열려 있다:
 *     ① 보관 자체가 근거 없는 보관이다(개인정보 최소보유 원칙).
 *     ② **재구독하면 과거 비밀번호가 다시 살아난다** — 그 동의는 끝난 계약의
 *        동의지 새 계약의 동의가 아니다. 계정을 바꿨어도 옛 비밀번호가 남는다.
 *   그래서 근거가 사라진 시점에 **지운다.** 지운 뒤엔 재제출을 받아야 한다.
 *
 * ⚠️ 이 모듈은 **파괴적**이다. 판단 근거(profiles 조회)가 확실할 때만 지운다.
 *    조회가 실패하면 아무것도 지우지 않는다 — 일시적 DB 오류가 전 고객 자격증명을
 *    날리는 일이 있어서는 안 된다.
 */

import { createClient } from '@supabase/supabase-js'
import { isCarePlanId, PLANS } from './plans'
import type { PlanId } from './plans'
import type { SupabaseClient } from '@supabase/supabase-js'

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

/** 활성 케어 구독인가 — 만료일이 없으면 유효로 보지 않는다(애매하면 막는 쪽). */
export function isActiveCareSubscription(
  plan: string | null | undefined,
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!plan) return false
  const id = plan as PlanId
  if (!PLANS[id] || !isCarePlanId(id)) return false
  if (!expiresAt) return false
  const t = Date.parse(expiresAt)
  return Number.isFinite(t) && t > now
}

/**
 * 위임 계정을 **열어볼 근거**가 아직 살아 있는가 (관리자 복호화 게이트).
 *
 * ★ 왜 필요한가 (2026-08-03 주간점검 교차검증).
 *   제출 시점에만 케어 플랜을 확인하고, 열람 시점에는 `status='revoked'` 만 봤다.
 *   그래서 **케어 구독이 끝난 뒤에도** 관리자가 평문 비밀번호를 계속 꺼낼 수 있었다.
 *   위임의 근거는 발행 대행 계약이고, 계약이 끝나면 근거도 끝난다. 고객이 철회
 *   버튼을 안 눌렀다는 사실이 계속 접근해도 된다는 뜻이 될 수는 없다.
 */
export interface CareEntitlement {
  readonly active: boolean
  readonly plan: PlanId | null
  readonly planName: string | null
  readonly expiresAt: string | null
  /** 왜 막혔는지 — 화면·응답에 그대로 쓴다. */
  readonly reason: 'ok' | 'not_care_plan' | 'expired' | 'no_expiry' | 'no_profile' | 'lookup_failed'
}

export const ENTITLEMENT_MESSAGE: Record<CareEntitlement['reason'], string> = {
  ok: '',
  not_care_plan:
    '케어 플랜 구독자가 아닙니다. 위임 근거가 없으므로 계정 정보를 열 수 없습니다 — 자격증명을 파기해 주세요.',
  expired:
    '케어 구독이 만료됐습니다. 위임 근거가 끝났으므로 계정 정보를 열 수 없습니다 — 자격증명을 파기해 주세요.',
  lookup_failed: '구독 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  no_expiry: '구독 만료일이 비어 있어 케어 자격을 확인할 수 없습니다. 결제 상태를 먼저 확인해 주세요.',
  no_profile: '회원 정보를 찾을 수 없습니다.',
}

export async function loadCareEntitlement(
  admin: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<CareEntitlement> {
  const { data, error } = await admin
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', userId)
    .maybeSingle()

  // 확인을 못 한 것과 자격이 없는 것은 다르다. 열람은 **막되**, 이유는 구분해 남긴다.
  if (error) {
    console.error('[care-retention] 구독 상태 조회 실패:', error.message)
    return { active: false, plan: null, planName: null, expiresAt: null, reason: 'lookup_failed' }
  }

  const row = data as { plan: string | null; plan_expires_at: string | null } | null
  if (!row) {
    return { active: false, plan: null, planName: null, expiresAt: null, reason: 'no_profile' }
  }

  const plan = (row.plan ?? '') as PlanId
  const planName = PLANS[plan]?.name ?? null
  const expiresAt = row.plan_expires_at

  if (!plan || !PLANS[plan] || !isCarePlanId(plan)) {
    return { active: false, plan: plan || null, planName, expiresAt, reason: 'not_care_plan' }
  }
  if (!expiresAt) {
    return { active: false, plan, planName, expiresAt: null, reason: 'no_expiry' }
  }
  const expiry = Date.parse(expiresAt)
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
    return { active: false, plan, planName, expiresAt, reason: 'expired' }
  }
  return { active: true, plan, planName, expiresAt, reason: 'ok' }
}

export interface PurgeResult {
  readonly purged: number
  readonly checked: number
  /** 판단 근거를 못 얻어 손대지 않은 건수. */
  readonly skipped: number
  readonly errors: readonly string[]
}

/**
 * 한 회원의 위임 자격증명을 파기한다 (비밀번호만 지우고 행은 남긴다).
 *
 * 행을 지우지 않는 이유: "언제 무엇이 위임됐다가 철회됐는지" 는 분쟁 대비 기록으로
 * 남아야 한다. 지워야 하는 것은 **비밀번호**다.
 */
export async function purgeCareCredentials(userId: string, reason: string): Promise<boolean> {
  /**
   * ⚠️ `note` 는 건드리지 않는다 (2026-08-03 3라운드).
   *    파기 사유를 `note` 에 덮어썼더니 **고객이 남긴 요청사항(발행 시간대·승인 조건)이
   *    영구 손실**됐다. 행을 남기는 이유가 기록인데 그 기록을 지우면 앞뒤가 안 맞는다.
   *    사유는 로그로 남기고, 제자리는 `revoked_at`/`revocation_reason` 컬럼이다
   *    (마이그레이션 필요 — 대표 승인 대기).
   */
  const { data, error } = await getAdmin()
    .from('care_onboarding')
    .update({
      blog_pw_enc: null,
      insta_pw_enc: null,
      status: 'revoked',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .neq('status', 'revoked')
    .select('user_id')
  if (error) {
    // 테이블 미생성(마이그레이션 미적용) 환경은 조용히 넘어간다.
    if (error.code === '42P01') return false
    console.error(`[care-retention] 자격증명 파기 실패 (user=${userId}):`, error.message)
    return false
  }
  // 0행 갱신은 "이미 철회됨" 이거나 "그런 행 없음" 이다 — 파기 성공으로 세지 않는다.
  const affected = (data ?? []).length
  if (affected > 0) {
    console.warn(`[care-retention] 자격증명 파기 (user=${userId}, 사유=${reason})`)
  }
  return affected > 0
}

/**
 * 구독 근거가 사라진 위임 자격증명을 일괄 파기한다 (일 1회 cron 에서 호출).
 */
export async function purgeExpiredCareCredentials(now: number = Date.now()): Promise<PurgeResult> {
  const admin = getAdmin()
  const errors: string[] = []

  /**
   * 전량을 페이지로 훑는다 — 한 번에 N건만 읽으면 **앞쪽을 장기 활성 고객이
   * 채웠을 때 뒤쪽 만료 고객이 영원히 조회되지 않는다**(2026-08-03 3라운드).
   * 메일 재발송에서 고쳤던 것과 같은 starvation 이다.
   */
  const PAGE = 500
  const MAX_PAGES = 20
  const candidates: Array<{ user_id: string }> = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data: rows, error: rowsError } = await admin
      .from('care_onboarding')
      .select('user_id, blog_pw_enc, insta_pw_enc, status')
      .neq('status', 'revoked')
      // 정렬은 **유일**해야 한다 — `updated_at` 만으로는 같은 타임스탬프 행이
      // 페이지 경계에서 중복되거나 빠진다(2026-08-03 4라운드).
      .order('updated_at', { ascending: true })
      .order('user_id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)

    if (rowsError) {
      if (rowsError.code === '42P01') return { purged: 0, checked: 0, skipped: 0, errors: [] }
      return { purged: 0, checked: candidates.length, skipped: candidates.length, errors: [rowsError.message] }
    }

    const batch = (rows ?? []) as Array<{
      user_id: string
      blog_pw_enc: string | null
      insta_pw_enc: string | null
    }>
    for (const r of batch) {
      if (r.blog_pw_enc || r.insta_pw_enc) candidates.push({ user_id: r.user_id })
    }
    if (batch.length < PAGE) break
    if (page === MAX_PAGES - 1) {
      /**
       * ⚠️ "다음 실행에서 처리" 라고 쓰지 않는다 — **거짓이다**(2026-08-03 5라운드).
       *    다음 실행도 같은 첫 페이지부터 시작하므로, 앞쪽 상한만큼이 계속 활성
       *    구독으로 차 있으면 뒤쪽 행에는 영영 닿지 않는다. 커서 기반 순회가
       *    제대로 된 해법이고, 그전까지는 **사람이 알아채게** 남긴다.
       */
      errors.push(
        `페이지 상한(${MAX_PAGES * PAGE}행)에 도달 — 그 뒤 행은 이번에도, 다음 실행에도 검사되지 않는다. 커서 순회 도입 필요`,
      )
    }
  }

  if (candidates.length === 0) {
    return { purged: 0, checked: 0, skipped: 0, errors }
  }

  // 구독 상태 조회도 나눠 던진다 — UUID 수천 개를 한 요청에 실으면 URL 길이에 걸린다.
  const byId = new Map<string, { plan: string | null; expiresAt: string | null }>()
  let profilesError: { message: string } | null = null
  for (let i = 0; i < candidates.length; i += 200) {
    const ids = candidates.slice(i, i + 200).map((r) => r.user_id)
    const { data: profiles, error: pErr } = await admin
      .from('profiles')
      .select('id, plan, plan_expires_at')
      .in('id', ids)
    if (pErr) {
      profilesError = pErr
      break
    }
    for (const p of (profiles ?? []) as Array<{
      id: string
      plan: string | null
      plan_expires_at: string | null
    }>) {
      byId.set(p.id, { plan: p.plan, expiresAt: p.plan_expires_at })
    }
  }

  // ⚠️ 근거를 못 얻었으면 **아무것도 지우지 않는다.**
  if (profilesError) {
    return {
      purged: 0,
      checked: candidates.length,
      skipped: candidates.length,
      errors: [...errors, `구독 상태 조회 실패 — 파기 보류: ${profilesError.message}`],
    }
  }

  let purged = 0
  let skipped = 0
  for (const row of candidates) {
    const profile = byId.get(row.user_id)
    // 프로필 행을 못 본 회원은 건드리지 않는다 (조회 누락과 탈퇴를 구분할 수 없다).
    if (!profile) {
      skipped += 1
      continue
    }
    if (isActiveCareSubscription(profile.plan, profile.expiresAt, now)) continue

    const ok = await purgeCareCredentials(row.user_id, '케어 구독 종료로 위임 근거 소멸')
    if (ok) purged += 1
    else {
      skipped += 1
      errors.push(`파기 실패: ${row.user_id}`)
    }
  }

  return { purged, checked: candidates.length, skipped, errors }
}
