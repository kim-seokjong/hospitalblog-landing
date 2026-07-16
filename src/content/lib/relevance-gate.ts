/**
 * LLM 관련성 게이트 (황금 키워드 전용).
 *
 * specialty-filter.ts 블랙리스트는 진료과 명칭·시그니처 시술어 기반이라,
 * 진료과명이 안 들어간 무관 키워드(예: 피부과+보톡스 → "다이어트 도시락")는
 * 그대로 통과한다. 이 게이트가 저비용 모델(haiku) 배치 판정으로 마저 거른다.
 *
 * 파이프라인 위치: 블랙리스트 필터 통과 후보(여유분 40개) → **이 게이트** →
 * 관련 판정 상위 20개만 블로그 문서수 조회 — 비용 있는 오픈API 호출 전에 거른다.
 *
 * 안전 원칙 (medical-compliance-ai.ts Layer B 와 동일 철학):
 * - **절대 throw 하지 않는다.** 키 없음/호출 실패/타임아웃/파싱 실패 전부
 *   applied:false + 입력 그대로 반환(게이트 건너뜀) — 기능이 죽으면 안 된다.
 * - 판정은 보수적(recall 최우선): 애매하면 관련 있음으로 통과. 과차단이 더 나쁘다.
 * - 모델은 이 게이트 전용 상수 — 다른 곳(본문 생성 MODEL 등)과 무관.
 */

/** 게이트 전용 판정 모델 — 비용 최소화용. 본문 생성 MODEL 과 별개. */
export const RELEVANCE_GATE_MODEL = 'claude-haiku-4-5-20251001';
/** 게이트에 넣는 후보 여유분 — 걸러진 뒤에도 최종 20개를 채우기 위한 풀 크기 */
export const RELEVANCE_POOL_LIMIT = 40;
/** LLM 판정 타임아웃 — 초과 시 게이트 건너뜀 (라우트 maxDuration 30s 배려) */
export const RELEVANCE_GATE_TIMEOUT_MS = 8000;
/** 배치 판정 응답 상한 — 후보 40개 키워드 JSON 배열이면 충분 */
export const RELEVANCE_GATE_MAX_TOKENS = 1024;

/** LLM 응답 최소 형태 (Anthropic messages.create 응답의 부분집합) */
export interface RelevanceGateMessage {
  content: Array<{ type: string; text?: string }>;
}

/** LLM 호출 함수 — 테스트에서 목으로 주입. 미주입 시 anthropic.ts 클라이언트 사용. */
export type RelevanceGateCreate = (params: {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: 'user'; content: string }>;
}) => Promise<RelevanceGateMessage>;

export interface RelevanceGateInput {
  /** 사용자가 입력한 씨앗 키워드 */
  seed: string;
  /** 사용자 진료과 (없으면 씨앗 키워드 기준으로만 판정) */
  specialty?: string;
  /** 블랙리스트 필터를 통과한 후보 키워드 목록 */
  candidates: readonly string[];
}

export interface RelevanceGateResult {
  /** LLM 판정이 실제로 적용됐는가 (false 면 keywords 는 입력 그대로) */
  applied: boolean;
  /** 통과 키워드 — 입력 순서 보존. applied:false 면 입력 전체. */
  keywords: string[];
}

const GATE_SYSTEM_PROMPT = `당신은 병원 블로그 마케팅 키워드 선별기입니다.
씨앗 키워드·진료과와 후보 키워드 목록이 주어집니다.
"이 병원 블로그의 글 주제로서 씨앗 키워드·진료과와 관련 있는" 후보만 골라 JSON 배열로 반환하세요.

【판정 방침 — 보수적 (매우 중요)】
- 애매하면 관련 있음으로 통과시켜라. 잘못 제외(과차단)가 잘못 통과보다 훨씬 나쁘다.
- 확실히 무관한 것만 제외하라: 전혀 다른 진료 영역, 병원 진료와 무관한 일반 상품·서비스·직업·장소 등.
- 지역명이 붙은 변형(예: "강남" + 시술명), 가격·비용·후기·부작용 등 속성이 붙은 변형은 관련 있음.
- 씨앗 키워드와 같은 진료과에서 함께 다루는 인접 시술·증상 키워드도 관련 있음.

【출력 형식 — 엄격 준수】
- JSON 배열만 출력한다. 설명·머리말·코드펜스(\`\`\`) 없이 배열 그 자체만.
- 배열 원소는 후보 목록에 있는 키워드 문자열을 한 글자도 바꾸지 말고 그대로 쓴다.
- 전부 관련 있으면 후보 전체를 반환한다.`;

/** 판정 user 프롬프트 구성 (순수 함수). */
export function buildRelevancePrompt(input: RelevanceGateInput): string {
  const specialty = (input.specialty ?? '').trim();
  return [
    `씨앗 키워드: ${input.seed.trim()}`,
    `진료과: ${specialty || '미설정 (씨앗 키워드 기준으로만 판정)'}`,
    `후보 키워드 목록: ${JSON.stringify(input.candidates)}`,
    '',
    '위 후보 중 관련 있는 키워드만 JSON 배열로 반환하세요.',
  ].join('\n');
}

/**
 * 응답 텍스트에서 통과 키워드 배열을 안전하게 파싱한다 (순수 함수).
 *
 * - 코드펜스·머리말이 섞여도 첫 `[` ~ 마지막 `]` 구간을 추출해 파싱한다.
 * - 후보 목록에 없는 항목(환각)은 버리고, **입력 후보 순서**를 보존한다.
 * - JSON 이 아니거나 배열이 아니면 null (호출부가 폴백 판단).
 */
export function parseRelevantKeywords(
  text: string,
  candidates: readonly string[]
): string[] | null {
  if (!text || typeof text !== 'string') return null;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const returned = new Set(
    parsed.filter((v): v is string => typeof v === 'string').map((v) => v.trim())
  );
  return candidates.filter((c) => returned.has(c.trim()));
}

/** Promise 타임아웃 래퍼 — 초과 시 reject (타이머는 반드시 해제). */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`relevance_gate_timeout_${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 기본 LLM 호출 함수 — anthropic.ts 클라이언트 사용.
 * 동적 import: 테스트(목 주입·키 없음 스킵)에서는 SDK 로드 자체가 일어나지 않는다.
 */
async function loadDefaultCreateMessage(): Promise<RelevanceGateCreate> {
  const { getAnthropicClient } = await import('./anthropic.ts');
  const client = getAnthropicClient();
  return (params) => client.messages.create(params);
}

/**
 * 후보 키워드를 LLM 배치 판정(1콜)으로 거른다. **절대 throw 하지 않는다.**
 *
 * 폴백 (전부 applied:false + 입력 그대로 반환, 서버 로그만):
 * - ANTHROPIC_API_KEY 미설정 → 게이트 자동 스킵
 * - 호출 실패·타임아웃 → 게이트 건너뜀
 * - JSON 파싱 실패·빈 배열(전멸 판정) → 오판정 가능성이 높다고 보고 건너뜀
 */
export async function filterCandidatesByRelevance(
  input: RelevanceGateInput,
  options: {
    env?: NodeJS.ProcessEnv;
    /** 테스트 주입용 LLM 호출 함수 (미주입 시 anthropic.ts 클라이언트) */
    createMessage?: RelevanceGateCreate;
    timeoutMs?: number;
  } = {}
): Promise<RelevanceGateResult> {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? RELEVANCE_GATE_TIMEOUT_MS;
  const candidates = input.candidates.filter((k) => k.trim() !== '');
  const skipped: RelevanceGateResult = { applied: false, keywords: [...candidates] };

  if (candidates.length === 0) return skipped;
  if (!env.ANTHROPIC_API_KEY?.trim()) return skipped;

  try {
    const createMessage = options.createMessage ?? (await loadDefaultCreateMessage());
    const response = await withTimeout(
      createMessage({
        model: RELEVANCE_GATE_MODEL,
        max_tokens: RELEVANCE_GATE_MAX_TOKENS,
        system: GATE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildRelevancePrompt({ ...input, candidates }) }],
      }),
      timeoutMs
    );

    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && typeof textBlock.text === 'string' ? textBlock.text : '';
    const kept = parseRelevantKeywords(text, candidates);

    // 파싱 실패 또는 전멸 판정(빈 배열)은 오판정 가능성이 높다 — recall 우선으로 건너뜀
    if (kept === null || kept.length === 0) {
      console.error('[relevance-gate] 응답 파싱 실패/빈 판정 — 게이트 건너뜀');
      return skipped;
    }
    return { applied: true, keywords: kept };
  } catch (error) {
    console.error(
      '[relevance-gate] LLM 판정 실패 — 게이트 건너뜀:',
      error instanceof Error ? error.message : error
    );
    return skipped;
  }
}
