/**
 * GEO 라이브 질의 — OpenAI Responses API `web_search` 툴로 실제 AI 검색 답변을 샘플링.
 *
 * 사전 검증(2026-07-05): gpt-5-mini + web_search(search_context_size: low)
 * + reasoning effort low 조합으로 "대구 수성구 피부과 추천" 질의가 실제 웹 근거
 * (url_citation 주석)와 함께 완결 응답됨을 실측 확인.
 *
 * 비용 가드: 소형 모델(gpt-5-mini) 고정 + 질문당 출력 토큰 상한 + 검색 컨텍스트 low.
 * 환경변수 GEO_LIVE_QUERY=off 로 전체 비활성화 가능(준비도 점수 모드만 동작).
 */

export const GEO_QUERY_ENGINE = 'openai';
const GEO_QUERY_MODEL = 'gpt-5-mini';
const GEO_MAX_OUTPUT_TOKENS = 1200; // reasoning 토큰 포함 상한 (실측: 완결 응답 ~530 토큰)
const GEO_REQUEST_TIMEOUT_MS = 60_000;

export interface GeoLiveAnswer {
  /** AI 답변 본문 텍스트 */
  text: string;
  /** url_citation 주석에서 수집한 출처 (상위 몇 건) */
  sources: Array<{ url: string; title: string }>;
}

/** 라이브 질의 활성 여부 — 키 존재 + GEO_LIVE_QUERY !== 'off' */
export function isGeoLiveQueryEnabled(): boolean {
  if ((process.env.GEO_LIVE_QUERY ?? '').toLowerCase() === 'off') return false;
  return Boolean(process.env.OPENAI_API_KEY);
}

interface ResponsesOutputContent {
  type: string;
  text?: string;
  annotations?: Array<{ type: string; url?: string; title?: string }>;
}

interface ResponsesOutputItem {
  type: string;
  content?: ResponsesOutputContent[];
}

const MAX_SOURCES = 5;

/**
 * 질문 1건을 웹검색 툴과 함께 질의하고 답변 텍스트+출처를 반환.
 * 실패 시 throw — 호출부(cron)가 질문 단위로 스킵 처리한다.
 */
export async function runGeoLiveQuery(question: string): Promise<GeoLiveAnswer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다.');

  const body = {
    model: GEO_QUERY_MODEL,
    tools: [{ type: 'web_search', search_context_size: 'low' }],
    input: question,
    max_output_tokens: GEO_MAX_OUTPUT_TOKENS,
    reasoning: { effort: 'low' },
    store: false, // 샘플링 질의는 OpenAI 측에도 저장하지 않음
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEO_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`OpenAI Responses API 실패 (${res.status}): ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as { output?: ResponsesOutputItem[] };
    let text = '';
    const sources: Array<{ url: string; title: string }> = [];

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
    return { text, sources };
  } finally {
    clearTimeout(timer);
  }
}
