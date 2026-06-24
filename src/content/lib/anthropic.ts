import Anthropic from '@anthropic-ai/sdk';

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.');
  }
  return new Anthropic({ apiKey });
}

export const MODEL = 'claude-sonnet-4-6';

/**
 * 교정(프루프리드) 패스 — 본문 생성 직후 1회 추가 호출.
 *
 * 목적: 비문·오타·디코딩 글리치("장효과적인인" 류)·어색하게 박힌 키워드만
 *       자연스럽게 교정. 의학 정보·SEO 제목/H2 구조·이미지 지시·글자수·
 *       출력 서식(▶, [이미지 N:], [핵심 요약], [자주 묻는 질문])은 전부 보존.
 *
 * 안전: 실패/타임아웃/빈 응답 시 원본을 그대로 반환(graceful) — 교정 실패가
 *       글 생성 자체를 막지 않음. 모델은 본문 생성과 동일(MODEL) 사용(다운그레이드 금지).
 */
const PROOFREAD_SYSTEM_PROMPT = `당신은 의료 블로그 글을 다듬는 한국어 교정 전문가입니다.
주어진 본문에서 비문, 오타, 디코딩 글리치(예: "장효과적인인" 처럼 글자가 깨지거나 어미가 중복된 토큰), 그리고 문법을 해치며 어색하게 박힌 키워드만 자연스럽게 교정하세요.

【반드시 보존 — 절대 건드리지 말 것】
- 의학 정보·사실·수치 (새로운 의학 주장 추가 금지, 기존 사실 변경 금지)
- SEO 제목 구조, 소제목(H2) 구조, ▶ 로 시작하는 세부 소제목(H3)
- 이미지 지시 [이미지 N: ...] — 위치·번호·설명 그대로 유지
- [핵심 요약] ~ [/핵심 요약], [자주 묻는 질문] ~ [/자주 묻는 질문] 블록과 Q1./A1. 형식
- 글자수 — 교정 전후 길이가 거의 같아야 함 (문장을 새로 추가하거나 삭제하지 말 것)
- 문단 구성·빈 줄 구조, 자연체 톤·1인칭 임상 관찰 어투
- 출력 서식 규칙: 마크다운 기호(#, **, * 등) 사용 금지, ▶ 외 기호 추가 금지

【교정 대상 — 이런 것만 고침】
- 의미가 붕괴된 키워드 억지 결합: 예 "보톡스의 원인이 되는 구조적 특성" → 키워드를 빼거나 동의어·대명사·생략으로 자연스럽게 변주
- 의미 불명의 키워드 명사구: 예 "보톡스 증상 반응이 과하게" → 자연스러운 표현으로 교정
- 도배된 반복 키워드 → 자연스러운 위치만 남기고 변주
- 오타·자모 깨짐·어미 중복(인인/은은 류)·반복 토큰 글리치

자연스러운 위치에 있는 핵심 키워드는 그대로 두세요. 어색하게 박힌 키워드만 손대세요.
교정본 본문만 출력하세요. 설명·머리말·코드블록 없이 본문 텍스트만 반환합니다.`;

/**
 * 본문을 교정한다. 실패 시 원본을 그대로 반환한다(graceful fallback).
 *
 * ANTI-AI 보강: aiCliches(문단 첫머리에서 검출된 AI 상투어)가 있으면, 의미를
 * 보존하며 자연스럽게 풀어쓰라는 지시를 user 프롬프트에 추가한다. 기존
 * "비문·오타만 교정, 구조·길이·서식 보존" 규칙은 그대로 유지되며, ANTI-AI
 * 지시는 보강일 뿐 보존 규칙을 깨지 않는다.
 *
 * @param body 교정 대상 본문
 * @param aiCliches 문단 첫머리에서 검출된 AI 상투어 목록(선택)
 */
export async function proofreadContent(body: string, aiCliches?: readonly string[]): Promise<string> {
  // 빈 본문은 교정할 것이 없음
  if (!body || body.trim() === '') {
    return body;
  }

  const antiAiInstruction =
    aiCliches && aiCliches.length > 0
      ? `\n\n【추가 지시 — ANTI-AI】다음 AI 상투어가 문단 첫머리에서 검출되었습니다: ${aiCliches.join(
          ', ',
        )}. 의미를 보존하면서 자연스러운 한국어로 풀어쓰세요(억지로 남기지 말 것). 단, 위의 모든 보존 규칙(구조·길이·서식·의학 정보)은 그대로 지키세요.`
      : '';

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 6144,
      system: PROOFREAD_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `다음 의료 블로그 본문을 위 규칙에 따라 교정해주세요. 교정본 본문만 출력하세요.${antiAiInstruction}\n\n${body}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return body;
    }

    const proofread = textBlock.text.trim();
    // 빈 응답·비정상 단축(원본의 절반 미만)일 경우 교정 실패로 간주, 원본 유지
    if (proofread === '' || proofread.length < body.trim().length * 0.5) {
      return body;
    }

    return proofread;
  } catch {
    // 교정 실패·타임아웃은 무시하고 원본 반환 — 글 생성 자체는 성공시킨다
    return body;
  }
}
