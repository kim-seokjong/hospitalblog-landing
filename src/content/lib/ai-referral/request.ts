/**
 * AI 유입 비콘 — **서버 요청 처리 순수 로직** (DB·프레임워크·crypto 의존 없음).
 *
 * /api/clinic-site/ai-referral 라우트가 쓰는 검증·정규화만 담는다:
 *  - 봇/크롤러 User-Agent 판정 — **판정에만 쓰고 UA 문자열은 DB로 내보내지 않는다**
 *  - 비콘 본문 검증 (slug·source·postId·서명 토큰 형식)
 *  - 서명 대상 문자열 조립 / 만료 창 판정 (HMAC 계산 자체는 서버 crypto 모듈)
 *  - KST 일자 키 생성 (집계 단위)
 *  - DB 로 넘길 인자 조립 — **여기서 만들어지는 필드가 저장되는 전부다**
 *  - 남용 완충용 레이트리밋 (키는 이미 해시된 값만 받는다)
 *
 * ★ 개인정보 원칙(정확한 표현): 이 모듈이 만드는 레코드에는 IP·User-Agent·쿠키·
 *   세션 식별자가 없고 타임스탬프도 없다 — **데이터베이스에 저장되는 것**은 병원
 *   slug · 출처 · 글 id · KST 일자, 그 넷뿐이다. 요청을 처리하는 동안 IP·UA 가
 *   메모리에 스치는 것과 플랫폼(Vercel) 로그에 남는 것까지 없앨 수는 없으므로,
 *   "수집하지 않는다"가 아니라 "DB 에 저장하지 않는다"고 말한다.
 *   레이트리밋 키도 원본 IP 가 아니라 해시된 값만 받는다(아래 consumeAiReferralQuota).
 */

import { validateSlug } from '../clinic-site/slug.ts';
import { isAiReferralSourceId, type AiReferralSourceId } from './sources.ts';

// ---------------------------------------------------------------------------
// 봇 제외
// ---------------------------------------------------------------------------

/**
 * 크롤러·봇 UA 부분 문자열 (소문자 비교).
 * AI 크롤러(GPTBot·ClaudeBot·PerplexityBot 등)를 명시적으로 포함한다 — 이들은
 * "인용을 위한 수집"이지 "사람의 방문"이 아니므로 유입으로 세면 안 된다.
 */
const BOT_UA_MARKERS: readonly string[] = [
  'bot', 'crawler', 'spider', 'slurp', 'scrapy', 'crawl',
  'gptbot', 'oai-searchbot', 'chatgpt-user', 'claudebot', 'claude-web',
  'perplexitybot', 'perplexity-user', 'ccbot', 'bytespider', 'google-extended',
  'headlesschrome', 'phantomjs', 'lighthouse', 'pagespeed',
  'curl/', 'wget', 'python-requests', 'python-httpx', 'axios/', 'node-fetch',
  'go-http-client', 'okhttp', 'java/', 'libwww-perl', 'httpclient',
  'facebookexternalhit', 'preview', 'monitoring', 'uptime',
];

/**
 * 봇/크롤러로 볼 UA 인지. **UA 는 이 판정에만 쓰고 DB 로 내보내지 않는다.**
 * UA 가 비었으면 봇으로 본다 — 정상 브라우저는 항상 UA 를 보낸다.
 */
export function isLikelyBotUserAgent(userAgent: string | null | undefined): boolean {
  if (typeof userAgent !== 'string') return true;
  const ua = userAgent.trim().toLowerCase();
  if (ua.length === 0) return true;
  return BOT_UA_MARKERS.some((marker) => ua.includes(marker));
}

// ---------------------------------------------------------------------------
// 서명 토큰 — "우리 서버가 이 병원의 이 페이지를 실제로 렌더했다"는 증거
// ---------------------------------------------------------------------------

/**
 * 토큰 수명. 비콘은 페이지 마운트 직후(수 초 내) 발사되므로 짧아도 충분하고,
 * 짧을수록 유출된 토큰의 재사용 창이 좁아진다.
 */
export const BEACON_TOKEN_TTL_MS = 10 * 60 * 1000;
/** 서버/클라 시계 오차 허용치. */
export const BEACON_CLOCK_SKEW_MS = 2 * 60 * 1000;
/** HMAC-SHA256 hex 서명 길이. */
export const BEACON_SIGNATURE_LENGTH = 64;

/**
 * 서명 대상 문자열. 병원·글·만료시각을 한데 묶어 서명하므로 남의 병원 slug 나
 * 다른 글로 토큰을 재활용할 수 없다. 구분자(`|`)는 slug(소문자 영숫자·하이픈)·
 * uuid·숫자 어디에도 나타나지 않아 필드 경계가 모호해지지 않는다.
 */
export function buildBeaconSigningInput(
  slug: string,
  postId: string | null,
  exp: number,
): string {
  return `v1|${slug}|${postId ?? ''}|${exp}`;
}

/**
 * 만료시각이 유효한 창 안인지.
 *  - 이미 지난 토큰은 거부 (재사용 창 제한)
 *  - 발급 가능 범위를 넘는 미래값도 거부 (장수명 토큰 위조 시도 차단)
 */
export function isBeaconExpValid(
  exp: number,
  now: number,
  ttlMs: number = BEACON_TOKEN_TTL_MS,
  skewMs: number = BEACON_CLOCK_SKEW_MS,
): boolean {
  if (!Number.isSafeInteger(exp)) return false;
  if (exp < now - skewMs) return false;
  if (exp > now + ttlMs + skewMs) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 비콘 본문 검증
// ---------------------------------------------------------------------------

/** 비콘 본문 최대 바이트 — 이 크기를 넘으면 파싱조차 하지 않는다. */
export const MAX_BEACON_BODY_BYTES = 512;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_SIG_RE = /^[0-9a-f]+$/;

/** 집계에 반영되는 방문 1건 (서명 검증을 통과한 뒤의 값). */
export interface AiReferralVisit {
  /** 병원 블로그 슬러그 (정규화된 소문자). */
  slug: string;
  /** 화이트리스트 통과 출처 id. */
  source: AiReferralSourceId;
  /** 글 상세에서 온 방문이면 글 id, 블로그 홈이면 null. */
  postId: string | null;
}

/** 비콘 본문 파싱 결과 — 서명 대조 전 단계. */
export interface ParsedBeacon extends AiReferralVisit {
  /** 토큰 만료시각 (epoch ms). */
  exp: number;
  /** HMAC-SHA256 hex 서명. */
  token: string;
}

export type BeaconRejectReason =
  | 'invalid_body'
  | 'invalid_slug'
  | 'invalid_source'
  | 'invalid_post'
  | 'invalid_token';

export type BeaconParseResult =
  | { ok: true; value: ParsedBeacon }
  | { ok: false; reason: BeaconRejectReason };

/**
 * 비콘 본문(신뢰 불가 외부 입력)을 검증한다. 서명 자체의 대조는 서버 crypto 모듈이 한다.
 * 잘못된 postId 는 null 로 뭉개지 않고 거부한다 — 홈 방문으로 오귀속되면
 * 글별 지표가 조용히 오염되기 때문이다.
 */
export function parseAiReferralBeacon(body: unknown): BeaconParseResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'invalid_body' };
  }
  const { slug, source, postId, exp, token } = body as {
    slug?: unknown;
    source?: unknown;
    postId?: unknown;
    exp?: unknown;
    token?: unknown;
  };

  if (typeof slug !== 'string') return { ok: false, reason: 'invalid_slug' };
  const validated = validateSlug(slug);
  if (!validated.ok) return { ok: false, reason: 'invalid_slug' };

  if (!isAiReferralSourceId(source)) return { ok: false, reason: 'invalid_source' };

  let normalizedPostId: string | null = null;
  if (postId !== undefined && postId !== null) {
    if (typeof postId !== 'string' || !UUID_RE.test(postId)) {
      return { ok: false, reason: 'invalid_post' };
    }
    normalizedPostId = postId.toLowerCase();
  }

  if (typeof exp !== 'number' || !Number.isSafeInteger(exp)) {
    return { ok: false, reason: 'invalid_token' };
  }
  if (
    typeof token !== 'string'
    || token.length !== BEACON_SIGNATURE_LENGTH
    || !HEX_SIG_RE.test(token)
  ) {
    return { ok: false, reason: 'invalid_token' };
  }

  return {
    ok: true,
    value: { slug: validated.slug, source, postId: normalizedPostId, exp, token },
  };
}

/** JSON 문자열 본문을 크기 검사 후 파싱한다 (sendBeacon 은 text/plain 으로도 온다). */
export function parseAiReferralBeaconText(raw: string): BeaconParseResult {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_BEACON_BODY_BYTES) {
    return { ok: false, reason: 'invalid_body' };
  }
  try {
    return parseAiReferralBeacon(JSON.parse(raw));
  } catch {
    return { ok: false, reason: 'invalid_body' };
  }
}

// ---------------------------------------------------------------------------
// 집계 단위 (KST 일자)
// ---------------------------------------------------------------------------

/**
 * KST(UTC+9) 기준 날짜 키 (yyyy-mm-dd). 집계 grain 이자 원장이 보는 날짜 기준.
 * UTC 로 저장하면 한국 시간 오전 0~9시 방문이 전날로 밀려 원장 체감과 어긋난다.
 */
export function kstDateKey(now: number = Date.now()): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// DB 로 나가는 값 — ★ 저장되는 필드의 단일 정의 지점
// ---------------------------------------------------------------------------

/**
 * record_clinic_ai_referral RPC 인자. **이 4개가 저장되는 전부다.**
 * 필드를 늘릴 때는 개인정보 판단을 반드시 다시 한다(마이그 051 주석 참조).
 * 특히 타임스탬프류는 절대 추가하지 않는다 — 소수 셀에서는 그 값이 곧 개인의
 * 방문 시각이 된다(첫 리뷰에서 차단된 실제 사례).
 */
export interface AiReferralRecordArgs {
  p_slug: string;
  p_source: AiReferralSourceId;
  p_post_id: string | null;
  p_visit_date: string;
}

/** 허용 필드 목록 — 테스트가 이 목록으로 "그 외 필드 없음"을 고정한다. */
export const AI_REFERRAL_RECORD_KEYS: readonly string[] = [
  'p_slug',
  'p_source',
  'p_post_id',
  'p_visit_date',
];

/** 검증된 방문 + 시각 → RPC 인자. 방문자 식별 정보는 입력으로도 받지 않는다. */
export function buildAiReferralRecord(
  visit: AiReferralVisit,
  now: number = Date.now(),
): AiReferralRecordArgs {
  return {
    p_slug: visit.slug,
    p_source: visit.source,
    p_post_id: visit.postId,
    p_visit_date: kstDateKey(now),
  };
}

// ---------------------------------------------------------------------------
// 마이그레이션 미적용 폴백
// ---------------------------------------------------------------------------

/**
 * "스키마가 아직 없다"를 뜻하는 Postgres/PostgREST 오류 코드.
 * 마이그 051 은 사람이 수동 적용하므로, 미적용 상태에서도 코드가 죽지 않고
 * 조용히 no-op 해야 한다(기존 42P01 폴백 관행과 동일).
 *   42P01    — undefined_table (테이블 없음)
 *   42883    — undefined_function (RPC 없음)
 *   PGRST202 — PostgREST 스키마 캐시에 함수 없음
 */
export const MISSING_SCHEMA_ERROR_CODES: readonly string[] = ['42P01', '42883', 'PGRST202'];

/** 오류 코드가 "마이그 미적용"에 해당하는지. */
export function isMissingSchemaErrorCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && MISSING_SCHEMA_ERROR_CODES.includes(code);
}

// ---------------------------------------------------------------------------
// 레이트리밋 — 방어가 아니라 **완충재**
// ---------------------------------------------------------------------------

/**
 * ⚠️ 이것은 위조 방어가 아니다. 위조 방어는 HMAC 서명 토큰이 담당한다.
 * 서버리스에서 인메모리 카운터는 인스턴스마다 따로 존재하고 cold start 마다
 * 초기화되므로 전역 상한을 보장할 수 없다. 여기서 노리는 것은 "한 발신원이
 * 짧은 시간에 같은 병원을 두드리는" 저비용 남용의 속도를 늦추는 것뿐이다.
 *
 * 전역(전체) 상한을 두지 않는 이유: 인스턴스 하나의 전역 카운터를 소진시키면
 * **정상 방문자의 집계까지 막히는 DoS** 가 된다. 병원 단위 상한도 같은 이유로
 * 두지 않는다 — 경쟁 병원이 상대 병원의 하루치 집계를 고갈시킬 수 있기 때문이다.
 * 모든 키를 발신원(해시된 IP) 기준으로만 잡아 피해가 남에게 번지지 않게 한다.
 */
export const DEFAULT_AI_REFERRAL_IP_DAILY_LIMIT = 120;
/** 같은 발신원이 **한 병원**에 대해 하루에 남길 수 있는 최대 건수. */
export const DEFAULT_AI_REFERRAL_IP_CLINIC_DAILY_LIMIT = 30;

export interface AiReferralLimits {
  ipDaily: number;
  ipClinicDaily: number;
}

export type AiReferralRateDecision =
  | { allowed: true }
  | { allowed: false; reason: 'ip_limit' | 'ip_clinic_limit' };

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** env 에서 캡을 읽는다 (비정상 값은 기본값, 절대 throw 안 함). */
export function readAiReferralLimits(env: NodeJS.ProcessEnv = process.env): AiReferralLimits {
  return {
    ipDaily: parsePositiveInt(env.AI_REFERRAL_IP_DAILY_LIMIT, DEFAULT_AI_REFERRAL_IP_DAILY_LIMIT),
    ipClinicDaily: parsePositiveInt(
      env.AI_REFERRAL_IP_CLINIC_DAILY_LIMIT,
      DEFAULT_AI_REFERRAL_IP_CLINIC_DAILY_LIMIT,
    ),
  };
}

/**
 * 쿼터 검사·소비 (검사·소비 원자).
 *
 * ★ ipKey 는 **이미 해시된 값**이어야 한다 — 원본 IP 를 넘기면 그 값이 Map 키로
 *   하루치 메모리에 남는다. 해싱은 서버 모듈(ai-referral-crypto.ts)이 담당한다.
 */
export function consumeAiReferralQuota(
  store: Map<string, number>,
  input: { ipKey: string; slug: string; now?: number; limits?: AiReferralLimits },
): AiReferralRateDecision {
  const now = input.now ?? Date.now();
  const limits = input.limits ?? {
    ipDaily: DEFAULT_AI_REFERRAL_IP_DAILY_LIMIT,
    ipClinicDaily: DEFAULT_AI_REFERRAL_IP_CLINIC_DAILY_LIMIT,
  };
  const day = kstDateKey(now);
  const origin = input.ipKey || 'unknown';
  const ipKey = `ip:${day}:${origin}`;
  const ipClinicKey = `ipc:${day}:${origin}:${input.slug}`;

  // 지난 날짜 키 정리 (무한 성장 방지)
  const dayMarker = `:${day}:`;
  for (const key of store.keys()) {
    if (!key.includes(dayMarker)) store.delete(key);
  }

  const ipCount = store.get(ipKey) ?? 0;
  const ipClinicCount = store.get(ipClinicKey) ?? 0;

  if (ipCount >= limits.ipDaily) return { allowed: false, reason: 'ip_limit' };
  if (ipClinicCount >= limits.ipClinicDaily) {
    return { allowed: false, reason: 'ip_clinic_limit' };
  }

  store.set(ipKey, ipCount + 1);
  store.set(ipClinicKey, ipClinicCount + 1);
  return { allowed: true };
}
