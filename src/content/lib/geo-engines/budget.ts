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
 * 신 구조: 회원당 5질의 × 운영 엔진 2종(OpenAI · Perplexity) = 회원당 최대 10 논리 호출.
 *   (Gemini 는 구글 약관 문제로 기본 비활성 — gemini.ts 상단 경고 참조)
 *   100명이면 이론상 1,000 호출인데, 실제 상한은 네 가지가 동시에 건다.
 *
 * ① 실행 시간 (가장 강한 제약)
 *    vercel.json 의 geo-tracking maxDuration = 300초.
 *    **DB 저장 단계까지 반드시 도달해야 하므로** 질의는 200초에서 끊는다
 *    (구간별 상한은 아래 "실행 시간 예산" 블록에서 절대 시각으로 못박는다).
 *    엔진은 서로 병렬, 엔진 내부는 소규모 워커 풀:
 *      OpenAI     동시 6 · 평균 8초(+250ms) → 120건에 약 165초
 *      Perplexity 동시 4 · 평균 5초(+1s)    → 120건에 약 180초
 *    → 엔진당 상한 MAX_CALLS_PER_ENGINE = 120 이면 200초 안에 들어온다.
 *      (그래도 모자라면 데드라인 가드가 잘라내고 그 수를 응답에 명시한다)
 *
 * ② 레이트리밋
 *    Perplexity sonar Tier0 = 50 RPM → 동시 4 + 최소 간격 1,000ms ≈ 40 RPM. 안전.
 *    OpenAI Responses 는 티어별 수백 RPM → 동시 6 + 250ms ≈ 43 RPM. 안전.
 *    Gemini(옵트인 시) 무료 등급 RPM 이 낮아 동시 2 + 1,000ms.
 *
 * ③ 비용 = **실제 HTTP 시도 수** (재시도 포함)
 *    논리 호출 1건이 최대 2회 HTTP 요청을 보낸다. 외부 API 는 재시도든 아니든
 *    요청 단위로 과금되므로 상한은 시도 수에 걸어야 의미가 있다.
 *    MAX_HTTP_ATTEMPTS_PER_RUN = 288 = 논리 호출 240 × 1.2(재시도 20% 여유).
 *    이 카운터는 엔진 공용이며 소진되면 더 이상 호출하지 않는다(attempts.ts).
 *
 * ④ Gemini 무료 할당량 (아래 geminiPerRunSearchBudget 참조 — 옵트인 시에만 의미)
 *
 * 회원 단위 절단은 "전부 아니면 전무"로 한다. 회원당 5질의 중 2개만 수행되면
 * 주간 인용률 집계가 그 회원에 대해 왜곡되기 때문이다.
 * ────────────────────────────────────────────────────────────────────────
 */

/** 1회 실행에서 조회할 유료 회원 상한 */
export const MAX_USERS = 100;
/** 1회 실행 전체 논리 호출(캐시 미스) 상한 — 실행 시간 산정 근거는 위 ① */
export const MAX_API_CALLS_PER_RUN = 240;
/** 엔진 1개가 전체 예산을 독식하지 못하게 하는 엔진별 상한 */
export const MAX_CALLS_PER_ENGINE = 120;
/**
 * 1회 실행 실제 HTTP 시도 상한 (재시도 포함) — 비용 상한의 정본.
 * = MAX_API_CALLS_PER_RUN × 1.2 (평시 재시도율 여유)
 */
export const MAX_HTTP_ATTEMPTS_PER_RUN = 288;
// ---------------------------------------------------------------------------
// 실행 시간 예산 — 모든 구간에 "요청 시작 시각 기준 절대 마감"을 강제한다
// ---------------------------------------------------------------------------
//
// ★ 상수 합계만 맞춰서는 아무것도 보장되지 않는다. 아래 각 마감은 실제 제어 흐름에서
//   강제되며, 강제 지점을 주석에 명시한다(geo-tracking-run.ts 의 단계 번호).
//
//   0s   ─ 요청 진입. startedAt 고정.
//  20s   ─ PREFLIGHT_DEADLINE_MS  [강제: runGeoTracking 1~3단계]
//            잠금 insert·stale 인계·유료회원 count·profiles 조회·이번주 중복조회.
//            각 호출 타임아웃 = min(5s, 마감까지 남은 시간). 예산 초과 시
//            **외부 API 를 시작하지 않고** 잠금을 failed 로 정리하고 종료한다.
//            (여기에 마감이 없으면 DB 지연만으로 300초를 넘길 수 있다)
// 200s   ─ QUERY_DEADLINE_MS      [강제: executeGeoQueries 의 공통 AbortSignal]
//            · 진행 중 fetch 취소(http.ts) · throttle sleep 즉시 깨움(pool.ts)
//            · 재시도 backoff 즉시 깨움(http.ts abortableSleep)
//            · Gemini 리다이렉트 복원 취소(gemini.ts)
// 205s   ─ + QUERY_DRAIN_ALLOWANCE_MS(5s). 취소 전파·워커 정리 여유
// 210s   ─ MATCH_DEADLINE_MS      [강제: runGeoTracking 6단계 루프의 회원별 시각 검사]
//            인용 판정은 순수 문자열 매칭이지만 상한을 코드로 검사하고,
//            초과 시 중단하고 truncated.matchAborted 로 보고한다.
// 285s   ─ SAVE_DEADLINE_MS       [강제: runGeoTracking 7단계 청크 루프]
//            청크별 타임아웃 = min(10s, 남은 시간). 남은 시간이 1s 미만이면 중단.
//            → 마지막 청크는 284s 에 시작해도 285s 에 끝난다
// 288s   ─ FINALIZE_DEADLINE_MS   [강제: finally 의 잠금 마무리]
//            타임아웃 = min(3s, 288s까지 남은 시간)
// 290s   ─ + RESPONSE_ALLOWANCE_MS(2s). 응답 직렬화
//            (failures/insertErrors 는 배열 길이 상한으로 크기를 묶는다)
//
//   최악 총합 290s < 300s (여유 10s).

/** Vercel 함수 실행 한도 (vercel.json 의 geo-tracking maxDuration 과 일치) */
export const PLATFORM_MAX_DURATION_MS = 300_000;
/** 외부 API 호출 이전 DB 준비 작업 전체의 마감 */
export const PREFLIGHT_DEADLINE_MS = 20_000;
/** 준비 작업 1건당 타임아웃 (남은 시간이 더 짧으면 그쪽으로 좁힌다) */
export const PREFLIGHT_OP_TIMEOUT_MS = 5_000;
/** 준비 작업을 시작하려면 최소 이만큼은 남아 있어야 한다 */
export const MIN_PREFLIGHT_WINDOW_MS = 500;
/** 질의를 중단시키는 시각 — 이후 진행 중인 요청도 AbortSignal 로 취소된다 */
export const QUERY_DEADLINE_MS = 200_000;
/** 취소 전파·워커 정리 여유 */
export const QUERY_DRAIN_ALLOWANCE_MS = 5_000;
/** 인용 판정 루프 마감 */
export const MATCH_DEADLINE_MS = 210_000;
/** 이 시각 이후로는 새 DB insert 청크를 시작하지 않는다 */
export const SAVE_DEADLINE_MS = 285_000;
/** insert 청크 1건 타임아웃 (남은 시간이 더 짧으면 그쪽으로 좁힌다) */
export const INSERT_CHUNK_TIMEOUT_MS = 10_000;
/** 이보다 적게 남았으면 청크를 시작하지 않는다 */
export const MIN_INSERT_WINDOW_MS = 1_000;
/** 잠금 마무리 마감 — 에러 경로에서도 이 시각을 넘기지 않는다 */
export const FINALIZE_DEADLINE_MS = 288_000;
/** 실행 잠금 마무리 update 타임아웃 */
export const LOCK_FINALIZE_TIMEOUT_MS = 3_000;
/** 응답 직렬화 여유 */
export const RESPONSE_ALLOWANCE_MS = 2_000;

/** 응답에 싣는 배열 길이 상한 — 직렬화 시간을 묶어 마지막 구간을 예측 가능하게 한다 */
export const MAX_REPORTED_FAILURES = 50;

/**
 * 최악 실행 시간 = 마지막으로 강제되는 절대 마감 + 응답 직렬화 여유.
 * 앞 구간이 아무리 지연돼도 각 단계가 자기 절대 마감에서 잘리므로
 * 총합은 이 값을 넘지 않는다(구간별 강제 지점은 위 표 참조).
 */
export function worstCaseRuntimeMs(): number {
  return FINALIZE_DEADLINE_MS + RESPONSE_ALLOWANCE_MS;
}

/**
 * 절대 마감까지 남은 시간에 맞춰 좁힌 작업 타임아웃.
 * 남은 시간이 minMs 미만이면 null — 호출부는 그 작업을 시작하지 않는다.
 */
export function clampTimeout(
  nowMs: number,
  deadlineAt: number,
  maxMs: number,
  minMs: number,
): number | null {
  const remaining = deadlineAt - nowMs;
  if (remaining < minMs) return null;
  return Math.min(maxMs, remaining);
}

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
 * 예) 2엔진(운영 기본 OpenAI+Perplexity) → min(120, 120) = 120 고유질의 × 2 = 240 호출
 *     1엔진(OpenAI 만 설정) → min(120, 240) = 120 호출
 *     3엔진(Gemini 옵트인)  → min(120,  80) =  80 고유질의 × 3 = 240 호출
 */
export function maxUniqueQuestionsFor(engineCount: number): number {
  if (engineCount <= 0) return 0;
  return Math.min(MAX_CALLS_PER_ENGINE, Math.floor(MAX_API_CALLS_PER_RUN / engineCount));
}
