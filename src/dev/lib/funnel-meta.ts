/**
 * 퍼널 이벤트 클라이언트 meta 정규화 — 순수 로직 모듈 (DOM·fetch 의존 없음).
 *
 * 서버(src/content/lib/funnel-events.ts EVENT_META_VALIDATORS)가 최종 검증하지만,
 * 클라이언트도 규칙에 맞는 값만 보내도록 가볍게 정규화한다:
 *  - path: 쿼리스트링·해시 제거(PII 가능 영역 미전송), 경로 문자만
 *  - referrer_host: 리퍼러 **호스트명만**(전체 URL 절대 금지), 자기 도메인이면 생략
 *  - source: utm_source 값이 소문자 토큰 형식일 때만
 *
 * 아래 형식 상수는 서버 검증기(PATH_RE·TOKEN_RE·HOST_RE·MAX_META_STRING)의 미러다.
 * 서버 쪽 규칙이 바뀌면 여기도 함께 갱신한다 — 값 import 를 하지 않는 이유는
 * node --experimental-strip-types 테스트에서 경로 별칭('@/') 해석 없이 실행하기 위함.
 */

import type { PublicFunnelEvent } from '@/content/lib/funnel-events';

/** 서버 MAX_META_STRING 미러 — meta 문자열 값 최대 길이. */
const MAX_META_STRING = 200;
/** 서버 pathMeta(PATH_RE) 미러 — 쿼리·해시 제거 후 경로 문자만. */
const PATH_RE = /^\/[A-Za-z0-9\-._~/%]*$/;
/** 서버 tokenMeta(TOKEN_RE) 미러 — 소문자 토큰(enum성 값). */
const TOKEN_RE = /^[a-z0-9_-]{1,32}$/;
/** 서버 hostMeta(HOST_RE) 미러 — 호스트명 문자만. */
const HOST_RE = /^[A-Za-z0-9.-]{1,100}$/;

/**
 * 경로 정규화 — 쿼리스트링·해시를 제거(개인정보 가능성 있는 쿼리 절대 미포함)하고
 * 서버 경로 형식을 통과하는 값만 반환. 아니면 undefined(생략).
 */
export function normalizeFunnelPath(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const path = raw.split(/[?#]/)[0].slice(0, MAX_META_STRING);
  return PATH_RE.test(path) ? path : undefined;
}

/**
 * 리퍼러 → 호스트명만 추출 (전체 URL 미전송 — PII 차단).
 * 리퍼러가 없거나, 파싱 불가거나, 자기 도메인(ownHostname 과 동일)이면 undefined(생략).
 */
export function normalizeReferrerHost(
  referrer: string | null | undefined,
  ownHostname: string | null | undefined,
): string | undefined {
  if (typeof referrer !== 'string' || referrer.length === 0) return undefined;
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return undefined; // 상대 URL·깨진 값 등 — 추측하지 않고 생략
  }
  if (!host || !HOST_RE.test(host)) return undefined;
  const own = typeof ownHostname === 'string' ? ownHostname.toLowerCase() : '';
  if (own && host === own) return undefined; // 자기 도메인 내 이동은 유입 출처가 아님
  return host;
}

/**
 * URL 쿼리스트링에서 utm_source 추출 — 소문자 정규화 후 토큰 형식 통과 시에만 반환.
 * (대문자 utm_source 는 소문자화로 살리고, 자유 문자열·PII 성 값은 거부.)
 */
export function normalizeUtmSource(search: string | null | undefined): string | undefined {
  if (typeof search !== 'string' || search.length === 0) return undefined;
  const raw = new URLSearchParams(search).get('utm_source');
  if (!raw) return undefined;
  const token = raw.trim().toLowerCase();
  return TOKEN_RE.test(token) ? token : undefined;
}

/** 클라이언트 환경 스냅샷 — trackFunnel 이 window/document 에서 읽어 넘긴다. */
export interface ClientFunnelContext {
  pathname?: string | null;
  search?: string | null;
  referrer?: string | null;
  ownHostname?: string | null;
}

/**
 * 공개 퍼널 이벤트(landing_view·signup_start)용 자동 meta 조립.
 * 서버 화이트리스트가 허용하는 키만 만든다:
 *  - landing_view: path·source·referrer_host
 *  - signup_start: path·source (referrer_host 는 서버가 안 받으므로 애초에 안 보냄)
 * 유효한 값이 하나도 없으면 빈 객체.
 */
export function buildPublicFunnelMeta(
  event: PublicFunnelEvent,
  ctx: ClientFunnelContext,
): Record<string, string> {
  const out: Record<string, string> = {};

  const path = normalizeFunnelPath(ctx.pathname);
  if (path !== undefined) out.path = path;

  const source = normalizeUtmSource(ctx.search);
  if (source !== undefined) out.source = source;

  if (event === 'landing_view') {
    const referrerHost = normalizeReferrerHost(ctx.referrer, ctx.ownHostname);
    if (referrerHost !== undefined) out.referrer_host = referrerHost;
  }

  return out;
}
