/**
 * AI 유입 판정 — 순수 함수 (외부 의존: sources.ts 데이터뿐).
 *
 * 이 모듈은 **브라우저 번들에도 실린다**(비콘 컴포넌트가 import). 서버 전용 로직
 * (봇 UA 판정·payload 검증·레이트리밋)은 request.ts 에 따로 둔다 — 클라이언트
 * 번들을 최소로 유지하기 위한 분리다.
 *
 * 판정 신호는 두 가지뿐이며 우선순위가 있다:
 *   1) utm_source 쿼리 — 출처가 명시적으로 붙여준 값. 리퍼러가 제거돼도 살아남는다.
 *   2) Referer 호스트 — utm 이 없는 서비스(Perplexity·Claude 등) 판정용.
 * 둘 다 아니면 null = "AI 유입 아님"이며, 이 경우 아무것도 기록하지 않는다.
 */

import {
  AI_REFERRAL_SOURCES,
  type AiReferralSourceId,
} from './sources.ts';

/**
 * URL 문자열에서 소문자 호스트만 뽑는다. 절대 URL 이 아니거나 파싱 실패면 null.
 * 경로·쿼리·해시는 애초에 버린다 — 리퍼러 경로에는 PII 가 실릴 수 있으므로
 * 호스트 밖으로는 한 글자도 들고 나오지 않는다.
 */
export function extractHost(rawUrl: string | null | undefined): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) return null;
  try {
    const { hostname } = new URL(trimmed);
    const host = hostname.toLowerCase();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

/**
 * 호스트가 대상 도메인과 같거나 그 서브도메인인지.
 * `notperplexity.ai` 같은 접미사 우연 일치를 막기 위해 점 경계를 요구한다.
 */
export function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Referer 호스트로 출처를 판정한다. 모르는 호스트면 null. */
export function classifyReferrerHost(host: string | null): AiReferralSourceId | null {
  if (!host) return null;
  for (const source of AI_REFERRAL_SOURCES) {
    for (const domain of source.hosts) {
      if (hostMatches(host, domain)) return source.id;
    }
  }
  return null;
}

/** utm_source 값으로 출처를 판정한다. 모르는 값이면 null. */
export function classifyUtmSource(utmSource: string | null | undefined): AiReferralSourceId | null {
  if (typeof utmSource !== 'string') return null;
  const value = utmSource.trim().toLowerCase();
  if (value.length === 0) return null;
  for (const source of AI_REFERRAL_SOURCES) {
    if (source.utmSources.includes(value)) return source.id;
  }
  return null;
}

/** 쿼리스트링(`?a=b` 또는 `a=b`)에서 utm_source 값을 꺼낸다. 없으면 null. */
export function readUtmSource(search: string | null | undefined): string | null {
  if (typeof search !== 'string' || search.length === 0) return null;
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    return params.get('utm_source');
  } catch {
    return null;
  }
}

export interface AiReferralSignals {
  /** document.referrer 또는 Referer 헤더 원문 (절대 URL). 없으면 빈 문자열/null. */
  referrer: string | null | undefined;
  /** location.search 또는 요청 URL 의 쿼리스트링. */
  search: string | null | undefined;
}

/**
 * AI 유입 여부를 판정한다. AI 유입이면 출처 id, 아니면 null.
 *
 * utm_source 를 먼저 본다: ChatGPT 처럼 리퍼러를 지우고 utm 만 남기는 경우가
 * 있어 utm 이 더 신뢰도 높은 신호다. utm 이 없거나 모르는 값이면 리퍼러로 판정한다.
 */
export function detectAiReferral(signals: AiReferralSignals): AiReferralSourceId | null {
  const byUtm = classifyUtmSource(readUtmSource(signals.search));
  if (byUtm) return byUtm;
  return classifyReferrerHost(extractHost(signals.referrer));
}
