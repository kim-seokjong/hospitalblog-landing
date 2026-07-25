/**
 * 실행 중(메모리) GEO 질의 캐시 — (엔진, 질의문) 조합으로 응답을 1회만 받는다.
 *
 * 왜 필요한가:
 *   buildGeoQuestions 의 1·4·5번 질문은 "{지역} {진료과} …" 형태라 회원 개인정보가
 *   전혀 들어가지 않는다. 같은 지역·진료과 회원이 N명이면 지금까지는 완전히 동일한
 *   질의를 N번 유료 호출했다. 인용 판정(detectCitation)은 병원명이 회원마다 다르므로
 *   회원별로 각각 수행하되, **API 호출만** 공유한다.
 *
 * 범위: 1회 cron 실행 안에서만 유효한 프로세스 메모리 캐시. DB 캐시 테이블은 만들지 않는다.
 * 동시성: 진행 중인 Promise 를 그대로 캐싱하므로 동시 호출도 1회로 합쳐진다.
 * 실패도 캐싱한다 — 재시도는 어댑터(postJsonWithRetry)가 이미 수행했고,
 * 같은 실패 질의를 회원 수만큼 반복하면 시간·비용 예산이 먼저 소진되기 때문이다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지).
 */

import type { GeoEngineId, GeoLiveAnswer } from './types.ts';

export type GeoCachedOutcome =
  | { readonly ok: true; readonly answer: GeoLiveAnswer }
  | { readonly ok: false; readonly reason: string };

export interface GeoCacheStats {
  /** 캐시 덕분에 절약한 API 호출 수 */
  readonly hits: number;
  /** 실제 API 호출 수 */
  readonly misses: number;
}

export interface GeoQueryCache {
  /**
   * (엔진, 질의문)에 대한 응답을 반환한다. 처음 보는 조합이면 factory 를 1회만 호출한다.
   * factory 가 throw 해도 이 함수는 throw 하지 않고 실패 outcome 을 돌려준다.
   */
  resolve(engine: GeoEngineId, question: string, factory: () => Promise<GeoLiveAnswer>): Promise<GeoCachedOutcome>;
  /** 이미 확정된 결과만 동기 조회 (아직 없으면 undefined) */
  peek(engine: GeoEngineId, question: string): GeoCachedOutcome | undefined;
  stats(): GeoCacheStats;
}

/** 개행은 질의문에 등장하지 않으므로 구분자 충돌이 없다 */
const KEY_SEPARATOR = '\n#';

function cacheKey(engine: GeoEngineId, question: string): string {
  return `${engine}${KEY_SEPARATOR}${question}`;
}

export function createGeoQueryCache(): GeoQueryCache {
  const inflight = new Map<string, Promise<GeoCachedOutcome>>();
  const settled = new Map<string, GeoCachedOutcome>();
  let hits = 0;
  let misses = 0;

  return {
    async resolve(engine, question, factory) {
      const key = cacheKey(engine, question);
      const existing = inflight.get(key);
      if (existing) {
        hits++;
        return existing;
      }

      misses++;
      const pending = factory()
        .then<GeoCachedOutcome>((answer) => ({ ok: true, answer }))
        .catch<GeoCachedOutcome>((e: unknown) => ({
          ok: false,
          reason: e instanceof Error ? e.message : '알 수 없는 오류',
        }))
        .then((outcome) => {
          settled.set(key, outcome);
          return outcome;
        });

      inflight.set(key, pending);
      return pending;
    },

    peek(engine, question) {
      return settled.get(cacheKey(engine, question));
    },

    stats() {
      return { hits, misses };
    },
  };
}
