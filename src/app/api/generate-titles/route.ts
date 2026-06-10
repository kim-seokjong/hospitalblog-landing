import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL } from '@/content/lib/anthropic';
import { MEDICAL_COMPLIANCE_SYSTEM_PROMPT } from '@/content/lib/medical-compliance';
import { logUsage } from '@/dev/lib/usage-logger';
import { requirePaidPlan } from '@/payment/lib/usage-guard';
import { searchNaverBlogs, buildCompetitorInsightText } from '@/dev/lib/naver-search';
import type { BlogTitle } from '@/types';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const gate = await requirePaidPlan();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.message, reason: gate.reason }, { status: gate.status });
  }

  try {
    const { keyword, hospitalType, region = '' } = await req.json();

    if (!keyword || typeof keyword !== 'string') {
      return NextResponse.json({ error: '키워드를 입력해주세요.' }, { status: 400 });
    }

    // 경쟁 블로그 제목 분석
    const competitorResults = await searchNaverBlogs(keyword, 5);
    const competitorText = buildCompetitorInsightText(competitorResults);

    const systemPrompt = `당신은 네이버 블로그 SEO 및 의료 마케팅 전문가입니다.
네이버 C-Rank와 D.I.A+ 알고리즘에 최적화된 병원 블로그 제목을 생성합니다.

${MEDICAL_COMPLIANCE_SYSTEM_PROMPT}

【네이버 블로그 제목 SEO 원칙】
- 핵심 키워드를 제목 앞부분(첫 5자 이내)에 배치
- 25~35자 사이의 적절한 길이 (스니펫 절단 방지)
- 다양한 형식 활용: 질문형/정보형/가이드형/노하우형/숫자형
- 검색 의도(정보 탐색, 증상 파악, 치료 방법)를 반영
- 클릭 유도 요소 포함 (숫자, 방법, 이유, 특징, 비결, 가이드)
- 롱테일 키워드 변형 활용으로 다양한 검색 커버`;

    const competitorSection = competitorText
      ? `\n【현재 네이버 상위 노출 경쟁 블로그 제목 분석】\n${competitorText}\n→ 위 제목들과 중복되지 않는 새로운 각도의 제목을 생성하세요. 경쟁 글이 놓친 검색 의도나 더 구체적인 관점을 발굴하세요.\n`
      : '';

    const regionHint = region ? `지역: ${region} (해당되는 경우 제목에 자연스럽게 포함 가능)\n` : '';

    const userPrompt = `다음 키워드로 네이버 상위노출에 최적화된 병원 블로그 제목 5개를 생성하세요.

키워드: "${keyword}"
병원 유형: ${hospitalType || '일반 병원'}
${regionHint}${competitorSection}

각 제목은 서로 다른 형식으로 작성하되, 제목이 약속하는 내용을 본문에서 완전히 충족할 수 있도록 명확한 검색 의도를 담을 것:

1. 질문형: "~는 왜? / ~는 무엇?" — 독자의 핵심 궁금증을 담아, 본문 첫 소제목에서 직접 답할 수 있는 질문
2. 정보형: "~란? / ~의 모든 것" — 포괄적 의료 정보를 제공할 것을 약속하는 형태
3. 가이드형: "~하는 방법 / ~관리 가이드" — 구체적 단계와 행동 지침을 안내할 것을 약속하는 형태
4. 노하우형: "~할 때 알아야 할 것 / 전문의가 알려주는 ~" — 임상 전문성과 실전 지식을 강조하는 형태
5. 숫자형: "N가지 ~" — 제목의 숫자만큼 구체적 항목을 본문에 담을 수 있는 형태

의료광고법 완전 준수 필수. 제목에 과장·최상급 표현 사용 금지.

반드시 다음 JSON 형식으로만 응답:
{
  "titles": [
    {
      "id": "1",
      "title": "제목 (25~35자)",
      "seoScore": 85,
      "keyword": "${keyword}",
      "seoDetails": {
        "keywordPlacement": 90,
        "titleLength": 85,
        "clickability": 80,
        "compliance": 100,
        "format": "질문형",
        "explanation": "키워드가 제목 앞에 위치하고, 본문에서 직접 답할 수 있는 구체적 질문으로 클릭률과 체류 시간 모두 높습니다"
      }
    }
  ]
}`;

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textContent = response.content.find((b) => b.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return NextResponse.json({ error: '응답 생성에 실패했습니다.' }, { status: 500 });
    }

    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'JSON 형식 응답을 찾을 수 없습니다.' }, { status: 500 });
    }

    let parsed: { titles: BlogTitle[] };
    try {
      parsed = JSON.parse(jsonMatch[0]) as { titles: BlogTitle[] };
    } catch {
      return NextResponse.json({ error: '제목 생성 응답을 파싱할 수 없습니다. 다시 시도해주세요.' }, { status: 500 });
    }

    logUsage({
      feature: 'generate-titles',
      api_provider: 'anthropic',
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      user_id: gate.userId,
      user_agent: req.headers.get('user-agent') ?? null,
    });

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('제목 생성 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `제목 생성 실패: ${message}` }, { status: 500 });
  }
}
