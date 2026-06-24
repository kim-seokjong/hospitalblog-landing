/**
 * ANTI-AI 결정론 후처리 필터 (보수적 / conservative)
 *
 * 원칙: 문단/줄 첫머리에 오는 AI 접속 상투어만 처리한다.
 *       문장 중간에 같은 단어가 나와도 절대 건드리지 않는다(문맥 보호).
 *
 * - 접속 상투어("또한," "따라서," 등)가 문단/줄 첫머리에 올 때만 제거하고,
 *   제거 후 뒤따르는 본문을 자연스럽게 이어 붙인다.
 * - 마무리 인사 상투어("마지막으로" 등)가 문단 첫머리에 오면 자동 삭제하지
 *   않고 검출(detected)만 한다 — 삭제는 의미 손상 위험이 있어 LLM 교정 패스에
 *   위임한다.
 * - 구조 토큰([이미지 N: ...], ▶, [핵심 요약], [자주 묻는 질문], Q1./A1. 등)은
 *   절대 손상시키지 않는다.
 * - 정돈은 빈 줄 3개 이상 → 2개로 줄이는 안전한 수준만 허용한다.
 * - 입력을 변형(mutate)하지 않고 새 문자열을 반환한다.
 */

/** 문단/줄 첫머리에서 제거할 접속 상투어 (직후 쉼표/공백 형태일 때만). */
const CONNECTOR_CLICHES: readonly string[] = [
  '또한',
  '따라서',
  '먼저',
  '이처럼',
  '결론적으로',
  '요약하자면',
  '정리하자면',
  '정리하면',
  '한마디로',
  '무엇보다도',
  '다시 말해',
];

/** 문단 첫머리에서 검출만 하는 마무리 인사 상투어 (제거하지 않음). */
const CLOSING_CLICHES: readonly string[] = [
  '마지막으로',
  '끝으로',
  '마무리하며',
  '마치며',
];

/** 정규식에 안전하게 들어가도록 특수문자를 이스케이프한다. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface StripAiClichesResult {
  /** 필터링된 본문. */
  readonly cleaned: string;
  /** 제거하거나 검출한 상투어 목록(중복 제거). */
  readonly detected: readonly string[];
}

/**
 * 문단/줄 첫머리의 AI 접속 상투어를 보수적으로 제거하고,
 * 마무리 인사 상투어는 검출만 한다.
 *
 * @param text 원본 본문
 * @returns cleaned(필터링된 본문) + detected(처리/검출된 상투어 목록)
 */
export function stripAiCliches(text: string): StripAiClichesResult {
  if (!text || text.trim() === '') {
    return { cleaned: text, detected: [] };
  }

  const detected: string[] = [];
  let cleaned = text;

  // 접속 상투어 제거: 줄 시작(^, m 플래그) + 상투어 + (쉼표|공백) 형태일 때만.
  // 뒤따르는 공백을 함께 흡수해 자연스럽게 이어 붙인다.
  for (const cliche of CONNECTOR_CLICHES) {
    const pattern = new RegExp(`^([ \\t]*)${escapeRegExp(cliche)}\\s*,\\s*`, 'gm');
    if (pattern.test(cleaned)) {
      detected.push(cliche);
      // 줄 첫머리의 들여쓰기는 보존하고 상투어만 걷어낸다.
      cleaned = cleaned.replace(pattern, '$1');
    }
  }

  // 마무리 인사 상투어: 문단 첫머리에 오면 검출만(자동 삭제 금지).
  // 문단 첫머리 = 문서 시작 또는 빈 줄 뒤 줄 시작.
  for (const cliche of CLOSING_CLICHES) {
    const pattern = new RegExp(
      `(?:^|\\n\\n)[ \\t]*${escapeRegExp(cliche)}(?=[\\s,.])`,
      'm',
    );
    if (pattern.test(cleaned)) {
      detected.push(cliche);
    }
  }

  // 안전한 정돈: 빈 줄 3개 이상 → 2개.
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // 중복 제거(입력 순서 보존).
  const uniqueDetected = Array.from(new Set(detected));

  return { cleaned, detected: uniqueDetected };
}
