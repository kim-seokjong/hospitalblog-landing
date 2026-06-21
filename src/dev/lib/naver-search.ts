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
