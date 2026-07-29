/**
 * 내부 트래픽(우리 팀·대표 본인) 제외 — **순수 로직 모듈** (외부 의존 없음).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ 왜 만들었나 (2026-07-29 실측 근거 — 이 숫자를 지우지 마라)
 *
 * 최근 7일 funnel_events 에서 **로그인 사용자 이벤트 44건이 전부 한 계정**이었다.
 * 그 계정은 광고진정성(대표 본인) 계정이다. 즉 지금 지표에 찍히는 "로그인 활동"은
 * 고객 사용이 아니라 우리가 사이트를 열어본 흔적이다. 봇 필터(bot-user-agent.ts)로
 * 걷어낸 익명 오염과 합치면, 정리 전 지표는 사실상 전부 노이즈였다.
 *
 * 대표는 **로그아웃 상태로도 사이트를 본다**(07/27 14:38 에 로그인 없이 18건을 찍은
 * anon_id 가 내부 활동으로 의심된다). 그래서 두 축으로 막는다:
 *   ① 계정 기반 — FUNNEL_INTERNAL_USER_IDS (env, 콤마 구분)
 *   ② 쿠키 기반 — ?dp_internal=1 로 브라우저·기기마다 한 번 표시 (로그아웃 상태 대비)
 *
 * ⚠️ **실제 고객은 절대 제외하지 않는다.** profiles 에는 실제 고객 계정이 있고
 *    이들의 활동은 반드시 세어야 한다. 그래서 제외 대상을 코드에 하드코딩하지 않고
 *    env 로만 받는다 — 목록이 비면 아무도 제외되지 않는 것이 기본값이다.
 *
 * ★ 두 축의 **역할 분담**(의도적으로 이렇게 나눴다):
 *   - 쿠키(②)는 **로그아웃 상태의 열람**을 막는다. 공개 계측 엔드포인트(/api/funnel-event)와
 *     익명으로 기록되는 diagnosis_email_submitted 에만 적용된다.
 *   - 로그인 상태의 전환 이벤트(signup_complete·payment_success·first_post_generated)는
 *     **계정(①)으로만** 판단한다. 여기에 쿠키까지 얹으면, 옵트아웃 링크가 실수로 걸린
 *     고객 브라우저에서 진짜 가입·결제 전환까지 사라진다 — 되돌릴 수 없는 손실이다.
 *     대신 남는 구멍: 대표가 표시된 브라우저에서 **env 에 없는 새 테스트 계정**으로
 *     가입·결제하면 그 전환은 기록된다. 그 계정 id 를 env 에 추가하면 이후로는 빠진다.
 *
 * ⚠️ 과거 데이터는 소급 정리하지 않았다. 2026-07-29 이전 funnel_events 의 로그인
 *    사용자 수치는 대표 계정이 섞여 있으므로 그대로 인용하지 마라.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// ① 계정 기반 제외
// ---------------------------------------------------------------------------

/** 제외할 내부 계정 목록을 담는 환경변수 이름 (콤마 구분 UUID). */
export const INTERNAL_USER_IDS_ENV = 'FUNNEL_INTERNAL_USER_IDS';

/** Supabase user_id = UUID v4 형식. 이 형식이 아닌 값은 조용히 버린다. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 콤마 구분 문자열 → 정규화된 user_id 목록.
 *
 * ★ 파싱 실패는 **"아무도 제외하지 않음"** 쪽으로 기운다(빈 배열 반환). 반대로
 *   기울면(예: 형식 오류를 통과시켜 부분 일치로 비교) 실제 고객의 이벤트가 조용히
 *   사라지는데, 그건 계측이 아니라 데이터 손실이다. 오염된 지표는 나중에 걷어낼 수
 *   있지만 기록되지 않은 방문은 복구할 수 없다.
 */
export function parseInternalUserIds(raw: string | undefined | null): readonly string[] {
  if (typeof raw !== 'string') return [];
  const seen = new Set<string>();
  for (const piece of raw.split(',')) {
    const id = piece.trim().toLowerCase();
    if (UUID_RE.test(id)) seen.add(id);
  }
  return Object.freeze([...seen]);
}

/** env 에서 내부 계정 목록을 읽는다 (미설정·공백·형식 오류 → 빈 목록, 절대 throw 안 함). */
export function readInternalUserIds(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  return parseInternalUserIds(env[INTERNAL_USER_IDS_ENV]);
}

/**
 * 이 user_id 가 내부 계정인가. 목록이 비면 항상 false(=아무도 제외 안 함).
 * 비교는 **완전 일치**만 한다 — 접두어·부분 일치를 허용하면 무관한 고객이 휩쓸린다.
 */
export function isInternalUserId(
  userId: string | null | undefined,
  internalIds: readonly string[],
): boolean {
  if (typeof userId !== 'string' || userId.length === 0) return false;
  if (internalIds.length === 0) return false;
  return internalIds.includes(userId.toLowerCase());
}

// ---------------------------------------------------------------------------
// ② 쿠키 기반 옵트아웃 (로그아웃 상태 대비)
// ---------------------------------------------------------------------------

/** 내부 트래픽 표시 쿠키 이름. */
export const INTERNAL_COOKIE = 'dp_internal';
/** 쿠키에 담기는 유일한 유효 값. 다른 값은 무시한다(오타로 계측이 꺼지지 않게). */
export const INTERNAL_COOKIE_VALUE = '1';
/** 쿠키 수명 (초) — 1년. 기기·브라우저마다 한 번만 켜면 되도록 길게 잡는다. */
export const INTERNAL_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;
/** 옵트인/해제에 쓰는 쿼리스트링 파라미터 이름. */
export const INTERNAL_OPT_PARAM = 'dp_internal';

/** 이 쿠키 값이 "내부 트래픽" 표시인가. */
export function hasInternalCookie(value: string | null | undefined): boolean {
  return value === INTERNAL_COOKIE_VALUE;
}

/** 쿼리스트링이 요청하는 동작. none = 관여하지 않음(기존 상태 유지). */
export type InternalOptAction = 'enable' | 'disable' | 'none';

/**
 * ?dp_internal= 값 → 동작.
 *
 * ★ 해제(disable)를 반드시 제공한다 — 실수로 켠 브라우저를 되돌릴 방법이 없으면
 *   그 기기의 방문은 영영 집계되지 않는다(httpOnly 라 사용자가 지울 수도 없다).
 * 알 수 없는 값은 'none' 이다: 우연히 같은 이름의 파라미터가 붙은 정상 방문이
 * 계측에서 빠지는 사고를 막는다.
 */
export function resolveInternalOptAction(raw: string | null | undefined): InternalOptAction {
  if (typeof raw !== 'string') return 'none';
  const value = raw.trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'on') return 'enable';
  if (value === '0' || value === 'false' || value === 'off') return 'disable';
  return 'none';
}
