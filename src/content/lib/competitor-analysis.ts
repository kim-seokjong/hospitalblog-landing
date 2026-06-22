import { getAnthropicClient, MODEL } from '@/content/lib/anthropic';

/**
 * 경쟁 블로그 분석 공용 로직.
 * competitor-monitor 라우트는 그대로 두고, content-plan(조합 라우트)이 재사용한다.
 *
 * 의료광고법 가드: Claude 가 생성하는 주제/키워드는 비교·비방·과장·수치단정 금지.
 * 프롬프트에 제약을 명시한다.
 */

export interface NaverPost {
  title: string;
  description: string;
  link: string;
  postdate: string;
  bloggername: string;
}

export interface CompetitorInsights {
  topics: string[];
  keywords: string[];
}

interface NaverSearchResponse {
  items?: Array<{
    title?: string;
    description?: string;
    link?: string;
    postdate?: string;
    bloggername?: string;
  }>;
}

export function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
}

export function buildSearchQuery(specialty: string, region: string, keyword?: string): string {
  if (keyword && keyword.trim().length > 0) {
    return keyword.trim();
  }
  return `${region} ${specialty} 블로그`;
}

export async function fetchNaverBlogPosts(
  query: string,
  fetchImpl: typeof fetch = fetch
): Promise<NaverPost[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('네이버 API 키가 설정되지 않았습니다. NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 환경변수를 확인해주세요.');
  }

  const url = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=10&sort=date`;

  const res = await fetchImpl(url, {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`네이버 블로그 검색 오류 (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as NaverSearchResponse;

  return (data.items ?? []).map((item) => ({
    title: stripHtml(item.title ?? ''),
    description: stripHtml(item.description ?? ''),
    link: item.link ?? '',
    postdate: item.postdate ?? '',
    bloggername: item.bloggername ?? '',
  }));
}

/** Claude 응답(JSON 문자열 포함 가능)에서 topics/keywords 를 안전 파싱한다. */
export function parseInsights(rawText: string): CompetitorInsights {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { topics: [], keywords: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { topics: [], keywords: [] };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).topics) ||
    !Array.isArray((parsed as Record<string, unknown>).keywords)
  ) {
    return { topics: [], keywords: [] };
  }

  const result = parsed as Record<string, unknown>;
  return {
    topics: (result.topics as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 6),
    keywords: (result.keywords as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 8),
  };
}

const ANALYSIS_GUARD = `【의료광고법 준수 — 매우 중요】
- 타 병원 비방·비교·우열 표현 절대 금지 ("○○보다 낫다", "최고", "1위" 등 금지).
- 효과 단정·수치 단정·치료 효과 보장 표현 금지.
- 환자 유인성 과장 표현 금지.
- 경쟁자가 어떤 주제를 다루는지 "분석"하는 것은 허용되나, 비교광고 문구를 만들지 말 것.
- 추천 주제/키워드는 일반적·정보성 주제로만 제안한다.`;

/**
 * 경쟁 블로그 글을 분석해 주제·키워드 인사이트를 만든다.
 * 글이 없으면 빈 결과. 실패해도 빈 결과로 graceful degrade.
 */
export async function analyzeCompetitorPosts(posts: NaverPost[]): Promise<CompetitorInsights> {
  if (posts.length === 0) {
    return { topics: [], keywords: [] };
  }

  const postList = posts
    .map((p, i) => `${i + 1}. 제목: ${p.title}\n   설명: ${p.description}`)
    .join('\n\n');

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      messages: [
        {
          role: 'user',
          content: `다음은 의료 블로그 검색 결과입니다. 각 글의 제목과 설명을 분석해주세요.

${postList}

${ANALYSIS_GUARD}

위 블로그 글들을 분석하여 다음을 JSON 형식으로 응답해주세요:
- topics: 경쟁자들이 자주 다루는 주요 주제 5가지 (간결한 정보성 주제 문장, 비교·비방 금지)
- keywords: 닥터포스트 사용자가 써볼만한 추천 키워드 6개 (단어 또는 짧은 구)

반드시 아래 JSON 형식만 응답하세요. 다른 텍스트는 포함하지 마세요:
{"topics": ["주제1", "주제2", "주제3", "주제4", "주제5"], "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5", "키워드6"]}`,
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    const rawText = textBlock?.type === 'text' ? textBlock.text : '';
    return parseInsights(rawText);
  } catch {
    return { topics: [], keywords: [] };
  }
}
