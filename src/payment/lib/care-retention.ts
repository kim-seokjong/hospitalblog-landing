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
import { isActiveCareSubscription, isSameContract } from './care-entitlement-rules'
import { isUndefinedColumn, runWithOptionalColumns } from '@/dev/lib/optional-columns'
import type { PlanId } from './plans'
import type { SupabaseClient } from '@supabase/supabase-js'

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

// 판정 규칙은 순수 모듈에 있다(회귀 테스트 대상) — 여기서는 다시 내보내기만 한다.
export { isActiveCareSubscription, isSameContract }

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
  readonly reason:
    | 'ok'
    | 'not_care_plan'
    | 'expired'
    | 'no_expiry'
    | 'no_profile'
    | 'lookup_failed'
    | 'stale_contract'
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
  stale_contract:
    '지난 계약에서 받은 위임 정보입니다. 현재 구독은 새 계약이므로 고객에게 계정 정보를 다시 받아야 합니다 — 이전 자격증명은 파기해 주세요.',
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

  /**
   * 구독은 살아 있다 — 이제 **그 위임이 이 계약의 것인지** 본다.
   *
   * 만료 후 파기 스윕이 돌기 전에 재구독하면 구독 상태만으로는 통과해 버린다.
   * 지난 계약의 비밀번호가 재제출 없이 되살아나는 구멍이 여기였다(2026-08-03).
   */
  const [onboarding, activeKey] = await Promise.all([
    admin.from('care_onboarding').select('billing_key_id').eq('user_id', userId).maybeSingle(),
    admin
      .from('billing_keys')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  /**
   * ⚠️ **"컬럼이 없다" 와 "조회가 실패했다" 를 반드시 구분한다** (2026-08-03 지적).
   *
   *   둘을 뭉개면 일시적 DB 오류·권한 오류·타임아웃까지 전부 "구버전 행이라 통과"
   *   가 되어, **지난 계약의 비밀번호가 열린다.** 컬럼 부재만 legacy 로 봐주고,
   *   나머지 오류는 열람을 막는다(확인 못 했으면 안 연다).
   */
  if (onboarding.error && !isUndefinedColumn(onboarding.error)) {
    console.error('[care-retention] 계약 확인 실패:', onboarding.error.message)
    return { active: false, plan, planName, expiresAt, reason: 'lookup_failed' }
  }
  if (activeKey.error) {
    console.error('[care-retention] 활성 결제수단 확인 실패:', activeKey.error.message)
    return { active: false, plan, planName, expiresAt, reason: 'lookup_failed' }
  }

  // 마이그 060 미적용 = 계약을 기록할 곳 자체가 없다 → 이 검사만 건너뛴다.
  const contractTrackingLive = !onboarding.error
  if (contractTrackingLive) {
    const submittedKeyId = (onboarding.data as { billing_key_id?: string | null } | null)
      ?.billing_key_id ?? null
    const activeKeyId = (activeKey.data as { id: string } | null)?.id ?? null
    if (!isSameContract(submittedKeyId, activeKeyId)) {
      return { active: false, plan, planName, expiresAt, reason: 'stale_contract' }
    }
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
   *    사유는 전용 컬럼(`revocation_reason`, 마이그 060)에 남기고, 그 컬럼이 아직
   *    없는 환경에서는 로그로만 남긴다.
   */
  const now = new Date().toISOString()
  let affected = 0
  const { error } = await runWithOptionalColumns(
    {
      blog_pw_enc: null,
      insta_pw_enc: null,
      status: 'revoked',
      updated_at: now,
    },
    { revoked_at: now, revocation_reason: reason.slice(0, 300) },
    (payload) =>
      getAdmin()
        .from('care_onboarding')
        .update(payload)
        .eq('user_id', userId)
        .neq('status', 'revoked')
        .select('user_id')
        .then(({ data, error: e }) => {
          if (!e) affected = (data ?? []).length
          return { error: e }
        }),
  )
  if (error) {
    // 테이블 미생성(마이그레이션 미적용) 환경은 조용히 넘어간다.
    if (error.code === '42P01') return false
    console.error(`[care-retention] 자격증명 파기 실패 (user=${userId}):`, error.message)
    return false
  }
  // 0행 갱신은 "이미 철회됨" 이거나 "그런 행 없음" 이다 — 파기 성공으로 세지 않는다.
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
   * **커서로** 훑는다 — offset 페이지네이션은 상한을 넘는 순간 뒤쪽 행에 영영
   * 닿지 못한다(다음 실행도 같은 첫 페이지부터 시작하므로). 마지막으로 본
   * `(updated_at, user_id)` 뒤부터 이어 읽으면 상한이 곧 진행이 된다.
   *
   * 정렬은 **유일**해야 한다 — `updated_at` 만으로는 같은 타임스탬프 행이 경계에서
   * 중복되거나 빠진다(2026-08-03 4라운드).
   */
  const PAGE = 500
  const MAX_PAGES = 40
  const candidates: Array<{ user_id: string }> = []
  let cursorUpdatedAt: string | null = null
  let cursorUserId: string | null = null
  let exhausted = false

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let q = admin
      .from('care_onboarding')
      .select('user_id, blog_pw_enc, insta_pw_enc, status, updated_at')
      .neq('status', 'revoked')
      .order('updated_at', { ascending: true })
      .order('user_id', { ascending: true })
      .limit(PAGE)

    if (cursorUpdatedAt !== null && cursorUserId !== null) {
      // (updated_at, user_id) > (커서) — 복합 커서를 PostgREST `or` 로 표현한다.
      q = q.or(
        `updated_at.gt.${cursorUpdatedAt},and(updated_at.eq.${cursorUpdatedAt},user_id.gt.${cursorUserId})`,
      )
    }

    const { data: rows, error: rowsError } = await q

    if (rowsError) {
      if (rowsError.code === '42P01') return { purged: 0, checked: 0, skipped: 0, errors: [] }
      return {
        purged: 0,
        checked: candidates.length,
        skipped: candidates.length,
        errors: [...errors, rowsError.message],
      }
    }

    const batch = (rows ?? []) as Array<{
      user_id: string
      blog_pw_enc: string | null
      insta_pw_enc: string | null
      updated_at: string
    }>
    for (const r of batch) {
      if (r.blog_pw_enc || r.insta_pw_enc) candidates.push({ user_id: r.user_id })
    }
    if (batch.length < PAGE) {
      exhausted = true
      break
    }
    const last = batch[batch.length - 1]
    cursorUpdatedAt = last.updated_at
    cursorUserId = last.user_id
  }

  if (!exhausted) {
    /**
     * ⚠️ 커서는 **한 번의 실행 안에서만** 이어진다 — 실행 간에 저장하지 않는다.
     *    그래서 다음 실행도 처음부터 읽는다. 파기된 행은 `revoked` 가 되어 집합에서
     *    빠지므로 보통은 집합이 줄지만, 상한만큼이 **계속 활성 구독**으로 차 있으면
     *    그 뒤 행에는 이번에도 다음에도 닿지 않는다.
     *    (활성 케어 구독이 이 수를 넘으면 그건 행복한 문제이고, 그때 커서를 저장하면 된다.)
     *    거짓으로 안심시키지 않으려고 문구를 정확히 쓴다.
     */
    errors.push(
      `순회 상한(${MAX_PAGES * PAGE}행)에 도달 — 그 뒤 행은 검사되지 않았다. ` +
        `활성 위임이 이 수를 넘었다면 실행 간 커서 저장이 필요하다`,
    )
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
