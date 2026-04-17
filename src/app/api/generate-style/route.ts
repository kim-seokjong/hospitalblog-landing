import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL } from '@/lib/anthropic';
import type { SlideStyleConfig } from '@/types';

function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

export async function POST(req: NextRequest) {
  try {
    const { styleDescription } = await req.json();
    if (!styleDescription) {
      return NextResponse.json({ error: '스타일 설명을 입력해주세요.' }, { status: 400 });
    }

    const anthropic = getAnthropicClient();
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [{
        name: 'generate_style',
        description: '카드뉴스 디자인 스타일 색상 팔레트 생성',
        input_schema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string', description: '스타일 이름 (10자 이하)' },
            emoji: { type: 'string', description: '스타일을 표현하는 이모지 1개' },
            bgFrom: { type: 'string', description: '배경 그라디언트 시작 hex 색상 (예: #1A1A2E)' },
            bgTo: { type: 'string', description: '배경 그라디언트 끝 hex 색상' },
            accentColor: { type: 'string', description: '강조 색상 hex (번호원, 배너에 사용)' },
            accentTextColor: { type: 'string', description: '강조색 위 텍스트 hex (대비 높은 색)' },
            mainTextColor: { type: 'string', description: '메인 텍스트 hex 색상' },
            isLightBg: { type: 'boolean', description: '밝은 배경 여부 (어두운 글자 필요 시 true)' },
          },
          required: ['name', 'emoji', 'bgFrom', 'bgTo', 'accentColor', 'accentTextColor', 'mainTextColor', 'isLightBg'],
        },
      }],
      tool_choice: { type: 'tool', name: 'generate_style' },
      messages: [{
        role: 'user',
        content: `카드뉴스 스타일 요청: "${styleDescription}"

병원 마케팅용 카드뉴스에 어울리는 전문적이고 아름다운 색상 팔레트를 생성해주세요.
요청한 느낌을 살리되, 텍스트 가독성이 높아야 합니다.
배경은 단색이나 그라디언트로 제안해주세요.`,
      }],
    });

    const toolUse = res.content.find(b => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      return NextResponse.json({ error: '스타일 생성에 실패했습니다.' }, { status: 500 });
    }

    const inp = toolUse.input as {
      name: string; emoji: string;
      bgFrom: string; bgTo: string;
      accentColor: string; accentTextColor: string;
      mainTextColor: string; isLightBg: boolean;
    };

    const boxAlpha = 0.18;
    const style: SlideStyleConfig = {
      name: inp.name,
      emoji: inp.emoji,
      bgGradient: [inp.bgFrom, inp.bgTo],
      accentColor: inp.accentColor,
      accentTextColor: inp.accentTextColor,
      mainTextColor: inp.mainTextColor,
      subTextColor: inp.isLightBg
        ? `rgba(${hexToRgb(inp.mainTextColor)},0.70)`
        : `rgba(255,255,255,0.82)`,
      boxFillColor: inp.isLightBg
        ? `rgba(${hexToRgb(inp.accentColor)},${boxAlpha})`
        : `rgba(255,255,255,${boxAlpha})`,
      infoBgColor: inp.isLightBg
        ? `rgba(${hexToRgb(inp.accentColor)},0.20)`
        : `rgba(0,0,0,0.55)`,
      decorColor: inp.isLightBg
        ? `rgba(${hexToRgb(inp.accentColor)},0.12)`
        : `rgba(255,255,255,0.16)`,
      dividerColor: inp.isLightBg
        ? `rgba(${hexToRgb(inp.accentColor)},0.35)`
        : `rgba(255,255,255,0.38)`,
      tagBgColor: inp.isLightBg
        ? `rgba(${hexToRgb(inp.accentColor)},0.15)`
        : `rgba(255,255,255,0.25)`,
    };

    return NextResponse.json(style);
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `스타일 생성 실패: ${message}` }, { status: 500 });
  }
}
