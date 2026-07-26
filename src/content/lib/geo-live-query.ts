/**
 * GEO 라이브 질의 — 하위 호환 파사드.
 *
 * 실제 구현은 엔진별 어댑터로 이전했다(src/content/lib/geo-engines/).
 * 이 파일은 기존 import 경로(@/content/lib/geo-live-query)와 **기존 공개 API**를
 * 그대로 유지하기 위한 얇은 재수출이다. 내부 구현만 새 구조를 쓴다.
 *   · GEO_QUERY_ENGINE — 구 기본 엔진 식별자
 *   · runGeoLiveQuery  — 구 단일 질의 함수
 *   · isGeoLiveQueryEnabled — 활성 여부
 *
 * 활성 조건: GEO_LIVE_QUERY !== 'off' 이고 엔진 키가 하나 이상 설정됨.
 *   OPENAI_API_KEY / PERPLEXITY_API_KEY (+ 옵트인 시 GEMINI_API_KEY)
 *   → 키가 없는 엔진은 조용히 제외되고, 전부 없으면 준비도 점수 모드만 동작한다.
 */

import { QUERY_DEADLINE_MS } from './geo-engines/budget.ts';
import { openAiEngine } from './geo-engines/openai.ts';
import type { GeoLiveAnswer } from './geo-engines/types.ts';

export { executeGeoQueries, getEnabledEngines, isGeoLiveQueryEnabled } from './geo-engines/index.ts';
export type { GeoEngineId, GeoLiveAnswer, GeoSource } from './geo-engines/types.ts';

/**
 * 구 API 호환 — 기본 엔진 식별자(geo_citations.engine 에 기록되던 값).
 * 다엔진 구조에서는 각 어댑터의 id 를 쓰지만, 이 상수를 참조하던 코드를 위해 남긴다.
 */
export const GEO_QUERY_ENGINE = 'openai';

const LEGACY_TIMEOUT_MS = 60_000;
const LEGACY_MAX_ATTEMPTS = 2;

/**
 * 구 API 호환 — 질문 1건을 기본 엔진(OpenAI 웹검색)에 질의한다.
 * 신규 코드는 executeGeoQueries 를 쓸 것(캐싱·데드라인·시도 예산이 붙는다).
 * 실패 시 throw 하는 기존 동작을 그대로 유지한다.
 */
export async function runGeoLiveQuery(question: string): Promise<GeoLiveAnswer> {
  return openAiEngine.run(question, {
    fetchImpl: fetch,
    env: process.env,
    timeoutMs: LEGACY_TIMEOUT_MS,
    maxAttempts: LEGACY_MAX_ATTEMPTS,
    deadlineAt: Date.now() + QUERY_DEADLINE_MS,
  });
}
