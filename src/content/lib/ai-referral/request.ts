/**
 * AI 유입 비콘 — **서버 요청 처리 순수 로직** (DB·프레임워크 의존 없음).
 *
 * /api/clinic-site/ai-referral 라우트가 쓰는 검증·정규화만 담는다:
 *  - 봇/크롤러 User-Agent 판정 — **판정에만 쓰고 UA 문자열은 어디에도 저장하지 않는다**
 *  - 비콘 본문 검증 (slug·source·postId 화이트리스트)
 *  - KST 일자 키 생성 (집계 단위)
 *  - DB 로 넘길 인자 조립 — **여기서 만들어지는 필드가 저장되는 전부다**
 *  - 남용 방어용 레이트리밋 (funnel-events 의 범용 쿼터 로직 재사용)
 *
 * ★ 개인정보 원칙: 이 모듈이 만드는 레코드에는 IP·User-Agent·쿠키·세션 식별자가
 *   없다. 병원(slug) · 출처 · 글 id · 일자, 그 넷뿐이다. 레이트리밋에 쓰는 IP 는
 *   프로세스 메모리 카운터 키로만 소비되고 DB 로 나가지 않는다.
 */

import { validateSlug } from '../clinic-site/slug.ts';
import { consumeFunnelQuota, type FunnelLimits, type FunnelRateDecision } from '../funnel-events.ts';
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
 * 봇/크롤러로 볼 UA 인지. **UA 는 이 판정 이후 즉시 버린다(저장 금지).**
 * UA 가 비었으면 봇으로 본다 — 정상 브라우저는 항상 UA 를 보낸다.
 */
export function isLikelyBotUserAgent(userAgent: string | null | undefined): boolean {
  if (typeof userAgent !== 'string') return true;
  const ua = userAgent.trim().toLowerCase();
  if (ua.length === 0) return true;
  return BOT_UA_MARKERS.some((marker) => ua.includes(marker));
}

// ---------------------------------------------------------------------------
// 비콘 본문 검증
// ---------------------------------------------------------------------------

/** 비콘 본문 최대 바이트 — 이 크기를 넘으면 파싱조차 하지 않는다. */
export const MAX_BEACON_BODY_BYTES = 512;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AiReferralBeacon {
  /** 병원 블로그 슬러그 (정규화된 소문자). */
  slug: string;
  /** 화이트리스트 통과 출처 id. */
  source: AiReferralSourceId;
  /** 글 상세에서 온 방문이면 글 id, 블로그 홈이면 null. */
  postId: string | null;
}

export type BeaconParseResult =
  | { ok: true; value: AiReferralBeacon }
  | { ok: false; reason: 'invalid_body' | 'invalid_slug' | 'invalid_source' | 'invalid_post' };

/**
 * 비콘 본문(신뢰 불가 외부 입력)을 검증한다.
 * 잘못된 postId 는 null 로 뭉개지 않고 거부한다 — 홈 방문으로 오귀속되면
 * 글별 지표가 조용히 오염되기 때문이다.
 */
export function parseAiReferralBeacon(body: unknown): BeaconParseResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'invalid_body' };
  }
  const { slug, source, postId } = body as {
    slug?: unknown;
    source?: unknown;
    postId?: unknown;
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

  return { ok: true, value: { slug: validated.slug, source, postId: normalizedPostId } };
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
 * 필드를 늘릴 때는 개인정보 판단을 반드시 다시 한다(마이그 048 주석 참조).
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

/** 검증된 비콘 + 시각 → RPC 인자. 방문자 식별 정보는 입력으로도 받지 않는다. */
export function buildAiReferralRecord(
  beacon: AiReferralBeacon,
  now: number = Date.now(),
): AiReferralRecordArgs {
  return {
    p_slug: beacon.slug,
    p_source: beacon.source,
    p_post_id: beacon.postId,
    p_visit_date: kstDateKey(now),
  };
}

// ---------------------------------------------------------------------------
// 마이그레이션 미적용 폴백
// ---------------------------------------------------------------------------

/**
 * "스키마가 아직 없다"를 뜻하는 Postgres/PostgREST 오류 코드.
 * 마이그 048 은 사람이 수동 적용하므로, 미적용 상태에서도 코드가 죽지 않고
 * 조용히 no-op 해야 한다(기존 42P01 폴백 관행과 동일).
 *   42P01   — undefined_table (테이블 없음)
 *   42883   — undefined_function (RPC 없음)
 *   PGRST202 — PostgREST 스키마 캐시에 함수 없음
 */
export const MISSING_SCHEMA_ERROR_CODES: readonly string[] = ['42P01', '42883', 'PGRST202'];

/** 오류 코드가 "마이그 미적용"에 해당하는지. */
export function isMissingSchemaErrorCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && MISSING_SCHEMA_ERROR_CODES.includes(code);
}

// ---------------------------------------------------------------------------
// 레이트리밋 (공개 엔드포인트 남용 방어)
// ---------------------------------------------------------------------------

/**
 * funnel-events 의 범용 일일 쿼터 로직을 그대로 재사용한다(인메모리·KST 일 경계·
 * best-effort). 캡만 AI 유입용으로 따로 잡는다 — AI 유입은 원래 희소해서
 * 정상 트래픽이 캡에 닿을 일이 없고, 위조 시도만 걸러내면 된다.
 *
 * ⚠️ 한계: 서버리스 인스턴스 단위 카운터라 전역 정확도는 없다(funnel 과 동일).
 */
export const DEFAULT_AI_REFERRAL_IP_DAILY_LIMIT = 60;
export const DEFAULT_AI_REFERRAL_GLOBAL_DAILY_LIMIT = 5000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** env 에서 캡을 읽는다 (비정상 값은 기본값, 절대 throw 안 함). */
export function readAiReferralLimits(env: NodeJS.ProcessEnv = process.env): FunnelLimits {
  return {
    ipDaily: parsePositiveInt(env.AI_REFERRAL_IP_DAILY_LIMIT, DEFAULT_AI_REFERRAL_IP_DAILY_LIMIT),
    globalDaily: parsePositiveInt(
      env.AI_REFERRAL_GLOBAL_DAILY_LIMIT,
      DEFAULT_AI_REFERRAL_GLOBAL_DAILY_LIMIT,
    ),
  };
}

/**
 * 쿼터 검사·소비. ip 는 **카운터 키로만** 쓰이고 저장되지 않는다.
 * store 는 호출부가 소유하는 globalThis 인메모리 Map.
 */
export function consumeAiReferralQuota(
  store: Map<string, number>,
  input: { ip: string; now?: number; limits?: FunnelLimits },
): FunnelRateDecision {
  return consumeFunnelQuota(store, {
    ip: input.ip,
    now: input.now,
    limits: input.limits ?? {
      ipDaily: DEFAULT_AI_REFERRAL_IP_DAILY_LIMIT,
      globalDaily: DEFAULT_AI_REFERRAL_GLOBAL_DAILY_LIMIT,
    },
  });
}
