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

/**
 * ★무료 체험 계정이 **본문 뒤 부속 기능**(이미지·이미지 재생성·태그·카드뉴스·독창성 검사·스타일)을 써도 되는가 — 순수 함수.
 *
 * 2026-10-13 대표 결정(W42 Codex 지적 ②): 예전 requirePaidPlan 은 `free_credits < 2` 면 통과시켜,
 *   체험을 다 쓴 계정(0)·재가입 회수 계정(가입 즉시 0, 본문 0편)이 부속 기능을 **기한·횟수 없이** 썼다(외부 API 비용).
 * ⇒ 「최근 FREE_TRIAL_ACCESSORY_WINDOW_MS 안에 실제로 쓴 무료 본문」이 있을 때만, 본문 1편당 PER_POST 건까지 연다.
 *   본문 수는 크레딧 사용분(2 - 잔여)을 넘지 못한다 — 회수 계정은 본문 로그가 없어 닫힌다.
 *   ⚠️사용 로그는 응답 뒤 비동기로 쌓여 연타 몇 건은 넘을 수 있다 — 비용 상한용 느슨한 문턱이다.
 */
export type FreeTrialAccessoryVerdict = 'ok' | 'no_body' | 'capped' | 'invalid'

/** 무료 본문 뒤 부속 기능을 열어 두는 시간 — 글을 다 쓰고 이미지·태그를 붙이기에 충분한 3일. */
export const FREE_TRIAL_ACCESSORY_WINDOW_MS = 72 * 60 * 60 * 1000

/** 무료 본문 1편당 부속 기능 사용 로그 상한. 보통 한 편에 10건 안팎(이미지 1회 = 로그 2건)이다. */
export const FREE_TRIAL_ACCESSORY_PER_POST = 30

/** 부속 기능으로 세는 usage_logs.feature 값 — requirePaidPlan 을 쓰는 라우트는 전부 여기 있고 로그를 await 해야 상한이 선다. */
export const FREE_TRIAL_ACCESSORY_FEATURES = [
  'generate-images',
  'regenerate-image',
  'generate-tags',
  'generate-cardnews-slides',
  'check-originality',
  'generate-style',
] as const

export function freeTrialAccessoryVerdict(input: {
  freeCredits: unknown
  recentBodies: number
  recentAccessories: number
}): FreeTrialAccessoryVerdict {
  const fc = input.freeCredits
  if (typeof fc !== 'number' || !Number.isFinite(fc)) return 'invalid'
  if (!Number.isFinite(input.recentBodies) || !Number.isFinite(input.recentAccessories)) return 'invalid'
  const usedCredits = Math.max(0, FREE_TRIAL_CREDITS_TOTAL - fc)
  const bodies = Math.min(Math.max(0, input.recentBodies), usedCredits)
  if (bodies <= 0) return 'no_body'
  return input.recentAccessories >= bodies * FREE_TRIAL_ACCESSORY_PER_POST ? 'capped' : 'ok'
}

export function freeTrialPreBodyAllowed(
  profile: { free_credits?: number | null; free_credits_expires_at?: string | null },
  now: Date = new Date(),
): boolean {
  return freeTrialPreBodyVerdict(profile, now) === 'ok'
}
