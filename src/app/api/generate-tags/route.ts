import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL } from '@/lib/anthropic';
import { logUsage } from '@/lib/usage-logger';
import type { TagResult } from '@/types';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { keyword, title, hospitalType } = await req.json();

    if (!keyword || !title) {
      return NextResponse.json({ error: '키워드와 제목을 입력해주세요.' }, { status: 400 });
    }

    const userPrompt = `네이버 블로그 태그와 해시태그를 생성해주세요.

키워드: "${keyword}"
제목: "${title}"
병원 유형: ${hospitalType || '일반 병원'}

【태그 생성 원칙 - 네이버 SEO 기준】
- 네이버 태그: 구체적 키워드 7~10개 (색인 및 모바일 탭 유입 목적)
- 해시태그: 본문 삽입용 5~8개 (#키워드 형식)
- 우선순위: 검색량 높은 키워드 먼저
- 카테고리: 질환명, 치료법, 증상, 병원유형, 지역(선택)

반드시 다음 JSON 형식으로만 응답:
{
  "tags": [
    {
      "tag": "태그명",
      "category": "질환",
      "priority": 1,
      "searchVolume": "높음"
    }
  ],
  "hashtags": ["#태그1", "#태그2"],
  "naverTags": ["태그1", "태그2"]
}

카테고리는 질환/치료/병원/지역/증상/정보 중 하나.
searchVolume은 높음/중간/낮음 중 하나.`;

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textContent = response.content.find((b) => b.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return NextResponse.json({ error: '태그 생성에 실패했습니다.' }, { status: 500 });
    }

    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'JSON 응답을 파싱할 수 없습니다.' }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]) as TagResult;

    logUsage({
      feature: 'generate-tags',
      api_provider: 'anthropic',
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('태그 생성 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `태그 생성 실패: ${message}` }, { status: 500 });
  }
}
