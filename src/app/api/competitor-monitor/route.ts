import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { getAnthropicClient, MODEL } from '@/content/lib/anthropic';

interface NaverPost {
  title: string;
  description: string;
  link: string;
  postdate: string;
  bloggername: string;
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

interface RequestBody {
  specialty?: string;
  region?: string;
  keyword?: string;
}

interface Insights {
  topics: string[];
  keywords: string[];
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
}

function buildSearchQuery(specialty: string, region: string, keyword?: string): string {
  if (keyword && keyword.trim().length > 0) {
    return keyword.trim();
  }
  return `${region} ${specialty} 블로그`;
}

async function fetchNaverBlogPosts(query: string): Promise<NaverPost[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('네이버 API 키가 설정되지 않았습니다. NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 환경변수를 확인해주세요.');
  }

  const url = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=10&sort=date`;

  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`네이버 블로그 검색 오류 (${res.status}): ${errText}`);
  }

  const data = await res.json() as NaverSearchResponse;

  return (data.items ?? []).map((item) => ({
    title: stripHtml(item.title ?? ''),
    description: stripHtml(item.description ?? ''),
    link: item.link ?? '',
    postdate: item.postdate ?? '',
    bloggername: item.bloggername ?? '',
  }));
}

async function analyzeWithClaude(posts: NaverPost[]): Promise<Insights> {
  if (posts.length === 0) {
    return { topics: [], keywords: [] };
  }

  const postList = posts
    .map((p, i) => `${i + 1}. 제목: ${p.title}\n   설명: ${p.description}`)
    .join('\n\n');

  const client = getAnthropicClient();

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `다음은 의료 블로그 검색 결과입니다. 각 글의 제목과 설명을 분석해주세요.

${postList}

위 블로그 글들을 분석하여 다음을 JSON 형식으로 응답해주세요:
- topics: 경쟁자들이 자주 다루는 주요 주제 3가지 (간결한 문장)
- keywords: 닥터포스트 사용자가 써볼만한 추천 키워드 5개 (단어 또는 짧은 구)

반드시 아래 JSON 형식만 응답하세요. 다른 텍스트는 포함하지 마세요:
{"topics": ["주제1", "주제2", "주제3"], "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5"]}`,
      },
    ],
  });

  const rawText =
    message.content[0].type === 'text' ? message.content[0].text : '';

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { topics: [], keywords: [] };
  }

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
    topics: (result.topics as unknown[])
      .filter((t): t is string => typeof t === 'string')
      .slice(0, 3),
    keywords: (result.keywords as unknown[])
      .filter((k): k is string => typeof k === 'string')
      .slice(0, 5),
  };
}

export async function POST(req: NextRequest) {
  try {
    const userSupabase = await createServerSupabaseClient();
    const { data: { user } } = await userSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = await req.json() as RequestBody;
    const { specialty, region, keyword } = body;

    if (!specialty || typeof specialty !== 'string' || !specialty.trim()) {
      return NextResponse.json({ error: '진료과목을 입력해주세요.' }, { status: 400 });
    }
    if (!region || typeof region !== 'string' || !region.trim()) {
      return NextResponse.json({ error: '지역을 입력해주세요.' }, { status: 400 });
    }

    const searchQuery = buildSearchQuery(specialty.trim(), region.trim(), keyword);

    let posts: NaverPost[] = [];
    let naverError: string | null = null;

    try {
      posts = await fetchNaverBlogPosts(searchQuery);
    } catch (err) {
      naverError = err instanceof Error ? err.message : '네이버 API 오류';
    }

    const insights = await analyzeWithClaude(posts);

    return NextResponse.json({
      posts,
      insights,
      ...(naverError ? { naverError } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
