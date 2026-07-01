import { createHash } from 'node:crypto';
// getAnthropicClient 는 reviewComplianceWithAI 내부에서 동적 import 로만 로드한다.
// 순수 파서(parseAiReviewResponse)를 단위 테스트할 때 SDK/별칭 해석 없이 모듈이
// 로드되도록 하기 위함(node --experimental-strip-types 러너는 tsconfig paths 미해석).

/**
 * Layer B — LLM 심의관(medical-compliance-ai)
 *
 * 하드코딩 키워드(Layer A)가 못 잡는 신종·맥락 위반을 저비용 모델로 재검토한다.
 * 이것은 '글쓰기'가 아니라 '분류/심의' 작업이므로 저비용·빠른 모델을 쓴다
 * (본문 생성 품질 다운그레이드 규칙은 본문 작성에만 적용되며 이 분류 패스에는 무관).
 *
 * 안전 원칙:
 * - 절대 throw 로 생성 흐름을 깨지 않는다(모든 실패는 빈 결과 + 로깅).
 * - 판정은 "위반입니다" 단정 금지 → "위반 소지 / 심의 필요" 톤. 최종 판단은 검수팀.
 * - 방침(recall 최우선): 애매하면 위험으로 판단 — 미탐을 오탐보다 나쁘게 취급.
 */

/**
 * 심의 모델 상수 — anthropic.ts 의 MODEL 패턴을 따라 별도 상수로 분리.
 * 분류/심의용 저비용·빠른 모델(claude-haiku 계열).
 * ⚠️ 실제 배포 전 사용 가능한 정확한 모델 ID 확인 필요(계정/버전에 따라 다를 수 있음).
 */
export const COMPLIANCE_REVIEW_MODEL = 'claude-haiku-4-5';

/** LLM 심의 지적의 심각도. Layer A(ViolationSeverity)와 달리 LOW 를 포함(회색지대 표면화용). */
export type AiViolationSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

/** 의료법 제56조 8개 카테고리 루브릭. */
export const AI_REVIEW_CATEGORIES: readonly string[] = [
  '치료결과보장',
  '과장·최상급',
  '허위안전성',
  '비교·비방',
  '환자유인·알선',
  '전문의약품·의료기기 상품명 광고',
  '환자후기·전후사진',
  '심의미필',
];

/** LLM 심의관이 반환하는 개별 지적. */
export interface AiComplianceFinding {
  category: string;
  snippet: string;
  severity: AiViolationSeverity;
  reason: string;
  needsReview: boolean;
}

/** LLM 심의 결과. reviewed=false 는 심의를 실제로 수행하지 못했음(실패/스킵)을 뜻한다. */
export interface AiComplianceReview {
  findings: AiComplianceFinding[];
  /** AI 심의를 실제 수행했는가(false 면 findings 는 신뢰 불가, UI 는 '심의 미수행'으로 처리). */
  reviewed: boolean;
  /** 실패 사유(로깅/디버깅용, 성공 시 undefined). */
  error?: string;
}

const REVIEW_SYSTEM_PROMPT = `당신은 대한민국 의료광고법(의료법 제56조) 심의를 보조하는 분류기입니다.
주어진 병원 블로그 본문을 아래 8개 카테고리 기준으로만 재검토하고, 위반 소지가 있는 부분을 지적하세요.

【카테고리(8)】
1. 치료결과보장 — 완치·100%·무조건·반드시 낫는다 등 결과 보장
2. 과장·최상급 — 최고·최초·유일·1위·기적 등 과장/배타/최상급
3. 허위안전성 — 부작용 없음·완전히 안전·위험 없는 등 안전성 단정
4. 비교·비방 — 타 병원 대비·다른 병원보다 등 비교/비방
5. 환자유인·알선 — 할인·이벤트·특가·무료·선착순·비급여 가격 단정 등 유인
6. 전문의약품·의료기기 상품명 광고 — 위고비·삭센다·써마지·울쎄라 등 상품명을 광고·유인 목적으로 노출
7. 환자후기·전후사진 — 치료 후기·경험담·전후 비교·비포애프터
8. 심의미필 — 사전 심의가 필요해 보이나 심의 문구가 없는 광고성 서술

【판정 방침 — 매우 중요(recall 최우선)】
- 애매하면 위험으로 판단하라. 미탐(놓침)을 오탐보다 더 나쁘게 취급한다.
- 조금이라도 유인·과장·심의 소지가 보이면 최소 LOW 로 표시하고 needsReview 를 true 로 설정하라.
- 확신이 없으면 위험한 쪽으로 판단하라. 회색지대도 반드시 결과 배열에 포함하라.
- "위반입니다"라고 단정하지 말라 → "위반 소지 / 심의 필요" 톤으로 서술하라. 최종 판단은 검수팀이 한다.

【출력 형식 — 엄격 준수】
- JSON 배열만 출력한다. 설명·머리말·코드펜스(\`\`\`) 없이 배열 그 자체만.
- 각 원소는 다음 형태:
  { "category": <위 8개 중 하나>, "snippet": <문제 원문 일부 최대 60자>, "severity": "HIGH"|"MEDIUM"|"LOW", "reason": <왜 심의 소지인지 한 문장>, "needsReview": true|false }
- 지적할 것이 정말 없으면 빈 배열 [] 을 출력한다.`;

/**
 * 응답 텍스트에서 심의 지적 배열을 안전하게 파싱한다(순수 함수 — 네트워크 없음, 테스트 대상).
 *
 * - 코드펜스/머리말이 섞여도 첫 `[` ~ 마지막 `]` 구간을 추출해 파싱을 시도한다.
 * - 각 원소는 형태를 검증·정규화하고, severity 는 허용값으로 강제(불명값은 LOW).
 * - 어떤 실패도 throw 하지 않고 빈 배열을 반환한다.
 */
export function parseAiReviewResponse(text: string): AiComplianceFinding[] {
  if (!text || typeof text !== 'string') return [];
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const allowed: AiViolationSeverity[] = ['HIGH', 'MEDIUM', 'LOW'];
  const findings: AiComplianceFinding[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const category = typeof item.category === 'string' ? item.category.trim() : '';
    const snippet = typeof item.snippet === 'string' ? item.snippet.trim().slice(0, 200) : '';
    const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
    if (!category && !snippet && !reason) continue; // 완전 빈 원소는 스킵
    const sevRaw = typeof item.severity === 'string' ? item.severity.trim().toUpperCase() : '';
    const severity: AiViolationSeverity = (allowed as string[]).includes(sevRaw)
      ? (sevRaw as AiViolationSeverity)
      : 'LOW'; // 불명 심각도는 recall 우선으로 LOW(표면화)
    // recall 우선: 명시적 false 가 아니면 needsReview 는 true 로 둔다.
    const needsReview = item.needsReview === false ? false : true;
    findings.push({ category: category || '심의미필', snippet, severity, reason, needsReview });
  }
  return findings;
}

/** 본문 해시 → 심의 결과 인메모리 캐시(동일 본문 재검사 방지, 비용 가드). */
const reviewCache = new Map<string, AiComplianceReview>();
const REVIEW_CACHE_MAX = 200;

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * LLM 심의관으로 본문을 재검토한다. **절대 throw 하지 않는다**(실패 시 reviewed=false).
 *
 * 비용 가드: 동일 본문(내용 해시)은 캐시에서 반환해 중복 호출을 막는다.
 */
export async function reviewComplianceWithAI(content: string): Promise<AiComplianceReview> {
  if (!content || content.trim() === '') {
    return { findings: [], reviewed: false };
  }

  const key = hashContent(content);
  const cached = reviewCache.get(key);
  if (cached) return cached;

  let result: AiComplianceReview;
  try {
    const { getAnthropicClient } = await import('@/content/lib/anthropic');
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: COMPLIANCE_REVIEW_MODEL,
      max_tokens: 1500,
      system: REVIEW_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `다음 병원 블로그 본문을 위 8개 카테고리·판정 방침에 따라 심의하고 JSON 배열만 반환하세요.\n\n${content}`,
        },
      ],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    result = { findings: parseAiReviewResponse(text), reviewed: true };
  } catch (error) {
    // 심의 실패는 생성 흐름을 막지 않는다 — 로깅만 하고 빈 결과 반환.
    const message = error instanceof Error ? error.message : 'unknown_error';
    console.error('LLM 심의관(Layer B) 실패:', message);
    result = { findings: [], reviewed: false, error: message };
  }

  // 캐시 저장(성공/실패 무관 — 실패도 재시도 폭주 방지). 용량 초과 시 가장 오래된 항목 제거.
  if (reviewCache.size >= REVIEW_CACHE_MAX) {
    const oldestKey = reviewCache.keys().next().value;
    if (oldestKey !== undefined) reviewCache.delete(oldestKey);
  }
  reviewCache.set(key, result);
  return result;
}
