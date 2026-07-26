export interface NaverBlogResult {
  title: string;
  description: string;
}

export async function searchNaverBlogs(keyword: string, display = 5): Promise<NaverBlogResult[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];

  try {
    const params = new URLSearchParams({ query: keyword, display: String(display), sort: 'sim' });
    const res = await fetch(`https://openapi.naver.com/v1/search/blog.json?${params}`, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });
    if (!res.ok) return [];
    const data = await res.json() as { items?: { title: string; description: string }[] };
    return (data.items ?? []).map((item) => ({
      title: item.title.replace(/<[^>]+>/g, '').trim(),
      description: item.description.replace(/<[^>]+>/g, '').trim(),
    }));
  } catch {
    return [];
  }
}

/** 순위 추적용 블로그 검색결과 (link/bloggername/title 포함). */
export interface NaverBlogRankItem {
  link: string;
  bloggername: string;
  title: string;
}

/**
 * 네이버 검색 API 하드 제약 — 2026-07-26 실측 확인.
 *   display=101 → HTTP 400 SE02 (부적절한 display 값)
 *   start=1001  → HTTP 400 SE03 (부적절한 start 값)
 * 따라서 이 API 로 도달 가능한 최대 위치는 start(1000) + display(100) - 1 = 1099 위.
 */
export const NAVER_SEARCH_MAX_DISPLAY = 100;
export const NAVER_SEARCH_MAX_START = 1000;

/** 순위 측정이 "실패"한 이유. ★ 미발견(100위 밖)과 절대 섞으면 안 된다. */
export type NaverSearchErrorCode =
  | 'no_credentials'   // NAVER_CLIENT_ID/SECRET 미설정 → 측정 자체를 못 함
  | 'empty_keyword'
  | 'invalid_argument' // 400 (SE02/SE03 등)
  | 'unauthorized'     // 401/403 — 키 만료·권한 오류
  | 'rate_limited'     // 429 — 일일 쿼터 소진
  | 'server_error'     // 5xx
  | 'network_error'    // 타임아웃·연결 실패
  | 'invalid_response';

export type NaverRankPageResult =
  | { ok: true; items: NaverBlogRankItem[]; total: number }
  | { ok: false; errorCode: NaverSearchErrorCode; message: string };

const RANK_FETCH_TIMEOUT_MS = 8_000;

function classifyStatus(status: number): NaverSearchErrorCode {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status === 400) return 'invalid_argument';
  if (status >= 500) return 'server_error';
  return 'invalid_response';
}

/**
 * 순위 추적용 네이버 블로그 검색 1페이지. sort=sim(관련도) 고정.
 *
 * ★ 예전 구현은 키 없음·HTTP 오류·예외를 전부 `[]` 로 뭉갰다.
 *   호출부는 그것을 "100위 안에 없음"으로 저장했고, cron 은 성공으로 보고했다.
 *   → 두 달간 측정이 죽어 있어도 아무도 몰랐다.
 *   이제 실패는 반드시 { ok:false, errorCode } 로 구분해 올린다.
 *
 * link/bloggername/title 만 추린다(개인정보 최소수집).
 */
export async function searchNaverBlogRankPage(
  keyword: string,
  options: { start?: number; display?: number; fetchImpl?: typeof fetch } = {},
): Promise<NaverRankPageResult> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      errorCode: 'no_credentials',
      message: 'NAVER_CLIENT_ID/NAVER_CLIENT_SECRET 미설정 — 순위 측정 불가',
    };
  }
  const query = typeof keyword === 'string' ? keyword.trim() : '';
  if (!query) return { ok: false, errorCode: 'empty_keyword', message: '빈 키워드' };

  const display = Math.min(Math.max(Math.floor(options.display ?? NAVER_SEARCH_MAX_DISPLAY), 1), NAVER_SEARCH_MAX_DISPLAY);
  const start = Math.min(Math.max(Math.floor(options.start ?? 1), 1), NAVER_SEARCH_MAX_START);
  const fetchImpl = options.fetchImpl ?? fetch;

  const params = new URLSearchParams({
    query,
    display: String(display),
    start: String(start),
    sort: 'sim',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RANK_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`https://openapi.naver.com/v1/search/blog.json?${params}`, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        errorCode: classifyStatus(res.status),
        message: `네이버 검색 API HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      total?: number;
      items?: { link?: string; bloggername?: string; title?: string }[];
    };
    if (!Array.isArray(data.items)) {
      return { ok: false, errorCode: 'invalid_response', message: 'items 배열 없음' };
    }
    return {
      ok: true,
      total: typeof data.total === 'number' ? data.total : 0,
      items: data.items.map((item) => ({
        link: (item.link ?? '').trim(),
        bloggername: (item.bloggername ?? '').replace(/<[^>]+>/g, '').trim(),
        title: (item.title ?? '').replace(/<[^>]+>/g, '').trim(),
      })),
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      errorCode: 'network_error',
      message: aborted
        ? `네이버 검색 API 타임아웃 (${RANK_FETCH_TIMEOUT_MS}ms)`
        : e instanceof Error ? e.message : '네이버 검색 API 호출 실패',
    };
  } finally {
    clearTimeout(timer);
  }
}

export function buildCompetitorInsightText(results: NaverBlogResult[]): string {
  if (results.length === 0) return '';
  return results
    .map((r, i) => `${i + 1}. ${r.title}${r.description ? `\n   └ ${r.description.slice(0, 100)}` : ''}`)
    .join('\n');
}

// ─────────────────────────────────────────────────────────────
// 네이버 지역검색 (병원명 → 프로필 자동 채우기용)
// ─────────────────────────────────────────────────────────────

export interface NaverLocalResult {
  name: string;
  category: string;
  specialty: string; // category → 우리 진료과목 매핑 결과 ('' 가능)
  address: string;
  roadAddress: string;
  region: string; // roadAddress(우선)/address 에서 extractRegionFromAddress
  link: string;
}

// ProfileTab 의 SPECIALTIES 목록 (정확 매칭 우선)
const KNOWN_SPECIALTIES = [
  '내과', '외과', '정형외과', '신경외과', '피부과', '성형외과',
  '안과', '이비인후과', '치과', '한의원', '산부인과', '소아청소년과',
  '비뇨의학과', '정신건강의학과', '재활의학과', '가정의학과',
  '응급의학과', '기타',
] as const;

// 네이버 category 토큰 → 우리 진료과목 별칭 매핑
const SPECIALTY_ALIASES: Record<string, string> = {
  소아과: '소아청소년과',
  비뇨기과: '비뇨의학과',
  한방: '한의원',
  한방병원: '한의원',
  정신과: '정신건강의학과',
  신경정신과: '정신건강의학과',
  치과의원: '치과',
};

/**
 * 네이버 지역검색 category(예 "병원,의원>피부과")의 마지막 토큰을
 * 우리 진료과목 목록에 매핑한다. 실패 시 '' 반환.
 */
export function mapCategoryToSpecialty(category: string): string {
  if (!category) return '';
  const last = category.split('>').pop()?.trim() ?? '';
  if (!last) return '';

  // 정확 매칭 우선
  if ((KNOWN_SPECIALTIES as readonly string[]).includes(last)) return last;

  // 별칭 매칭
  if (SPECIALTY_ALIASES[last]) return SPECIALTY_ALIASES[last];

  // 부분 포함 매칭 (예: "피부비뇨기과" 류 보강)
  const partial = KNOWN_SPECIALTIES.find(
    (s) => s !== '기타' && (last.includes(s) || s.includes(last)),
  );
  if (partial) return partial;

  const aliasKey = Object.keys(SPECIALTY_ALIASES).find((k) => last.includes(k));
  if (aliasKey) return SPECIALTY_ALIASES[aliasKey];

  return '';
}

/**
 * 네이버 지역검색(local.json) 호출. 키가 없거나 실패하면 [] 반환(graceful).
 * title 의 <b>/HTML 태그는 제거한다. telephone 은 항상 빈값이라 사용하지 않는다.
 */
export async function searchNaverLocal(query: string, display = 5): Promise<NaverLocalResult[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];
  if (!query || query.trim() === '') return [];

  try {
    const params = new URLSearchParams({
      query: query.trim(),
      display: String(display),
      sort: 'random',
    });
    const res = await fetch(`https://openapi.naver.com/v1/search/local.json?${params}`, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: {
        title?: string;
        category?: string;
        address?: string;
        roadAddress?: string;
        link?: string;
      }[];
    };
    return (data.items ?? []).map((item) => {
      const name = (item.title ?? '').replace(/<[^>]+>/g, '').trim();
      const category = (item.category ?? '').trim();
      const address = (item.address ?? '').trim();
      const roadAddress = (item.roadAddress ?? '').trim();
      return {
        name,
        category,
        specialty: mapCategoryToSpecialty(category),
        address,
        roadAddress,
        region: extractRegionFromAddress(roadAddress || address),
        link: (item.link ?? '').trim(),
      };
    });
  } catch {
    return [];
  }
}

// 병원 주소에서 지역명(구/군) 추출
export function extractRegionFromAddress(address: string): string {
  if (!address) return '';
  const parts = address.trim().split(/\s+/);
  const gu = parts.find(p => p.endsWith('구') || p.endsWith('군'));
  if (gu) return gu;
  const si = parts.find(p => p.endsWith('시') && p !== '광역시');
  if (si) return si;
  return '';
}
