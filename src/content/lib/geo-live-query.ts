/**
 * GEO 라이브 질의 — 하위 호환 파사드.
 *
 * 실제 구현은 엔진별 어댑터로 이전했다(src/content/lib/geo-engines/).
 * 이 파일은 기존 import 경로(@/content/lib/geo-live-query)를 유지하기 위한 얇은 재수출이다.
 *
 * 활성 조건: GEO_LIVE_QUERY !== 'off' 이고 엔진 키가 하나 이상 설정됨.
 *   OPENAI_API_KEY / PERPLEXITY_API_KEY / GEMINI_API_KEY
 *   → 키가 없는 엔진은 조용히 제외되고, 전부 없으면 준비도 점수 모드만 동작한다.
 */

export { getEnabledEngines, isGeoLiveQueryEnabled } from './geo-engines/index.ts';
export type { GeoEngineId, GeoLiveAnswer, GeoSource } from './geo-engines/types.ts';
