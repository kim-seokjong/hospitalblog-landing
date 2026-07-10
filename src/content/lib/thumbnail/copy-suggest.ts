/**
 * 썸네일 카피 톤 변환 — 긴 SEO 제목을 3초 카피로 "깎는다".
 *
 * 5패턴(숫자 커팅/양자택일/반전 단언/질문 남기기/공감 호명) 각 1안을 Claude 로
 * 생성한다. 원제에 패턴이 안 맞으면(예: 숫자 없음) 그 패턴은 생략 가능 — 5개 미만 허용.
 *
 * 공통 규칙: 최대 2줄 · 줄당 8~10자, 지역/진료 키워드는 klabel 로 분리,
 * accentWord 는 줄 안의 어절 1개, 의료광고법 금지 표현 방어(프롬프트 + 사후 필터).
 */

import { getAnthropicClient, MODEL } from '@/content/lib/anthropic';

/** 카피 패턴 5종 */
export type CopyPattern = 'number-cut' | 'either-or' | 'reversal' | 'question' | 'empathy';

export const COPY_PATTERN_LABELS: Record<CopyPattern, string> = Object.freeze({
  'number-cut': '숫자 커팅',
  'either-or': '양자택일',
  reversal: '반전 단언',
  question: '질문 남기기',
  empathy: '공감 호명',
});

export interface CopySuggestion {
  readonly pattern: CopyPattern;
  /** 한국어 패턴명 (UI 표시용) */
  readonly patternLabel: string;
  /** 지역/진료 키워드 라벨 (카드 klabel) */
  readonly klabel: string;
  /** 카피 1줄째 (8~10자) */
  readonly line1: string;
  /** 카피 2줄째 (선택) */
  readonly line2?: string;
  /** line1/line2 안의 강조 어절 1개 */
  readonly accentWord: string;
}

export interface CopySuggestInput {
  readonly title: string;
  readonly keyword?: string;
  readonly hospitalType?: string;
}

/** 의료광고법 방어 — 카피에 들어가면 안 되는 표현(사후 필터, recall 우선). */
const BANNED_FRAGMENTS: readonly string[] = Object.freeze([
  '100%',
  '최고',
  '최상',
  '유일',
  '1등',
  '완치',
  '보장',
  '전후',
  '비포',
  '애프터',
  '부작용 없',
  '부작용없',
  '확실한 효과',
  '즉시 효과',
]);

function buildSystemPrompt(): string {
  return `당신은 병의원 블로그 썸네일 카피라이터입니다. 긴 SEO 제목을 "다시 쓰지 말고, 깎아서" 3초 안에 읽히는 썸네일 카피로 변환합니다.

【5가지 패턴 — 각 1안, 총 최대 5안】
① number-cut(숫자 커팅): 제목에 숫자가 있으면 숫자를 주인공으로. accentWord = 숫자 어절.
② either-or(양자택일): "A vs B" 또는 선택 구조가 있으면 그 구조를 보존하며 축약.
③ reversal(반전 단언): 통념을 뒤집는 한 문장. 반드시 절제·정직 방향만 (예: "다 뽑을 필요 없습니다"). 과장·효과 단정 금지.
④ question(질문 남기기): 원제가 질문이면 앞머리만 제거하고 질문을 축약.
⑤ empathy(공감 호명): 증상을 겪는 사람을 부르는 카피 (예: "시린 이, 참고 계셨죠"). 공포 조장 금지.

【공통 규칙 — 전부 엄수】
- 최대 2줄, 줄당 8~10자 (한글 기준, 공백 포함 12자 초과 금지)
- 지역명/진료 키워드는 카피에서 빼고 klabel 로 분리 (예: "신림동 치아교정")
- accentWord = line1 또는 line2 안에 실제로 존재하는 어절 딱 1개
- 원제에 패턴이 맞지 않으면 그 패턴은 생략 (억지로 만들지 말 것 — 5개 미만 허용)
- 의료광고법 금지: "100%", "최고", "완치", "보장", "유일", 전후(비포/애프터) 비교, 효과 단정("~됩니다", "즉시 효과"), 공포 조장, 치료 결과 암시 — 전부 금지
- 의학적 사실을 새로 만들지 말 것. 원제에 없는 주장 추가 금지.

【출력 형식 — JSON만, 다른 텍스트 금지】
{"suggestions":[{"pattern":"number-cut","klabel":"...","line1":"...","line2":"...","accentWord":"..."}]}
line2 가 없으면 생략 가능. 코드블록 없이 JSON 만 출력하세요.`;
}

function buildUserPrompt(input: CopySuggestInput): string {
  const parts = [`원제(SEO 제목): ${input.title}`];
  if (input.keyword) parts.push(`핵심 키워드: ${input.keyword}`);
  if (input.hospitalType) parts.push(`진료과: ${input.hospitalType}`);
  return `${parts.join('\n')}\n\n위 제목을 5패턴 썸네일 카피로 변환해 JSON 으로만 출력하세요.`;
}

const VALID_PATTERNS: readonly CopyPattern[] = Object.freeze([
  'number-cut',
  'either-or',
  'reversal',
  'question',
  'empathy',
]);

function isCopyPattern(v: unknown): v is CopyPattern {
  return typeof v === 'string' && (VALID_PATTERNS as readonly string[]).includes(v);
}

function containsBanned(text: string): boolean {
  return BANNED_FRAGMENTS.some((b) => text.includes(b));
}

/** 한 줄 카피 검증 — 공백 포함 12자(여유치)까지 허용. */
function isValidLine(line: string): boolean {
  const len = [...line].length;
  return len > 0 && len <= 12;
}

/** Claude 응답(JSON 문자열)을 안전하게 파싱·검증한다. 부적합 안은 조용히 제외. */
export function parseCopySuggestions(rawText: string): CopySuggestion[] {
  const jsonText = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }

  const list = (parsed as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) return [];

  const seen = new Set<CopyPattern>();
  const result: CopySuggestion[] = [];

  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const s = item as Record<string, unknown>;
    if (!isCopyPattern(s.pattern) || seen.has(s.pattern)) continue;

    const line1 = typeof s.line1 === 'string' ? s.line1.trim() : '';
    const line2 = typeof s.line2 === 'string' ? s.line2.trim() : '';
    const klabel = typeof s.klabel === 'string' ? s.klabel.trim().slice(0, 24) : '';
    let accentWord = typeof s.accentWord === 'string' ? s.accentWord.trim() : '';

    if (!isValidLine(line1)) continue;
    if (line2 && !isValidLine(line2)) continue;

    const fullCopy = `${line1} ${line2} ${klabel}`;
    if (containsBanned(fullCopy)) continue;

    // accentWord 는 카피 안에 실제 존재해야 함 — 없으면 강조 없이 채택
    if (accentWord && !line1.includes(accentWord) && !line2.includes(accentWord)) {
      accentWord = '';
    }

    seen.add(s.pattern);
    result.push({
      pattern: s.pattern,
      patternLabel: COPY_PATTERN_LABELS[s.pattern],
      klabel,
      line1,
      line2: line2 || undefined,
      accentWord,
    });
  }

  return result;
}

/**
 * 글 제목에서 썸네일 카피 5안(최대)을 생성한다.
 * Claude 호출 실패 시 예외를 던진다 — 라우트에서 사용자 메시지로 변환.
 */
export async function suggestThumbnailCopy(input: CopySuggestInput): Promise<CopySuggestion[]> {
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('카피 생성 응답이 비어 있습니다.');
  }

  return parseCopySuggestions(textBlock.text);
}
