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

/**
 * 공개 엔드포인트(/api/funnel-event)에서 허용하는 이벤트 = **저신뢰 의도 이벤트만**.
 *
 * signup_complete·first_post_generated·payment_success 같은 "서버 확정 전환 이벤트"는
 * 익명 클라이언트가 위조하면 지표가 오염되므로 공개 엔드포인트에서 받지 않는다.
 * 이 전환 이벤트들은 각각 서버 라우트(register·generate-content·billing confirm)에서
 * service-role 로만 기록한다(recordFunnelEvent). 여기(공개)는 방문/가입시도 의도만 받는다.
 */
export const PUBLIC_FUNNEL_EVENTS = ['landing_view', 'signup_start'] as const;

export type PublicFunnelEvent = (typeof PUBLIC_FUNNEL_EVENTS)[number];

/** 이벤트명이 전체 화이트리스트에 속하는지 (서버 기록용, 타입 가드). */
export function isFunnelEvent(value: unknown): value is FunnelEvent {
  return typeof value === 'string' && (FUNNEL_EVENTS as readonly string[]).includes(value);
}

/** 이벤트명이 공개 엔드포인트 허용 목록에 속하는지 (타입 가드). */
export function isPublicFunnelEvent(value: unknown): value is PublicFunnelEvent {
  return typeof value === 'string' && (PUBLIC_FUNNEL_EVENTS as readonly string[]).includes(value);
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

/** meta 문자열 값 최대 길이. */
export const MAX_META_STRING = 200;

export type MetaValue = string | number | boolean | null;
export type SanitizedMeta = Record<string, MetaValue> | null;

type MetaValidator = (raw: unknown) => MetaValue | undefined;

/** 문자열 값 검증기 — 비문자열은 드롭, 길이 절단. */
function strMeta(raw: unknown): MetaValue | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.slice(0, MAX_META_STRING);
  return trimmed;
}
/** 유한 숫자 검증기. */
function numMeta(raw: unknown): MetaValue | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}
/** boolean 검증기. */
function boolMeta(raw: unknown): MetaValue | undefined {
  return typeof raw === 'boolean' ? raw : undefined;
}

/**
 * meta(jsonb) 허용 키 화이트리스트 (PII 미저장 원칙 — 마이그 046 주석과 일치).
 *
 * 임의 키(이메일·전화·이름·병원명 등 PII 가능)를 저장하지 못하도록, 이벤트 계측에
 * 필요한 **비-PII 저기수(low-cardinality) 속성만** 명시 허용한다. 그 외 키는 드롭한다.
 *  - path / source / referrer_host : 유입/맥락 (호스트·경로만, 쿼리·PII 아님)
 *  - plan / target_site / hospital_type : 저기수 분류값 (진료과=PII 아님)
 *  - free_credit : 무료 크레딧 사용 여부 (boolean)
 *  - value : 결제 금액 등 수치
 */
const META_KEY_VALIDATORS: Record<string, MetaValidator> = {
  path: strMeta,
  source: strMeta,
  referrer_host: strMeta,
  plan: strMeta,
  target_site: strMeta,
  hospital_type: strMeta,
  free_credit: boolMeta,
  value: numMeta,
};

/** 허용 meta 키 목록 (읽기 전용 노출 — 호출부/테스트 참조용). */
export const ALLOWED_META_KEYS = Object.freeze(Object.keys(META_KEY_VALIDATORS));

/**
 * meta(jsonb) 새니타이즈 — **허용 키 화이트리스트 기반** (PII 유입 차단).
 *  - 객체가 아니면 null
 *  - ALLOWED_META_KEYS 에 없는 키는 전부 드롭
 *  - 각 키는 정해진 타입 검증기를 통과해야 유지 (문자열은 길이 절단)
 *  - 빈 맵은 null 로 정규화
 */
export function sanitizeMeta(input: unknown): SanitizedMeta {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;

  const out: Record<string, MetaValue> = {};
  for (const [key, validate] of Object.entries(META_KEY_VALIDATORS)) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = validate((input as Record<string, unknown>)[key]);
    if (value !== undefined) out[key] = value;
  }

  return Object.keys(out).length === 0 ? null : out;
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
 *
 * allowed 로 허용 이벤트 집합을 주입한다(기본 = 공개 엔드포인트용 저신뢰 이벤트만).
 * 서버 라우트가 전체 이벤트를 검증하려면 FUNNEL_EVENTS 를 넘긴다.
 */
export function validateFunnelBody(
  body: unknown,
  allowed: readonly string[] = PUBLIC_FUNNEL_EVENTS,
): FunnelValidation {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'invalid_body' };
  }
  const { event, meta } = body as { event?: unknown; meta?: unknown };
  if (typeof event !== 'string' || !allowed.includes(event) || !isFunnelEvent(event)) {
    return { ok: false, reason: 'invalid_event' };
  }
  return { ok: true, value: { event, meta: sanitizeMeta(meta) } };
}

// ---------------------------------------------------------------------------
// 레이트리밋 (공개 엔드포인트 남용 방어) — blog-check-limits 와 동일 철학:
// globalThis 인메모리 Map, KST 일 경계, best-effort. 이벤트는 대량 발생하므로
// IP당 상한을 넉넉히 두되(기본 300/일), 전체 상한(기본 20000/일)으로 폭주만 막는다.
//
// ⚠️ 한계(수용된 트레이드오프): 인메모리 카운터는 **서버리스 인스턴스 단위**로만
// 유효하다 — Vercel 이 인스턴스를 여러 개 띄우면 캡이 인스턴스별로 따로 적용되고,
// 콜드스타트 시 리셋된다. 남용 "완화" 목적의 best-effort 이며 정확한 전역 상한이
// 필요해지면 DB/KV 기반으로 교체한다(현 단계 과설계 금지).
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
