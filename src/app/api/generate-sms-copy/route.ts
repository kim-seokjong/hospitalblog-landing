import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL } from '@/lib/anthropic';

type MessageType = 'sms' | 'alimtalk';

interface RequestBody {
  title?: string;
  content?: string;
  keyword?: string;
  type?: MessageType;
}

function getByteLength(str: string): number {
  let byteCount = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code > 127) {
      byteCount += 2; // 한글 및 기타 멀티바이트 문자
    } else {
      byteCount += 1;
    }
  }
  return byteCount;
}

function buildPrompt(title: string, content: string, keyword: string, type: MessageType): string {
  const medicalDisclaimer = `
【의료법 준수 필수】
- 의료법 제56조: "완치", "최고", "100%", "기적", "특효" 등 과장 표현 절대 금지
- 효과를 단정짓는 표현 금지`;

  if (type === 'sms') {
    return `다음 병원 블로그 글을 SMS 문자 메시지로 변환해 주세요.

제목: ${title}
키워드: ${keyword}
내용 요약: ${content.slice(0, 200)}

【SMS 문자 조건】
- 한글 기준 45자 이내 (90바이트 이내)
- 병원명은 [병원명] 자리표시자로 표기
- 핵심 내용만 간결하게
- 예약 또는 문의 안내 포함
- 링크 자리: [링크] 자리표시자 사용
${medicalDisclaimer}

반드시 완성된 SMS 문구만 출력 (설명 없이):`;
  }

  return `다음 병원 블로그 글을 카카오 알림톡 메시지로 변환해 주세요.

제목: ${title}
키워드: ${keyword}
내용 요약: ${content.slice(0, 200)}

【카카오 알림톡 조건】
- 200자 이내 (한글 기준)
- 공식적이고 정중한 말투 (존댓말 필수)
- 병원명은 [병원명] 자리표시자로 표기
- 예약 확인, 건강 정보 제공, 내원 안내 등 목적 명확히
- 문의 연락처: [전화번호] 자리표시자 사용
${medicalDisclaimer}

반드시 완성된 알림톡 문구만 출력 (설명 없이):`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as RequestBody;
    const { title, content, keyword, type } = body;

    if (!title || typeof title !== 'string') {
      return NextResponse.json({ error: '제목을 입력해주세요.' }, { status: 400 });
    }
    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: '본문 내용을 입력해주세요.' }, { status: 400 });
    }
    if (!keyword || typeof keyword !== 'string') {
      return NextResponse.json({ error: '키워드를 입력해주세요.' }, { status: 400 });
    }
    if (type !== 'sms' && type !== 'alimtalk') {
      return NextResponse.json({ error: '메시지 유형을 선택해주세요. (sms 또는 alimtalk)' }, { status: 400 });
    }

    const prompt = buildPrompt(title.trim(), content.trim(), keyword.trim(), type);

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: '문구 생성에 실패했습니다.' }, { status: 500 });
    }

    const copy = textBlock.text.trim();
    const byteCount = getByteLength(copy);

    return NextResponse.json({ copy, byteCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `문구 생성 실패: ${message}` }, { status: 500 });
  }
}
