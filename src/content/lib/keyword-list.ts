/**
 * 키워드 문자열 ↔ 키워드 목록 변환 (순수·외부 의존성 0).
 *
 * 회원은 "핵심 키워드"를 콤마로 여러 개 입력한다 (예: "조원동치과, , 사랑니").
 * saved_posts.keyword 에는 이 원문이 그대로 저장되고, 글 생성 프롬프트도 원문을 쓴다.
 *
 * ★ 그러나 검색·순위추적은 반드시 개별 키워드로 분리해야 한다.
 *   네이버 검색 API 는 "조원동치과, , 사랑니" 를 하나의 질의로 받아
 *   전혀 다른(사실상 아무도 검색하지 않는) 결과집합을 돌려준다.
 *   → 분리하지 않으면 어떤 글도 상위에 잡히지 않아 "항상 100위 밖" 이 된다.
 *   (2026-05~07 두 달간 post_rankings 전 행이 NULL 이었던 직접 원인)
 *
 * 구분자: 반각 콤마(,) + 전각 콤마(，) + 한글 가운뎃점(·). 그 외 문자는 키워드의 일부로 본다
 * ("신대방역 치과" 처럼 공백은 하나의 키워드 안에 정상적으로 들어간다).
 */

/** 한 글에서 추적할 키워드 최대 개수 (호출 예산 방어). */
export const MAX_TRACKED_KEYWORDS = 5;

/** 키워드 1개의 최대 길이 — 네이버 질의로서 의미 있는 상한. */
const MAX_KEYWORD_LENGTH = 80;

const SEPARATOR = /[,，·]/;

/**
 * 키워드 원문을 개별 키워드 배열로 분리한다.
 *
 * - 콤마/전각콤마/가운뎃점으로 분리
 * - 앞뒤 공백 제거, 내부 연속 공백은 1칸으로 축약
 * - 빈 토큰 제거 ("a, , b" → ["a", "b"])
 * - 대소문자 무시 중복 제거 (첫 등장 표기를 유지)
 * - 과도하게 긴 토큰 제거
 * - 최대 limit 개 (기본 MAX_TRACKED_KEYWORDS)
 *
 * 비문자열·빈값은 빈 배열.
 */
export function splitKeywords(raw: unknown, limit: number = MAX_TRACKED_KEYWORDS): string[] {
  if (typeof raw !== 'string') return [];
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : MAX_TRACKED_KEYWORDS;

  const seen = new Set<string>();
  const out: string[] = [];

  for (const token of raw.split(SEPARATOR)) {
    const keyword = token.trim().replace(/\s+/g, ' ');
    if (!keyword) continue;
    if (keyword.length > MAX_KEYWORD_LENGTH) continue;
    const dedupeKey = keyword.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(keyword);
    if (out.length >= max) break;
  }

  return out;
}

/**
 * 추적 대상 "대표 키워드" — 첫 번째 유효 키워드.
 * 키워드 1개만 골라야 하는 자리(검색량 조회 등)에서 쓴다. 없으면 null.
 */
export function primaryKeyword(raw: unknown): string | null {
  return splitKeywords(raw, 1)[0] ?? null;
}

/**
 * 사용자 입력 키워드 원문을 정규화해 다시 문자열로 만든다 ("a, , b" → "a, b").
 * 저장 전 정리용. 유효 키워드가 없으면 빈 문자열.
 */
export function normalizeKeywordInput(raw: unknown, limit: number = MAX_TRACKED_KEYWORDS): string {
  return splitKeywords(raw, limit).join(', ');
}
