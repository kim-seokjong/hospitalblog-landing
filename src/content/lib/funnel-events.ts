/**
 * 자체 퍼널 이벤트 — 순수 로직 모듈 (외부 의존 없음, node:test 로 직접 검증 가능).
 *
 * 획득 퍼널(방문→가입→활성화→유료) 병목을 우리가 직접 소유·쿼리하기 위한 계측.
 * Meta 픽셀(광고 최적화용)과 **병행**한다 — 중복이 아니라 목적이 다르다.
 *
 * 이 모듈은 검증만 담당한다(순수 함수):
 *  - 이벤트명 화이트리스트 (남용·오염 방지 — 임의 이벤트 적재 차단)
 *  - anon_id 형식 검증/생성 (쿠키 기반 익명 식별자)
 *  - meta(jsonb) 크기·형태 새니타이즈 (거대 payload·중첩 폭탄 방어)
 *  - 인메모리 레이트리밋 판정 (공개 엔드포인트 남용 방어, blog-check-limits 패턴)
 *
 * DB 적재(service role insert)와 쿠키 I/O 는 호출부(라우트)가 담당한다.
 */

/** 적재를 허용하는 퍼널 이벤트 종류 (화이트리스트 — 이 외 이벤트는 거부). */
export const FUNNEL_EVENTS = [
  'landing_view',
  'signup_start',
  'signup_complete',
  'first_post_generated',
  'payment_success',
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/** 이벤트명이 화이트리스트에 속하는지 (타입 가드). */
export function isFunnelEvent(value: unknown): value is FunnelEvent {
  return typeof value === 'string' && (FUNNEL_EVENTS as readonly string[]).includes(value);
}

/** anon_id 쿠키 이름 — 브라우저·서버 공통 상수. */
export const ANON_ID_COOKIE = 'dp_anon_id';
/** anon_id 쿠키 수명 (초) — 1년. */
export const ANON_ID_MAX_AGE_SEC = 60 * 60 * 24 * 365;

/**
 * anon_id 형식 검증 — 32자리 소문자 hex (crypto.randomUUID 파생 또는 자체 생성).
 * 위조/오염된 쿠키 값을 그대로 DB에 적재하지 않도록 엄격 검증한다.
 */
export function isValidAnonId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

/**
 * 32자리 hex anon_id 생성. randomFn 은 [0,1) 난수 공급자(주입 가능 — 테스트용).
 * 기본은 Math.random (익명 식별자라 암호학적 강도 불필요).
 */
export function generateAnonId(randomFn: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    out += Math.floor(randomFn() * 16).toString(16);
  }
  return out;
}

/** meta payload 상한 — 직렬화 후 이 바이트를 넘으면 거부(거대 payload 방어). */
export const MAX_META_BYTES = 2048;

export type MetaValue = string | number | boolean | null;
export type SanitizedMeta = Record<string, MetaValue> | null;

/**
 * meta(jsonb) 새니타이즈 — 1단 깊이의 원시값 맵만 허용한다.
 *  - 객체가 아니면 null
 *  - 값이 string/number(유한)/boolean/null 이 아닌 키는 제거 (중첩·함수·배열 차단)
 *  - 문자열 값은 200자로 절단
 *  - 직렬화 크기가 MAX_META_BYTES 초과면 null (안전측 — 이벤트 자체는 기록)
 *  - 빈 맵은 null 로 정규화
 */
export function sanitizeMeta(input: unknown): SanitizedMeta {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;

  const out: Record<string, MetaValue> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 64) continue;
    if (typeof raw === 'string') {
      out[key] = raw.slice(0, 200);
    } else if (typeof raw === 'number') {
      if (Number.isFinite(raw)) out[key] = raw;
    } else if (typeof raw === 'boolean' || raw === null) {
      out[key] = raw;
    }
    // 그 외(객체·배열·함수·undefined)는 조용히 제거
  }

  const keys = Object.keys(out);
  if (keys.length === 0) return null;

  try {
    const bytes = Buffer.byteLength(JSON.stringify(out), 'utf8');
    if (bytes > MAX_META_BYTES) return null;
  } catch {
    return null;
  }
  return out;
}

export interface ValidatedFunnelEvent {
  event: FunnelEvent;
  meta: SanitizedMeta;
}

export type FunnelValidation =
  | { ok: true; value: ValidatedFunnelEvent }
  | { ok: false; reason: 'invalid_event' | 'invalid_body' };

/**
 * 요청 본문 검증 — 라우트가 파싱한 JSON 을 받아 이벤트명·meta 를 검증한다.
 * body 는 신뢰 불가 외부 입력이므로 unknown 으로 받아 안전하게 좁힌다.
 */
export function validateFunnelBody(body: unknown): FunnelValidation {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'invalid_body' };
  }
  const { event, meta } = body as { event?: unknown; meta?: unknown };
  if (!isFunnelEvent(event)) return { ok: false, reason: 'invalid_event' };
  return { ok: true, value: { event, meta: sanitizeMeta(meta) } };
}

// ---------------------------------------------------------------------------
// 레이트리밋 (공개 엔드포인트 남용 방어) — blog-check-limits 와 동일 철학:
// globalThis 인메모리 Map, KST 일 경계, best-effort. 이벤트는 대량 발생하므로
// IP당 상한을 넉넉히 두되(기본 300/일), 전체 상한(기본 20000/일)으로 폭주만 막는다.
// ---------------------------------------------------------------------------

/** IP당 일일 기본 캡. env: FUNNEL_IP_DAILY_LIMIT */
export const DEFAULT_FUNNEL_IP_DAILY_LIMIT = 300;
/** 전체 일일 기본 캡. env: FUNNEL_GLOBAL_DAILY_LIMIT */
export const DEFAULT_FUNNEL_GLOBAL_DAILY_LIMIT = 20000;

export interface FunnelLimits {
  ipDaily: number;
  globalDaily: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** env 에서 캡을 읽는다 (비정상 값은 기본값, 절대 throw 안 함). */
export function readFunnelLimits(env: NodeJS.ProcessEnv = process.env): FunnelLimits {
  return {
    ipDaily: parsePositiveInt(env.FUNNEL_IP_DAILY_LIMIT, DEFAULT_FUNNEL_IP_DAILY_LIMIT),
    globalDaily: parsePositiveInt(env.FUNNEL_GLOBAL_DAILY_LIMIT, DEFAULT_FUNNEL_GLOBAL_DAILY_LIMIT),
  };
}

/** KST(UTC+9) 기준 날짜 키 (yyyy-mm-dd). */
export function funnelKstDayKey(now: number = Date.now()): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type FunnelRateDecision =
  | { allowed: true }
  | { allowed: false; reason: 'ip_limit' | 'global_limit' };

/**
 * 캡 검사 후 통과 시 카운터 소비 (검사·소비 원자). store 는 key→count Map.
 * 지난 날짜 키는 정리한다(무한 성장 방지).
 */
export function consumeFunnelQuota(
  store: Map<string, number>,
  input: { ip: string; now?: number; limits?: FunnelLimits },
): FunnelRateDecision {
  const now = input.now ?? Date.now();
  const limits = input.limits ?? {
    ipDaily: DEFAULT_FUNNEL_IP_DAILY_LIMIT,
    globalDaily: DEFAULT_FUNNEL_GLOBAL_DAILY_LIMIT,
  };
  const day = funnelKstDayKey(now);
  const ipKey = `ip:${day}:${input.ip || 'unknown'}`;
  const globalKey = `global:${day}`;

  const prefixIp = `ip:${day}:`;
  for (const key of store.keys()) {
    if (key === globalKey || key.startsWith(prefixIp)) continue;
    store.delete(key);
  }

  const ipCount = store.get(ipKey) ?? 0;
  const globalCount = store.get(globalKey) ?? 0;

  if (globalCount >= limits.globalDaily) return { allowed: false, reason: 'global_limit' };
  if (ipCount >= limits.ipDaily) return { allowed: false, reason: 'ip_limit' };

  store.set(ipKey, ipCount + 1);
  store.set(globalKey, globalCount + 1);
  return { allowed: true };
}
