// 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증한다.

/** 가입 무료 크레딧 총량 — usage-guard.ts 의 FREE_CREDITS_TOTAL 과 같아야 한다(migration 033 기본값 2). */
export const FREE_TRIAL_CREDITS_TOTAL = 2

/**
 * ★무료 체험 계정이 **본문 전 단계**(제목 뽑기·키워드 추천·키워드 추이)를 써도 되는가 — 순수 함수.
 *
 * 2026-10-08 발견: requirePaidPlan 은 무료 계정을 「본문을 한 번 쓴 뒤(free_credits < 2)」에만 열어 준다.
 *   그런데 글쓰기 순서는 키워드 → **제목 5개** → 본문이라, 갓 가입한 계정(free_credits = 2)은
 *   제목 단계에서 「구독 플랜이 필요합니다」(402)로 막혀 **무료 2편을 한 편도 쓸 수 없었다.**
 *   7/4 무료 2회 도입 이후 무료 가입 4곳 전부 글 0편 — 한 곳은 사흘간 14번 다시 들어와 요금 페이지만 보고 갔다.
 * ⇒ 남은 크레딧이 있고 기한(가입 후 7일, migration 062) 안이면 연다. 이미 한 편 쓴 계정은 예전처럼 연다.
 *   ⚠️기한·잔여 판정은 여기서 하고, 실제 차감은 본문 생성(consume_free_credit)이 한다 — 이 함수는 차감하지 않는다.
 */
export type FreeTrialPreBodyVerdict = 'ok' | 'exhausted' | 'expired' | 'invalid'

/** 무료 체험 하루 제목 생성 상한 — 본문을 안 쓰고 제목만 반복하는 비용을 막는다(코덱스 10/8). 한 편에 보통 1~3회 쓴다. */
export const FREE_TRIAL_DAILY_TITLE_CAP = 15

export function freeTrialPreBodyVerdict(
  profile: { free_credits?: number | null; free_credits_expires_at?: string | null },
  now: Date = new Date(),
): FreeTrialPreBodyVerdict {
  const fc = profile.free_credits
  if (typeof fc !== 'number' || !Number.isFinite(fc)) return 'invalid'
  // ★남은 크레딧이 있어야 본문을 쓸 수 있다 — 본문을 못 쓰는 계정에 제목만 열어 줄 이유가 없다.
  //   (예전 requirePaidPlan 의 `free_credits < 2` 통과는 본문 뒤 부속 기능용이라 여기서는 쓰지 않는다 — 코덱스 10/8)
  if (fc <= 0) return 'exhausted'
  const exp = profile.free_credits_expires_at
  if (exp == null) return 'ok' // NULL = 기한 없음(062 이전 가입자) — consume_free_credit 와 같은 뜻
  const t = Date.parse(exp)
  if (!Number.isFinite(t)) return 'invalid'
  return t > now.getTime() ? 'ok' : 'expired'
}

export function freeTrialPreBodyAllowed(
  profile: { free_credits?: number | null; free_credits_expires_at?: string | null },
  now: Date = new Date(),
): boolean {
  return freeTrialPreBodyVerdict(profile, now) === 'ok'
}
