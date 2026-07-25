/**
 * GEO 엔진 레지스트리 + 실행기.
 *
 * 안전장치 (매우 중요):
 *  · API 키가 없는 엔진은 **조용히 건너뛴다**. 키가 하나도 없으면 mode:'disabled'.
 *    OPENAI_API_KEY 만 있으면 기존과 완전히 동일하게 동작한다
 *    → 새 환경변수를 넣지 않아도 배포가 깨지지 않는다.
 *  · 한 엔진이 실패해도 나머지 엔진은 계속 돈다. 엔진 실패는 삼키지 않고
 *    failures[] 로 반환해 호출부가 로그·응답에 남긴다.
 *  · 엔진별 동시 실행 수·최소 간격을 따로 둬 레이트리밋을 각각 방어한다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

import { MAX_CALLS_PER_ENGINE, geminiPerRunSearchBudget } from './budget.ts';
import { createGeoQueryCache, type GeoQueryCache } from './cache.ts';
import { geminiEngine } from './gemini.ts';
import { openAiEngine } from './openai.ts';
import { perplexityEngine } from './perplexity.ts';
import { runPool } from './pool.ts';
import type { GeoEngineAdapter, GeoEngineEnv, GeoEngineId } from './types.ts';

export const GEO_ENGINES: readonly GeoEngineAdapter[] = [openAiEngine, perplexityEngine, geminiEngine];

/** 1회 요청 타임아웃 — 웹검색 툴은 응답이 느려 넉넉히 준다 */
const REQUEST_TIMEOUT_MS = 60_000;
/** 재시도 포함 시도 횟수. 데드라인을 잠식하지 않도록 2회로 제한 */
const MAX_ATTEMPTS = 2;

export interface EngineThrottle {
  readonly concurrency: number;
  readonly minIntervalMs: number;
}

/**
 * 엔진별 레이트리밋 방어값 (근거는 budget.ts 상단 ②).
 *  · openai     : Responses API 는 티어별 수백 RPM → 동시 4 · 250ms ≈ 최대 240 RPM
 *  · perplexity : sonar Tier0 = 50 RPM → 동시 2 · 1,000ms ≈ 24 RPM
 *  · gemini     : 무료 등급 RPM 이 낮음 → 동시 2 · 1,000ms
 */
export const ENGINE_THROTTLE: Readonly<Record<GeoEngineId, EngineThrottle>> = {
  openai: { concurrency: 4, minIntervalMs: 250 },
  perplexity: { concurrency: 2, minIntervalMs: 1_000 },
  gemini: { concurrency: 2, minIntervalMs: 1_000 },
};

/** 키가 설정된 엔진만 반환 — 없는 엔진은 조용히 제외 */
export function getEnabledEngines(env: GeoEngineEnv): readonly GeoEngineAdapter[] {
  if ((env.GEO_LIVE_QUERY ?? '').toLowerCase() === 'off') return [];
  return GEO_ENGINES.filter((engine) => engine.isConfigured(env));
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
  /** 실제 API 호출 수 */
  readonly calls: number;
  readonly succeeded: number;
  readonly failed: number;
  /** 상한/데드라인에 걸려 실행하지 못한 질의 수 */
  readonly skipped: number;
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
  readonly cache?: GeoQueryCache;
  readonly now?: () => number;
  readonly sleepImpl?: (ms: number) => Promise<void>;
}

export interface ExecuteQueriesResult {
  readonly cache: GeoQueryCache;
  readonly stats: readonly EngineRunStat[];
  readonly failures: readonly EngineFailure[];
}

/**
 * 고유 질의문 × 활성 엔진을 실행해 캐시를 채운다.
 * 엔진끼리는 병렬, 엔진 내부는 워커 풀. 한 엔진의 실패·지연이 다른 엔진을 막지 않는다.
 */
export async function executeGeoQueries(input: ExecuteQueriesInput): Promise<ExecuteQueriesResult> {
  const cache = input.cache ?? createGeoQueryCache();
  const fetchImpl = input.fetchImpl ?? fetch;
  const perEngineCap = input.maxCallsPerEngine ?? MAX_CALLS_PER_ENGINE;
  const geminiSearchBudget = geminiPerRunSearchBudget();
  const failures: EngineFailure[] = [];

  const stats = await Promise.all(
    input.engines.map(async (engine): Promise<EngineRunStat> => {
      const queue = input.questions.slice(0, perEngineCap);
      const throttle = ENGINE_THROTTLE[engine.id];
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
        searchQueries,
      };
    }),
  );

  return { cache, stats, failures };
}
