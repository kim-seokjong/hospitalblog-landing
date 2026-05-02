import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL } from '@/lib/anthropic';

type Platform = 'instagram' | 'kakao';

interface RequestBody {
  title?: string;
  content?: string;
  keyword?: string;
  platform?: Platform;
}

function buildPrompt(title: string, content: string, keyword: string, platform: Platform): string {
  const medicalDisclaimer = `
【의료법 준수 필수】
- 의료법 제56조: "완치", "최고", "100%", "기적", "특효" 등 과장 표현 절대 금지
- 효과를 단정하는 표현 금지 (예: "~됩니다" 대신 "~에 도움이 될 수 있습니다")
- 실제 진료 상담을 권유하는 내용 포함 권장`;

  if (platform === 'instagram') {
    return `다음 병원 블로그 글을 인스타그램 게시물 캡션으로 변환해 주세요.

제목: ${title}
키워드: ${keyword}
내용 요약: ${content.slice(0, 300)}

【인스타그램 캡션 조건】
- 150자 이내 (한글 기준)
- 이모지 2~3개 포함 (과하지 않게)
- 공감을 유도하는 첫 문장 (질문 형식 또는 공감 문구)
- 진료 문의 또는 프로필 링크 클릭 유도
- 해시태그 10개 (캡션 끝에 줄바꿈 후 추가)
- 해시태그: 진료과목, 키워드, 지역, 증상 관련
${medicalDisclaimer}

반드시 완성된 캡션 텍스트만 출력 (설명 없이):`;
  }

  return `다음 병원 블로그 글을 카카오채널 포스팅 문구로 변환해 주세요.

제목: ${title}
키워드: ${keyword}
내용 요약: ${content.slice(0, 300)}

【카카오채널 포스팅 조건】
- 200자 이내 (한글 기준)
- 이모지 2~3개 포함
- 친근하고 따뜻한 말투 (딱딱하지 않게)
- 환자 입장에서 공감하는 내용
- 카카오채널 친구추가 또는 상담 예약 유도 문구 포함
${medicalDisclaimer}

반드시 완성된 포스팅 텍스트만 출력 (설명 없이):`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as RequestBody;
    const { title, content, keyword, platform } = body;

    if (!title || typeof title !== 'string') {
      return NextResponse.json({ error: '제목을 입력해주세요.' }, { status: 400 });
    }
    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: '본문 내용을 입력해주세요.' }, { status: 400 });
    }
    if (!keyword || typeof keyword !== 'string') {
      return NextResponse.json({ error: '키워드를 입력해주세요.' }, { status: 400 });
    }
    if (platform !== 'instagram' && platform !== 'kakao') {
      return NextResponse.json({ error: '플랫폼을 선택해주세요. (instagram 또는 kakao)' }, { status: 400 });
    }

    const prompt = buildPrompt(title.trim(), content.trim(), keyword.trim(), platform);

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'SNS 카피 생성에 실패했습니다.' }, { status: 500 });
    }

    const copy = textBlock.text.trim();
    return NextResponse.json({ copy });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `SNS 카피 생성 실패: ${message}` }, { status: 500 });
  }
}
