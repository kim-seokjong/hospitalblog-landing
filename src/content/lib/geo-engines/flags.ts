/**
 * 엔진 옵트인 플래그 — 레지스트리와 어댑터가 함께 참조한다(순환 import 방지용 별도 모듈).
 *
 * ⚠️ Google Gemini API 약관상 Grounded Results 의 analyze/cache 가 금지되어 있어
 * 이 용도로 사용할 수 없다. 구글과 별도 계약 또는 약관 변경 없이 켜지 말 것.
 * (약관 원문과 상세 근거는 gemini.ts 파일 상단 참조)
 *
 * 방어는 이중이다:
 *   ① 레지스트리(index.ts)의 getEnabledEngines 가 제외
 *   ② 어댑터(gemini.ts) 자신이 isConfigured/run 에서 거부
 * ②가 없으면 geminiEngine 을 직접 import 하는 코드가 ①을 우회할 수 있다.
 *
 * 값 비교는 **정확히 'true'** 만 허용한다. toLowerCase 를 쓰면 'TRUE'/'True'/'tRuE'
 * 같은 변형으로도 켜져, 오타나 대충 넣은 값이 약관 위반으로 이어질 수 있다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지).
 */

import type { GeoEngineEnv } from './types.ts';

export const ENABLE_GEMINI_FLAG = 'GEO_ENABLE_GEMINI';

/** 정확히 문자열 'true' 일 때만 옵트인으로 본다 (대소문자 변형·공백 전부 거부) */
export function isGeminiOptedIn(env: GeoEngineEnv): boolean {
  return env[ENABLE_GEMINI_FLAG] === 'true';
}
