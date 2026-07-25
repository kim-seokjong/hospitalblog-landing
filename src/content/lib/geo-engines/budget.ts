/**
 * GEO cron 실행 예산 — 상한 재산정 로직 (순수 함수, 외부 의존 없음).
 *
 * ────────────────────────────────────────────────────────────────────────
 * 상한을 다시 계산한 이유
 *
 * 구 코드: MAX_USERS=100, MAX_TOTAL_QUERIES=200, 회원당 3질의.
 *   → 3질의 × 67명 = 201 이므로 **67번째 회원부터 질의가 조용히 잘렸다.**
 *     응답 users/queries 만 보고는 잘린 사실을 알 수 없었다(침묵 실패).
 *
 * 신 구조: 회원당 5질의 × 최대 3엔진 = 회원당 최대 15 API 호출.
 *   100명이면 이론상 1,500 호출인데, 실제 상한은 세 가지가 동시에 건다.
 *
 * ① 실행 시간 (가장 강한 제약)
 *    vercel.json 의 geo-tracking maxDuration = 300초.
 *    DB 배치 insert·응답 직렬화 여유로 30초를 남기고 270초를 질의에 쓴다.
 *    엔진은 서로 병렬, 엔진 내부는 소규모 워커 풀:
 *      OpenAI     동시 4 · 평균 8초  → 270초에 약 135건
 *      Perplexity 동시 2 · 평균 5초  → 270초에 약 108건
 *      Gemini     동시 2 · 평균 7초  → 270초에 약  77건 (리다이렉트 복원 포함)
 *    합계 약 320건. 여기에 캐시 히트(0초)가 더해진다.
 *    → 엔진당 상한 MAX_CALLS_PER_ENGINE = 120, 전체 상한 300 으로 둔다.
 *      (시간이 먼저 소진되면 데드라인 가드가 잘라내고 그 수를 응답에 명시한다)
 *
 * ② 레이트리밋
 *    Perplexity sonar Tier0 = 50 RPM → 동시 2 + 최소 간격 1,000ms ≈ 24 RPM. 안전.
 *    Gemini 무료 등급 RPM 이 낮아 동일하게 동시 2 + 1,000ms.
 *    OpenAI Responses 는 티어별 수백 RPM → 동시 4 + 250ms ≈ 최대 240 RPM. 안전.
 *
 * ③ Gemini 무료 할당량 (아래 geminiPerRunSearchBudget 참조)
 *
 * 회원 단위 절단은 "전부 아니면 전무"로 한다. 회원당 5질의 중 2개만 수행되면
 * 주간 인용률 집계가 그 회원에 대해 왜곡되기 때문이다.
 * ────────────────────────────────────────────────────────────────────────
 */

/** 1회 실행에서 조회할 유료 회원 상한 */
export const MAX_USERS = 100;
/** 1회 실행 전체 API 호출(캐시 미스) 상한 — 실행 시간 산정 근거는 위 ① */
export const MAX_API_CALLS_PER_RUN = 300;
/** 엔진 1개가 전체 예산을 독식하지 못하게 하는 엔진별 상한 */
export const MAX_CALLS_PER_ENGINE = 120;
/** maxDuration 300초 중 질의에 배정하는 시간 (나머지는 DB 배치 insert·응답용) */
export const QUERY_DEADLINE_MS = 270_000;

// ---------------------------------------------------------------------------
// Gemini 무료 할당량 가드
// ---------------------------------------------------------------------------

/**
 * Gemini 3 계열 결제 등급의 그라운딩 무료 할당량 (ai.google.dev/gemini-api/docs/pricing).
 * "5,000 prompts per month (free, shared across Gemini 3), then $14 / 1,000 search queries"
 * 단위가 프롬프트가 아니라 **모델이 실행한 검색 질의**임에 유의
 * ("billed for each search query that the model decides to execute").
 */
export const GEMINI_FREE_MONTHLY_SEARCH_QUERIES = 5_000;

/**
 * 한 달에 들어갈 수 있는 월요일은 최대 5회다(주 1회 cron).
 * 4.34주 평균이 아니라 최악값 5로 나눠야 5주짜리 달에 초과가 안 난다.
 */
export const GEO_RUNS_PER_MONTH = 5;

/**
 * 안전 마진 20%. 수동 재실행·재시도·모델이 프롬프트 1건에 검색을 여러 번
 * 실행하는 경우를 흡수한다.
 */
export const GEMINI_SAFETY_RATIO = 0.8;

export interface GeminiBudgetInput {
  readonly monthlyFreeQueries?: number;
  readonly runsPerMonth?: number;
  readonly safetyRatio?: number;
}

/**
 * 이번 실행에서 Gemini 에 허용할 검색 질의 수.
 * 계산: floor(월 무료 할당량 × 안전마진 ÷ 월 실행 횟수)
 *      = floor(5,000 × 0.8 ÷ 5) = 800
 * 실제로는 MAX_CALLS_PER_ENGINE(120) 이 먼저 걸리므로 이 값은 2차 방어선이다
 * (120 호출 × 프롬프트당 검색 3회 = 360 < 800).
 */
export function geminiPerRunSearchBudget(input: GeminiBudgetInput = {}): number {
  const monthly = input.monthlyFreeQueries ?? GEMINI_FREE_MONTHLY_SEARCH_QUERIES;
  const runs = Math.max(1, input.runsPerMonth ?? GEO_RUNS_PER_MONTH);
  const ratio = input.safetyRatio ?? GEMINI_SAFETY_RATIO;
  return Math.max(0, Math.floor((monthly * ratio) / runs));
}

// ---------------------------------------------------------------------------
// 회원 단위 질의 계획 절단
// ---------------------------------------------------------------------------

export interface UserQuestionPlan {
  readonly userId: string;
  readonly questions: readonly string[];
}

export interface CappedQuestionPlan {
  readonly kept: readonly UserQuestionPlan[];
  /** 실제로 API 를 호출해야 하는 고유 질의문 (엔진당 이 수만큼 호출) */
  readonly uniqueQuestions: readonly string[];
  /** 상한에 걸려 질의를 한 건도 받지 못한 회원 수 (응답에 명시 → 침묵 실패 방지) */
  readonly truncatedUsers: number;
  /** 그로 인해 수행되지 못한 (회원 × 질문) 수 */
  readonly droppedQuestions: number;
}

/**
 * 회원 단위로 질의 계획을 "고유 질의문 수" 상한에 맞춰 자른다.
 *
 * 상한을 (회원 × 질문) 총량이 아니라 **고유 질의문 수**로 거는 것이 핵심이다.
 * "{지역} {진료과} 추천해줘" 류는 같은 지역·진료과 회원끼리 완전히 동일하므로
 * 메모리 캐시가 API 호출을 1회로 합친다 → 그런 회원은 예산을 거의 쓰지 않고
 * 더 많이 처리할 수 있다. 총량 기준으로 자르면 이 이득이 통째로 버려진다.
 *
 * 회원은 "전부 아니면 전무"로 넣는다. 5질의 중 2개만 수행되면 그 회원의
 * 주간 인용률이 왜곡되기 때문이다. 첫 번째로 상한을 넘기는 회원에서 멈춘다
 * (뒤쪽의 작은 회원만 골라 통과시키면 주차 간 처리 순서가 뒤바뀐다).
 */
export function capQuestionPlan(
  plans: readonly UserQuestionPlan[],
  maxUniqueQuestions: number,
): CappedQuestionPlan {
  const kept: UserQuestionPlan[] = [];
  const unique = new Set<string>();
  let stopIndex = plans.length;

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const merged = new Set(unique);
    for (const question of plan.questions) merged.add(question);
    if (merged.size > maxUniqueQuestions) {
      stopIndex = i;
      break;
    }
    kept.push(plan);
    for (const question of plan.questions) unique.add(question);
  }

  const dropped = plans.slice(stopIndex);
  return {
    kept,
    uniqueQuestions: Array.from(unique),
    truncatedUsers: dropped.length,
    droppedQuestions: dropped.reduce((sum, p) => sum + p.questions.length, 0),
  };
}

/**
 * 활성 엔진 수에 따른 고유 질의문 상한.
 *   min(엔진당 상한, 전체 호출 상한 ÷ 엔진 수)
 * 예) 3엔진 → min(120, 100) = 100 고유질의 × 3엔진 = 300 호출
 *     1엔진(OpenAI 만 설정된 현재 상태) → min(120, 300) = 120 호출
 */
export function maxUniqueQuestionsFor(engineCount: number): number {
  if (engineCount <= 0) return 0;
  return Math.min(MAX_CALLS_PER_ENGINE, Math.floor(MAX_API_CALLS_PER_RUN / engineCount));
}
