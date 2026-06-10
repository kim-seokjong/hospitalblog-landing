import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL } from '@/content/lib/anthropic';
import { logUsage } from '@/dev/lib/usage-logger';
import { requirePaidPlan } from '@/payment/lib/usage-guard';

interface NaverBlogItem {
  title: string;
  description: string;
  link: string;
  bloggername: string;
  postdate: string;
}

async function searchNaverBlogs(query: string, display = 5): Promise<NaverBlogItem[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('네이버 API 키가 설정되지 않았습니다.');

  const url = `https://openapi.naver.com/v1/search/blog?query=${encodeURIComponent(query)}&display=${display}&sort=sim`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
  });

  if (!res.ok) throw new Error(`네이버 검색 실패: ${res.status}`);
  const data = await res.json();
  return data.items || [];
}

// Claude가 JSON 문자열 안에 줄바꿈/탭 등을 이스케이프 없이 넣는 경우 복구
function safeParseJson(raw: string): object {
  try { return JSON.parse(raw); } catch {}
  // 문자 단위로 순회하며 문자열 내부의 제어 문자를 이스케이프
  let fixed = '';
  let inString = false;
  let escaped = false;
  for (const ch of raw) {
    if (escaped) { fixed += ch; escaped = false; continue; }
    if (ch === '\\') { escaped = true; fixed += ch; continue; }
    if (ch === '"') { inString = !inString; fixed += ch; continue; }
    if (inString) {
      if (ch === '\n') { fixed += '\\n'; continue; }
      if (ch === '\r') { fixed += '\\r'; continue; }
      if (ch === '\t') { fixed += '\\t'; continue; }
    }
    fixed += ch;
  }
  return JSON.parse(fixed);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#\d+;/g, '');
}

function extractKeySentences(body: string): string[] {
  return body
    .split('\n')
    .map(l => l.replace(/^#+\s*/, '').replace(/\[이미지\s*\d+:[^\]]*\]/g, '').trim())
    .filter(l => l.length > 20 && !l.startsWith('#'))
    .slice(0, 5);
}

export async function POST(req: NextRequest) {
  const gate = await requirePaidPlan();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.message, reason: gate.reason }, { status: gate.status });
  }

  try {
    const { title, body, keyword } = await req.json();
    if (!title || !body || !keyword) {
      return NextResponse.json({ error: '제목, 본문, 키워드를 입력해주세요.' }, { status: 400 });
    }

    // 1. 네이버 블로그 검색 (키워드 + 제목 일부)
    const shortTitle = title.slice(0, 15);
    let unique: NaverBlogItem[] = [];
    let naverError: string | null = null;
    try {
      const [keywordResults, titleResults] = await Promise.all([
        searchNaverBlogs(keyword, 5),
        searchNaverBlogs(shortTitle, 5),
      ]);
      const allItems = [...keywordResults, ...titleResults];
      unique = Array.from(new Map(allItems.map(i => [i.link, i])).values()).slice(0, 8);
    } catch (err) {
      naverError = err instanceof Error ? err.message : '네이버 검색 실패';
      console.warn('네이버 블로그 검색 실패 (분석 계속):', naverError);
    }

    const similarPosts = unique.map(item => ({
      title: stripHtml(item.title),
      description: stripHtml(item.description),
      link: item.link,
      blogger: item.bloggername,
      date: item.postdate,
    }));

    // 2. Claude로 유사도 분석 (tool_use로 JSON 구조 보장)
    const keySentences = extractKeySentences(body);
    const anthropic = getAnthropicClient();

    const similarSection = similarPosts.length > 0
      ? `네이버 검색된 유사 글:\n${similarPosts.map((p, i) => `${i + 1}. ${p.title} — ${p.description.slice(0, 60)}`).join('\n')}`
      : '네이버 유사 글 없음 — 글 자체 구조와 표현 기반으로 분석';

    const analysisRes = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [{
        name: 'report_originality',
        description: '블로그 글 독창성 분석 결과를 보고합니다.',
        input_schema: {
          type: 'object' as const,
          properties: {
            originalityScore: { type: 'number', description: '독창성 점수 0-100' },
            riskLevel: { type: 'string', enum: ['낮음', '중간', '높음'] },
            summary: { type: 'string', description: '한 줄 요약' },
            risks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sentence: { type: 'string', description: '위험 표현 (30자 이내 요약)' },
                  reason: { type: 'string', description: '위험 이유 (50자 이내)' },
                  severity: { type: 'string', enum: ['높음', '중간', '낮음'] },
                },
                required: ['sentence', 'reason', 'severity'],
              },
            },
            suggestions: { type: 'array', items: { type: 'string' } },
            verdict: { type: 'string', enum: ['통과', '수정권장', '재작성권장'] },
          },
          required: ['originalityScore', 'riskLevel', 'summary', 'risks', 'suggestions', 'verdict'],
        },
      }],
      tool_choice: { type: 'tool', name: 'report_originality' },
      messages: [{
        role: 'user',
        content: `블로그 글 독창성을 분석해주세요.

제목: ${title}
핵심 문장:
${keySentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

${similarSection}

originalityScore 기준: 80이상=통과, 60~79=수정권장, 60미만=재작성권장`,
      }],
    });

    const toolUse = analysisRes.content.find(b => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error('분석 응답 실패');
    const raw = toolUse.input as Record<string, unknown>;
    const analysis = {
      ...raw,
      risks: Array.isArray(raw.risks) ? raw.risks : [],
      suggestions: Array.isArray(raw.suggestions) ? raw.suggestions : [],
    };

    logUsage({
      feature: 'check-originality',
      api_provider: 'anthropic',
      input_tokens: analysisRes.usage.input_tokens,
      output_tokens: analysisRes.usage.output_tokens,
      user_id: gate.userId,
      user_agent: req.headers.get('user-agent') ?? null,
    });

    return NextResponse.json({
      analysis,
      similarPosts,
      checkedAt: new Date().toISOString(),
      ...(naverError && { naverWarning: `네이버 블로그 검색 실패 (${naverError}) — AI 자체 분석으로 대체됨` }),
    });
  } catch (error) {
    console.error('독창성 검사 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `독창성 검사 실패: ${message}` }, { status: 500 });
  }
}
