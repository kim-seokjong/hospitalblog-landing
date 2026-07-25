/**
 * OpenAI 어댑터 — Responses API + 내장 `web_search` 툴.
 *
 * 사전 검증(2026-07-05): gpt-5-mini + web_search(search_context_size: low)
 * + reasoning effort low 조합으로 "대구 수성구 피부과 추천" 질의가 실제 웹 근거
 * (url_citation 주석)와 함께 완결 응답됨을 실측 확인.
 *
 * ── 모델 종료 대응 조사 결과 (2026-07-25, developers.openai.com/api/docs/deprecations)
 *  · 공식 deprecations 표에 올라 있는 것은 **날짜 스냅샷 `gpt-5-mini-2025-08-07`**
 *    (shutdown 2026-12-11, 권장 대체 `gpt-5.6-terra`)이다.
 *  · 우리가 보내는 **무버전 별칭 `gpt-5-mini` 는 deprecations 표에 없고**,
 *    모델 페이지도 살아 있으며 종료 배너가 없다. 별칭이 스냅샷과 함께 사라지는지
 *    새 스냅샷으로 재지정되는지는 공식 문서에 명시가 없다(UNCONFIRMED).
 *  · 단가: gpt-5-mini $0.25/$2.00 per 1M(in/out).
 *    공식 대체 gpt-5.6-terra $2.50/$15.00 = 입력 10배·출력 7.5배.
 *    5.6 라인 최저가 gpt-5.6-luna 도 $1.00/$6.00 = 4배·3배.
 *  · 판단: "확인되면 교체" 기준을 충족하지 못했고(별칭 종료 미확인) 비용은 확실히
 *    수배 오르므로 **자동 교체하지 않는다**. 대신 GEO_OPENAI_MODEL 환경변수로
 *    배포 없이 즉시 바꿀 수 있게 열어 둔다. 2026-12-11 전 재확인 필요.
 *  · web_search 툴 이름은 현행 유지가 맞다("For new Responses API integrations,
 *    use { type: 'web_search' }"). search_context_size low/medium/high, reasoning
 *    effort low 모두 현재 유효. 툴 호출 요금은 $10 / 1k calls(= $0.01/건) 별도.
 */

import { postJsonWithRetry } from './http.ts';
import { MAX_SOURCES, type GeoEngineAdapter, type GeoEngineEnv, type GeoEngineRunContext, type GeoLiveAnswer, type GeoSource } from './types.ts';

const DEFAULT_MODEL = 'gpt-5-mini';
const ENDPOINT = 'https://api.openai.com/v1/responses';
/** reasoning 토큰 포함 상한 (실측: 완결 응답 ~530 토큰) */
const MAX_OUTPUT_TOKENS = 1200;

interface ResponsesAnnotation {
  type?: string;
  url?: string;
  title?: string;
}

interface ResponsesOutputContent {
  type?: string;
  text?: string;
  annotations?: ResponsesAnnotation[];
}

interface ResponsesOutputItem {
  type?: string;
  content?: ResponsesOutputContent[];
}

interface ResponsesPayload {
  output?: ResponsesOutputItem[];
}

/** 응답 파싱만 분리 — 스텁 없이 단위 테스트 가능 */
export function parseOpenAiResponse(payload: unknown): GeoLiveAnswer {
  const data = (payload ?? {}) as ResponsesPayload;
  let text = '';
  const sources: GeoSource[] = [];

  for (const item of data.output ?? []) {
    if (item.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content.type !== 'output_text') continue;
      text += content.text ?? '';
      for (const ann of content.annotations ?? []) {
        if (ann.type === 'url_citation' && ann.url && sources.length < MAX_SOURCES) {
          sources.push({ url: ann.url, title: ann.title ?? '' });
        }
      }
    }
  }

  if (!text.trim()) {
    throw new Error('OpenAI 응답 텍스트가 비어있습니다 (토큰 상한 도달 가능성).');
  }
  // OpenAI 는 실행한 검색 질의 수를 노출하지 않는다 → 호출 1건으로 계산
  return { text, sources, searchQueryCount: 1 };
}

export const openAiEngine: GeoEngineAdapter = {
  id: 'openai',
  label: 'OpenAI',

  isConfigured(env: GeoEngineEnv): boolean {
    return Boolean(env.OPENAI_API_KEY);
  },

  async run(question: string, ctx: GeoEngineRunContext): Promise<GeoLiveAnswer> {
    const apiKey = ctx.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다.');

    const payload = await postJsonWithRetry({
      url: ENDPOINT,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        model: ctx.env.GEO_OPENAI_MODEL || DEFAULT_MODEL,
        tools: [{ type: 'web_search', search_context_size: 'low' }],
        input: question,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        reasoning: { effort: 'low' },
        store: false, // 샘플링 질의는 OpenAI 측에도 저장하지 않음
      },
      timeoutMs: ctx.timeoutMs,
      maxAttempts: ctx.maxAttempts,
      fetchImpl: ctx.fetchImpl,
      label: 'OpenAI',
    });

    return parseOpenAiResponse(payload);
  },
};
