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
