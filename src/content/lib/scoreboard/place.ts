import { searchNaverLocal, type NaverLocalResult } from '@/dev/lib/naver-search';
import { BROWSER_UA, fetchWithTimeout, parseCount } from '@/content/lib/scoreboard/fetch-utils';

/**
 * 플레이스 상위노출 + 리뷰 수 (하이브리드).
 *
 * 1차(안전): 네이버 지역검색 OpenAPI(local.json) 톱5 — 기존 /api/clinic/lookup 키 재사용.
 * 2차(베스트에포트): 네이버 지도 공개 검색 JSON에서 순위(5위 밖 포함)와
 *   방문자리뷰·블로그리뷰 수 추출을 "시도"한다. 응답 구조가 언제든 바뀔 수 있으므로
 *   전 구간 방어적 파싱 + 실패 시 조용히 null 반환 (1차 결과만 표시).
 *
 * 킬스위치: env PLACE_DEEP_LOOKUP=off 면 2차를 완전 비활성화한다.
 */

export interface PlaceDeepItem {
  rank: number;           // 1부터
  name: string;
  visitorReviews: number | null;
  blogReviews: number | null;
}

export const PLACE_DEEP_MAX_ITEMS = 10;

export function isPlaceDeepEnabled(): boolean {
  return (process.env.PLACE_DEEP_LOOKUP ?? '').trim().toLowerCase() !== 'off';
}

/** 1차: 지역검색 톱5. 키 없음/실패 시 [] (graceful). */
export async function fetchPlaceTopFive(query: string): Promise<NaverLocalResult[]> {
  return searchNaverLocal(query, 5);
}

/** 병원명 정규화 매칭용 (공백·괄호 제거) */
export function normalizeHospitalName(name: string): string {
  return name.replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim();
}

/** 목록에서 내 병원 순위(1부터) 찾기. 없으면 null. */
export function findHospitalRank(names: readonly string[], hospitalName: string): number | null {
  const target = normalizeHospitalName(hospitalName);
  if (!target) return null;
  const idx = names.findIndex((n) => {
    const candidate = normalizeHospitalName(n);
    return candidate.length > 0 && (candidate.includes(target) || target.includes(candidate));
  });
  return idx >= 0 ? idx + 1 : null;
}

// ── 2차 (베스트에포트) ─────────────────────────────────────────

interface RawPlaceItem {
  name?: string;
  visitorReviewCount?: string | number;
  placeReviewCount?: string | number;
  blogCafeReviewCount?: string | number;
  reviewCount?: string | number;
}

/** 응답 JSON 어딘가의 place 목록을 방어적으로 찾는다. */
function extractPlaceList(json: unknown): RawPlaceItem[] {
  if (typeof json !== 'object' || json === null) return [];
  const result = (json as Record<string, unknown>).result;
  if (typeof result !== 'object' || result === null) return [];
  const place = (result as Record<string, unknown>).place;
  if (typeof place !== 'object' || place === null) return [];
  const list = (place as Record<string, unknown>).list;
  return Array.isArray(list) ? (list as RawPlaceItem[]) : [];
}

export function parseDeepItems(json: unknown): PlaceDeepItem[] {
  const list = extractPlaceList(json);
  const items: PlaceDeepItem[] = [];
  for (let i = 0; i < list.length && items.length < PLACE_DEEP_MAX_ITEMS; i++) {
    const raw = list[i];
    if (typeof raw !== 'object' || raw === null) continue;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;
    items.push({
      rank: i + 1,
      name,
      visitorReviews: parseCount(raw.visitorReviewCount ?? raw.placeReviewCount ?? null),
      blogReviews: parseCount(raw.blogCafeReviewCount ?? raw.reviewCount ?? null),
    });
  }
  return items;
}

/**
 * 2차 상세 조회. 실패(차단·구조 변경·타임아웃) 시 null — 호출부는 1차 결과만 표시.
 * 실패 상세는 서버 로그로만 남긴다.
 */
export async function fetchPlaceDeep(query: string): Promise<PlaceDeepItem[] | null> {
  if (!isPlaceDeepEnabled()) return null;

  const url =
    'https://map.naver.com/p/api/search/allSearch?' +
    new URLSearchParams({ query, type: 'all', searchCoord: '', boundary: '' });

  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Referer: 'https://map.naver.com/',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      console.error(`[scoreboard/place] 상세 조회 HTTP ${res.status} (query=${query})`);
      return null;
    }
    const json = (await res.json()) as unknown;
    const items = parseDeepItems(json);
    if (items.length === 0) {
      console.error(`[scoreboard/place] 상세 조회 응답에서 목록을 찾지 못함 (query=${query})`);
      return null;
    }
    return items;
  } catch (err) {
    console.error('[scoreboard/place] 상세 조회 실패:', err instanceof Error ? err.message : err);
    return null;
  }
}
