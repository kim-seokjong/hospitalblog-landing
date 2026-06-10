import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL } from '@/content/lib/anthropic';
import { logUsage } from '@/dev/lib/usage-logger';
import type { CardNewsData } from '@/types';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { keyword, title, body, hospitalType } = await req.json();

    if (!keyword || !title) {
      return NextResponse.json({ error: '키워드와 제목을 입력해주세요.' }, { status: 400 });
    }

    const anthropic = getAnthropicClient();

    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      tools: [{
        name: 'generate_cardnews_data',
        description: '병원 블로그용 카드뉴스 슬라이드 데이터 생성',
        input_schema: {
          type: 'object' as const,
          properties: {
            hospitalName: { type: 'string', description: '병원 이름 (예: ○○병원)' },
            coverTitle: { type: 'string', description: '표지 메인 제목 (10-18자)' },
            coverSubtitle: { type: 'string', description: '표지 부제목 (20-30자)' },
            coverTopics: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  icon: { type: 'string', description: 'emoji 아이콘' },
                  title: { type: 'string', description: '토픽 제목 (6자 이하)' },
                  desc: { type: 'string', description: '설명 (8자 이하)' },
                },
                required: ['icon', 'title', 'desc'],
              },
              description: '표지 하단 4개 토픽',
            },
            stepsTitle: { type: 'string', description: '단계 슬라이드 제목 (15자 이하)' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  num: { type: 'string', description: '번호 (01, 02, 03, 04)' },
                  icon: { type: 'string', description: 'emoji 아이콘' },
                  title: { type: 'string', description: '단계 제목 (12자 이하)' },
                  desc: { type: 'string', description: '단계 설명 (20자 이하)' },
                },
                required: ['num', 'icon', 'title', 'desc'],
              },
              description: '4단계 항목',
            },
            conclusionSub: { type: 'string', description: '마무리 슬라이드 소제목 (20자 이하)' },
            conclusionTitle: { type: 'string', description: '마무리 메인 메시지 (20자 이하)' },
            conclusionPoints: {
              type: 'array',
              items: { type: 'string', description: '핵심 포인트 (20자 이하)' },
              description: '3가지 핵심 포인트',
            },
            footerText: { type: 'string', description: '하단 홍보 문구 (25자 이하)' },
          },
          required: [
            'hospitalName', 'coverTitle', 'coverSubtitle', 'coverTopics',
            'stepsTitle', 'steps', 'conclusionSub', 'conclusionTitle',
            'conclusionPoints', 'footerText',
          ],
        },
      }],
      tool_choice: { type: 'tool', name: 'generate_cardnews_data' },
      messages: [{
        role: 'user',
        content: `다음 병원 블로그 포스트를 기반으로 카드뉴스 슬라이드 데이터를 생성해주세요.

키워드: ${keyword}
병원 유형: ${hospitalType || '병원'}
제목: ${title}

본문:
${body ? body.slice(0, 2000) : ''}

규칙:
- hospitalName: "${hospitalType || '우리'}병원" 형태
- coverTitle: 블로그 제목의 핵심 주제 (10-18자)
- coverSubtitle: 부제목 설명 (20-30자)
- coverTopics: 4가지 핵심 카테고리 (emoji + 짧은 제목 + 설명)
- stepsTitle: 단계/과정 슬라이드 제목
- steps: 4단계 프로세스 (01-04, emoji 포함)
- conclusionSub: 결론 슬라이드 소제목
- conclusionTitle: 행동 유도 메시지 (예: "전문 치료가 필요합니다.")
- conclusionPoints: 3가지 이유/혜택
- footerText: 병원 홍보 문구`,
      }],
    });

    const toolUse = res.content.find(b => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      return NextResponse.json({ error: '슬라이드 데이터 생성에 실패했습니다.' }, { status: 500 });
    }

    const data = toolUse.input as CardNewsData;

    logUsage({
      feature: 'generate-cardnews-slides',
      api_provider: 'anthropic',
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      user_id: null,
      user_agent: req.headers.get('user-agent') ?? null,
    });

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `카드뉴스 생성 실패: ${message}` }, { status: 500 });
  }
}
