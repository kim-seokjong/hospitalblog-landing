/**
 * GEO 라이브 질의 — 엔진 어댑터 공통 타입.
 *
 * 어댑터는 "질문 문자열 하나"를 받아 "응답 텍스트 + 출처 목록"이라는
 * 동일한 형태를 돌려준다. 인용 판정(detectCitation)은 엔진을 몰라도 되도록
 * 이 계약만 의존한다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

/** geo_citations.engine 에 그대로 기록되는 엔진 식별자 */
export type GeoEngineId = 'openai' | 'perplexity' | 'gemini';

export const GEO_ENGINE_IDS: readonly GeoEngineId[] = ['openai', 'perplexity', 'gemini'];

export interface GeoSource {
  url: string;
  title: string;
}

export interface GeoLiveAnswer {
  /** AI 답변 본문 텍스트 */
  text: string;
  /** 응답에서 수집한 출처 (상위 MAX_SOURCES 건) */
  sources: readonly GeoSource[];
  /**
   * 이 호출이 실제로 소비한 "검색 질의" 수 — 무료 할당량 차감 단위.
   * Gemini 3 계열은 프롬프트가 아니라 모델이 실행한 검색 질의 단위로 과금되므로
   * groundingMetadata.webSearchQueries 길이를 그대로 싣는다.
   * 알 수 없는 엔진은 1을 반환한다.
   */
  searchQueryCount: number;
}

/** process.env 를 직접 읽지 않고 주입받아 테스트 가능하게 한다 */
export type GeoEngineEnv = Readonly<Record<string, string | undefined>>;

export interface GeoEngineRunContext {
  /** 테스트에서 스텁 주입 가능 */
  readonly fetchImpl: typeof fetch;
  readonly env: GeoEngineEnv;
  /** 1회 요청 타임아웃 */
  readonly timeoutMs: number;
  /** 재시도 포함 최대 시도 횟수 (1 = 재시도 없음) */
  readonly maxAttempts: number;
}

export interface GeoEngineAdapter {
  readonly id: GeoEngineId;
  readonly label: string;
  /** API 키가 없으면 false — 호출부는 조용히 건너뛴다 */
  isConfigured(env: GeoEngineEnv): boolean;
  /** 실패 시 throw — 호출부가 엔진 단위로 격리해 기록한다 */
  run(question: string, ctx: GeoEngineRunContext): Promise<GeoLiveAnswer>;
}

/** 출처는 인용 판정에 쓸 상위 몇 건만 보관한다(저장 최소화) */
export const MAX_SOURCES = 5;
