/**
 * GEO 엔진 레지스트리 + 실행기.
 *
 * 운영 엔진은 **OpenAI + Perplexity 2종**이다.
 * Gemini 는 구글 약관(Grounded Results 의 analyze/cache 금지) 때문에 기본 비활성이며
 * GEO_ENABLE_GEMINI=true 옵트인이 있을 때만 활성화된다 — 아래 ENABLE_GEMINI_FLAG 참조.
 *
 * 안전장치 (매우 중요):
 *  · API 키가 없는 엔진은 **조용히 건너뛴다**. 키가 하나도 없으면 mode:'disabled'.
 *    OPENAI_API_KEY 만 있으면 기존과 완전히 동일하게 동작한다
 *    → 새 환경변수를 넣지 않아도 배포가 깨지지 않는다.
 *  · 한 엔진이 실패해도 나머지 엔진은 계속 돈다. 엔진 실패는 삼키지 않고
 *    failures[] 로 반환해 호출부가 로그·응답에 남긴다.
 *  · 엔진별 동시 실행 수·최소 간격을 따로 둬 레이트리밋을 각각 방어한다.
 *  · 데드라인 도달 시 공통 AbortSignal 로 진행 중인 요청까지 취소한다
 *    (그러지 않으면 함수가 강제 종료되어 수집분이 DB 저장 전에 사라진다).
 *  · 비용 상한은 논리 호출이 아니라 **실제 HTTP 시도 수**에 건다(재시도 포함).
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

import { createAttemptBudget, createChildBudget, type AttemptBudget } from './attempts.ts';
import {
  MAX_CALLS_PER_ENGINE,
  MAX_HTTP_ATTEMPTS_PER_RUN,
  geminiPerRunSearchBudget,
} from './budget.ts';
import { createGeoQueryCache, type GeoQueryCache } from './cache.ts';
import { isGeminiOptedIn } from './flags.ts';
import { geminiEngine } from './gemini.ts';
import { openAiEngine } from './openai.ts';
import { perplexityEngine } from './perplexity.ts';
import { runPool } from './pool.ts';
import type { GeoEngineAdapter, GeoEngineEnv, GeoEngineId } from './types.ts';

/** 등록된 어댑터 전체 (활성 여부와 무관) */
export const GEO_ENGINES: readonly GeoEngineAdapter[] = [openAiEngine, perplexityEngine, geminiEngine];

/**
 * ⚠️ Google Gemini API 약관상 Grounded Results 의 analyze/cache 가 금지되어 있어
 * 이 용도로 사용할 수 없다. 구글과 별도 계약 또는 약관 변경 없이 켜지 말 것.
 * (약관 원문과 상세 근거는 gemini.ts 파일 상단, 판정 함수는 flags.ts 참조)
 *
 * GEMINI_API_KEY 가 설정돼 있어도 그것만으로는 활성화되지 않는다.
 * 값이 **정확히 'true'** 인 GEO_ENABLE_GEMINI 가 있어야 한다(대소문자 변형 거부).
 * 어댑터 자신도 같은 검사를 하므로(gemini.ts) 직접 import 로도 우회되지 않는다.
 */
export { ENABLE_GEMINI_FLAG, isGeminiOptedIn } from './flags.ts';

/** 기본 비활성 엔진 — 옵트인 판정 함수가 true 를 줘야만 활성화된다 */
const OPT_IN_GUARDS: Readonly<Record<string, (env: GeoEngineEnv) => boolean>> = {
  gemini: isGeminiOptedIn,
};

/** 1회 요청 타임아웃 — 웹검색 툴은 응답이 느리다. 데드라인이 더 가까우면 그쪽으로 좁혀진다 */
const REQUEST_TIMEOUT_MS = 60_000;
/** 재시도 포함 시도 횟수. 데드라인을 잠식하지 않도록 2회로 제한 */
const MAX_ATTEMPTS = 2;

export interface EngineThrottle {
  readonly concurrency: number;
  readonly minIntervalMs: number;
}

/**
 * 엔진별 레이트리밋 방어값 (근거는 budget.ts 상단 ②).
 *  · openai     : Responses API 는 티어별 수백 RPM → 동시 6 · 250ms ≈ 43 RPM
 *  · perplexity : sonar Tier0 = 50 RPM → 동시 4 · 1,000ms ≈ 40 RPM
 *  · gemini     : (옵트인 시) 무료 등급 RPM 이 낮음 → 동시 2 · 1,000ms
 */
export const ENGINE_THROTTLE: Readonly<Record<GeoEngineId, EngineThrottle>> = {
  openai: { concurrency: 6, minIntervalMs: 250 },
  perplexity: { concurrency: 4, minIntervalMs: 1_000 },
  gemini: { concurrency: 2, minIntervalMs: 1_000 },
};

/** 옵트인이 필요한 엔진인지, 그리고 정확한 값으로 켜져 있는지 */
function isOptInSatisfied(engineId: GeoEngineId, env: GeoEngineEnv): boolean {
  const guard = OPT_IN_GUARDS[engineId];
  return guard ? guard(env) : true;
}

/** 키가 설정되고 옵트인 조건까지 만족한 엔진만 반환 — 나머지는 조용히 제외 */
export function getEnabledEngines(env: GeoEngineEnv): readonly GeoEngineAdapter[] {
  if ((env.GEO_LIVE_QUERY ?? '').toLowerCase() === 'off') return [];
  return GEO_ENGINES.filter((engine) => isOptInSatisfied(engine.id, env) && engine.isConfigured(env));
}

/** 라이브 질의 활성 여부 — 엔진이 하나라도 설정돼 있으면 true */
export function isGeoLiveQueryEnabled(env: GeoEngineEnv = process.env): boolean {
  return getEnabledEngines(env).length > 0;
}

export interface EngineFailure {
  readonly engine: GeoEngineId;
  readonly question: string;
  readonly reason: string;
}

export interface EngineRunStat {
  readonly engine: GeoEngineId;
  /** 큐에 넣어 실제로 처리를 시도한 논리 호출 수 */
  readonly calls: number;
  readonly succeeded: number;
  readonly failed: number;
  /** 상한/데드라인에 걸려 시작조차 못 한 질의 수 */
  readonly skipped: number;
  /** 재시도를 포함한 실제 HTTP 시도 수 (비용 산정의 정본) */
  readonly httpAttempts: number;
  /** 소비한 검색 질의 수 (Gemini 무료 할당량 차감 단위) */
  readonly searchQueries: number;
}

export interface ExecuteQueriesInput {
  /** 엔진과 무관한 고유 질의문 목록 (중복 제거 완료) */
  readonly questions: readonly string[];
  readonly engines: readonly GeoEngineAdapter[];
  readonly env: GeoEngineEnv;
  readonly fetchImpl?: typeof fetch;
  /** Date.now() 기준 절대 시각 */
  readonly deadlineAt: number;
  readonly maxCallsPerEngine?: number;
  /** 재시도 포함 실제 HTTP 시도 상한 */
  readonly maxHttpAttempts?: number;
  readonly cache?: GeoQueryCache;
  readonly now?: () => number;
  readonly sleepImpl?: (ms: number) => Promise<void>;
}

export interface ExecuteQueriesResult {
  readonly cache: GeoQueryCache;
  readonly stats: readonly EngineRunStat[];
  readonly failures: readonly EngineFailure[];
  /** 전 엔진 합계 실제 HTTP 시도 수 */
  readonly httpAttempts: number;
  /** 데드라인 도달로 진행 중이던 요청을 취소했는가 */
  readonly deadlineReached: boolean;
}

/**
 * 데드라인에 맞춰 abort 되는 공통 시그널.
 * 남은 시간이 이미 지났으면 즉시 aborted 상태로 만든다.
 */
function createDeadlineSignal(
  deadlineAt: number,
  now: () => number,
): { signal: AbortSignal; dispose: () => void; reached: () => boolean } {
  const controller = new AbortController();
  let reached = false;
  const remaining = deadlineAt - now();
  if (remaining <= 0) {
    reached = true;
    controller.abort();
    return { signal: controller.signal, dispose: () => {}, reached: () => reached };
  }
  const timer = setTimeout(() => {
    reached = true;
    controller.abort();
  }, remaining);
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
    reached: () => reached,
  };
}

/**
 * 고유 질의문 × 활성 엔진을 실행해 캐시를 채운다.
 * 엔진끼리는 병렬, 엔진 내부는 워커 풀. 한 엔진의 실패·지연이 다른 엔진을 막지 않는다.
 */
export async function executeGeoQueries(input: ExecuteQueriesInput): Promise<ExecuteQueriesResult> {
  const cache = input.cache ?? createGeoQueryCache();
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const perEngineCap = input.maxCallsPerEngine ?? MAX_CALLS_PER_ENGINE;
  const geminiSearchBudget = geminiPerRunSearchBudget();
  const failures: EngineFailure[] = [];

  // 재시도를 포함한 실제 HTTP 시도 수를 엔진 공용으로 집계한다.
  // 단일 스레드라 tryConsume 의 "검사 후 증가"에 경쟁 조건이 없다.
  const attemptBudget: AttemptBudget = createAttemptBudget(
    input.maxHttpAttempts ?? MAX_HTTP_ATTEMPTS_PER_RUN,
  );
  const deadline = createDeadlineSignal(input.deadlineAt, now);

  try {
    const stats = await Promise.all(
      input.engines.map(async (engine): Promise<EngineRunStat> => {
        const queue = input.questions.slice(0, perEngineCap);
        const throttle = ENGINE_THROTTLE[engine.id];
        // 엔진별 시도 수는 자식 예산으로 센다(공용 카운터 delta 는 동시 실행 시 섞인다)
        const engineBudget = createChildBudget(attemptBudget);
        let succeeded = 0;
        let failed = 0;
        let searchQueries = 0;

        const result = await runPool(
          queue,
          async (question) => {
            // Gemini 는 월 무료 할당량 방어선을 실행 중에도 확인한다.
            // (프롬프트 1건이 검색을 여러 번 실행할 수 있어 사전 계산만으로는 부족)
            // 동시 실행 중인 호출은 아직 소비량을 보고하지 않았으므로 최대
            // (동시 실행 수 - 1)건만큼 초과할 수 있다. 안전마진 20%가 이를 흡수한다.
            if (engine.id === 'gemini' && searchQueries >= geminiSearchBudget) {
              failures.push({
                engine: engine.id,
                question,
                reason: `Gemini 이번 실행 검색 질의 예산(${geminiSearchBudget}) 소진 — 무료 한도 방어로 스킵`,
              });
              failed++;
              return;
            }

            const outcome = await cache.resolve(engine.id, question, () =>
              engine.run(question, {
                fetchImpl,
                env: input.env,
                timeoutMs: REQUEST_TIMEOUT_MS,
                maxAttempts: MAX_ATTEMPTS,
                deadlineAt: input.deadlineAt,
                signal: deadline.signal,
                attemptBudget: engineBudget,
                now: input.now,
                sleepImpl: input.sleepImpl,
              }),
            );

            if (outcome.ok) {
              succeeded++;
              searchQueries += outcome.answer.searchQueryCount;
            } else {
              failed++;
              failures.push({ engine: engine.id, question, reason: outcome.reason });
            }
          },
          {
            concurrency: throttle.concurrency,
            minIntervalMs: throttle.minIntervalMs,
            deadlineAt: input.deadlineAt,
            signal: deadline.signal, // throttle 대기도 데드라인에 즉시 깨어난다
            now: input.now,
            sleepImpl: input.sleepImpl,
          },
        );

        return {
          engine: engine.id,
          calls: result.completed,
          succeeded,
          failed,
          // 엔진 상한으로 큐에서 빠진 것 + 데드라인으로 못 돈 것
          skipped: input.questions.length - queue.length + result.skipped,
          // 자식 예산이 소비 시점에 직접 세므로 다른 엔진의 소비가 섞이지 않는다
          httpAttempts: engineBudget.used(),
          searchQueries,
        };
      }),
    );

    return {
      cache,
      stats,
      failures,
      httpAttempts: attemptBudget.used(),
      deadlineReached: deadline.reached(),
    };
  } finally {
    deadline.dispose();
  }
}
