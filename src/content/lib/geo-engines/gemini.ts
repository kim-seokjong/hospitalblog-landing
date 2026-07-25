/**
 * Gemini 어댑터 — Google Search grounding.
 *
 * ── 공식 문서 확인 (2026-07-25, ai.google.dev)
 *  · 엔드포인트: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
 *    (v1 아님. generateContent 는 "legacy" 라벨이 붙었으나 "remains fully supported")
 *  · 인증: `x-goog-api-key` 헤더 (현행 문서 예제는 전부 이 방식, ?key= 는 미표기)
 *  · 그라운딩 툴: `tools: [{ "google_search": {} }]`.
 *    구 `google_search_retrieval` 은 1.5 세대 전용이며 해당 모델은 이미 전부 종료.
 *  · 응답: 본문 `candidates[0].content.parts[].text` (parts 는 배열 → text 있는 것만 이어붙임)
 *    출처 `candidates[0].groundingMetadata.groundingChunks[].web.{uri,title}`
 *    실행된 검색 질의 `candidates[0].groundingMetadata.webSearchQueries[]`
 *  · ★ groundingChunks[].web.uri 는 실제 출처 URL 이 아니라
 *    `https://vertexaisearch.cloud.google.com/grounding-api-redirect/...` 리다이렉트다.
 *    이걸 그대로 두면 detectCitation 의 blog.naver.com/{blogId} 매칭이
 *    Gemini 에서만 **항상 실패**한다(조용한 미탐). → 아래 resolveGroundingUri 로
 *    Location 헤더 1~2홉만 따라가 실제 URL 로 복원한다.
 *
 * ── 모델 선택 (무료 할당량 전제)
 *  · Gemini 2.5 Flash / Flash-Lite: 무료 등급에서 그라운딩 500 RPD(두 모델 공유).
 *    단 **2026-10-16 종료 예정**이라 3개월 뒤 재작업이 필요하다.
 *  · Gemini 3 계열: 무료 등급 그라운딩 "Not available" — 결제 등록 필요.
 *    결제 등급에서 **월 5,000 검색 질의 무료**(Gemini 3 공유), 초과분 $14 / 1k.
 *  · 대표 승인 전제가 "월 5,000건 무료 할당량"이므로 기본값을 결제 등급 최저가
 *    현행 모델 `gemini-3.5-flash-lite`(종료일 미지정, $0.30/$2.50 per 1M)로 둔다.
 *    결제 미등록 상태라면 GEO_GEMINI_MODEL=gemini-2.5-flash-lite 로 내려서
 *    500 RPD 무료로 운영할 수 있다(2026-10-16 이전까지).
 *  · ★ Gemini 3 는 프롬프트가 아니라 **모델이 실행한 검색 질의 수**로 차감된다
 *    ("billed for each search query that the model decides to execute").
 *    그래서 webSearchQueries.length 를 그대로 소비량으로 보고한다.
 *
 * ── 준법 유의 (법무팀 확인 필요)
 *    Gemini API 약관은 Grounded Results 를 "cache, frame, syndicate, resell,
 *    analyze, train on, or otherwise learn from" 하는 것을 금지하고, 사용자에게
 *    표시할 때 Search Suggestions(searchEntryPoint) 동반 표시를 요구한다.
 *    본 기능은 인용 여부 판정용 서버 내부 처리 + 발췌 최소 보관이지만
 *    "analyze" 금지 조항에 걸릴 소지가 있어 별도 법무 검토가 필요하다.
 */

import { postJsonWithRetry } from './http.ts';
import { MAX_SOURCES, type GeoEngineAdapter, type GeoEngineEnv, type GeoEngineRunContext, type GeoLiveAnswer, type GeoSource } from './types.ts';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
/** 3.x 계열은 thinking 토큰이 여기에 포함되므로 여유를 둔다 */
const MAX_OUTPUT_TOKENS = 2048;

/** 리다이렉트 복원은 구글 그라운딩 호스트에서만 수행한다(SSRF 방어) */
const GROUNDING_REDIRECT_HOST_SUFFIX = 'vertexaisearch.cloud.google.com';
const REDIRECT_MAX_HOPS = 2;
const REDIRECT_TIMEOUT_MS = 3_000;

interface GeminiWebChunk {
  web?: { uri?: string; title?: string };
}

interface GeminiPayload {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: GeminiWebChunk[];
      webSearchQueries?: string[];
    };
  }>;
}

/** 구글 그라운딩 리다이렉트 호스트인가 */
export function isGroundingRedirect(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === GROUNDING_REDIRECT_HOST_SUFFIX || host.endsWith(`.${GROUNDING_REDIRECT_HOST_SUFFIX}`);
  } catch {
    return false;
  }
}

/**
 * grounding-api-redirect URL 을 Location 헤더만 따라가 실제 출처 URL 로 복원한다.
 * · 본문은 절대 읽지 않고 헤더만 본다(불필요한 트래픽·인젝션 표면 최소화)
 * · 구글 호스트가 아닌 URL 은 요청하지 않는다(SSRF 방어) → 첫 비-구글 Location 에서 종료
 * · 실패·타임아웃이면 원본 URL 을 그대로 돌려준다(그레이스풀)
 */
export async function resolveGroundingUri(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number = REDIRECT_TIMEOUT_MS,
): Promise<string> {
  let current = url;
  for (let hop = 0; hop < REDIRECT_MAX_HOPS; hop++) {
    if (!isGroundingRedirect(current)) return current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      });
      const location = res.headers.get('location');
      if (!location) return current;
      current = new URL(location, current).toString();
    } catch {
      return current;
    } finally {
      clearTimeout(timer);
    }
  }
  return current;
}

/** 응답 파싱(리다이렉트 복원 전) — 스텁 없이 단위 테스트 가능 */
export function parseGeminiResponse(payload: unknown): GeoLiveAnswer {
  const data = (payload ?? {}) as GeminiPayload;
  const candidate = data.candidates?.[0];

  const text = (candidate?.content?.parts ?? [])
    .map((part) => part?.text ?? '')
    .join('');
  if (!text.trim()) {
    throw new Error('Gemini 응답 텍스트가 비어있습니다 (안전 필터·토큰 상한 가능성).');
  }

  const sources: GeoSource[] = [];
  for (const chunk of candidate?.groundingMetadata?.groundingChunks ?? []) {
    const uri = chunk?.web?.uri;
    if (!uri || sources.length >= MAX_SOURCES) continue;
    sources.push({ url: uri, title: chunk.web?.title ?? '' });
  }

  // Gemini 3 는 실행된 검색 질의 단위로 무료 할당량이 차감된다. 미보고 시 최소 1건.
  const executed = candidate?.groundingMetadata?.webSearchQueries?.length ?? 0;
  return { text, sources, searchQueryCount: Math.max(1, executed) };
}

export const geminiEngine: GeoEngineAdapter = {
  id: 'gemini',
  label: 'Gemini',

  isConfigured(env: GeoEngineEnv): boolean {
    return Boolean(env.GEMINI_API_KEY);
  },

  async run(question: string, ctx: GeoEngineRunContext): Promise<GeoLiveAnswer> {
    const apiKey = ctx.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');

    const model = ctx.env.GEO_GEMINI_MODEL || DEFAULT_MODEL;
    const payload = await postJsonWithRetry({
      url: `${API_BASE}/${encodeURIComponent(model)}:generateContent`,
      headers: { 'x-goog-api-key': apiKey },
      body: {
        contents: [{ parts: [{ text: question }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.2 },
      },
      timeoutMs: ctx.timeoutMs,
      maxAttempts: ctx.maxAttempts,
      fetchImpl: ctx.fetchImpl,
      label: 'Gemini',
    });

    const parsed = parseGeminiResponse(payload);
    // 리다이렉트 복원은 출처끼리 병렬 — Gemini 호출당 추가 지연을 1홉 수준으로 억제
    const resolved = await Promise.all(
      parsed.sources.map(async (source) => ({
        ...source,
        url: await resolveGroundingUri(source.url, ctx.fetchImpl),
      })),
    );
    return { ...parsed, sources: resolved };
  },
};
