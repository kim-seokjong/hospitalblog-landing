/**
 * Perplexity 어댑터 — Sonar 검색 모델.
 *
 * ── 공식 문서 확인 (2026-07-25, docs.perplexity.ai)
 *  · 엔드포인트: 정규 `POST https://api.perplexity.ai/v1/sonar`.
 *    (`POST /chat/completions` 는 OpenAI SDK 호환용 별칭으로도 허용)
 *  · 인증: `Authorization: Bearer $PERPLEXITY_API_KEY`
 *  · 모델: `sonar` | `sonar-pro` | `sonar-reasoning-pro` | `sonar-deep-research` 4종만 유효.
 *    구 모델(pplx-*, llama-3.1-sonar-*-128k-online, r1-1776)은 전부 접근 불가.
 *    우리는 최저가 검색 모델 `sonar` 사용("Lightweight, cost-effective search model
 *    with grounding" — quick factual queries 용도로 문서가 직접 권장).
 *  · search_context_size 는 top-level 이 아니라 **web_search_options 안에 중첩**된다.
 *  · 응답: 본문 `choices[0].message.content`,
 *    출처 `search_results[]` = { title, url, date, last_updated?, snippet, source? }.
 *    구 `citations[]`(URL 문자열 배열)은 2025-05 변경로그에서 "fully deprecated and
 *    removed" 라고 했으나 현행 OpenAPI 스펙에는 아직 optional 로 남아 있다 →
 *    **search_results 를 정본으로 쓰고 citations 는 폴백**으로만 사용한다.
 *  · 요금: sonar $1/$1 per 1M(in/out) + 요청 수수료 low 컨텍스트 $5 / 1k
 *    (≈ $0.005/건, 짧은 질의는 수수료가 지배적).
 *  · 레이트리밋: sonar 기준 Tier0(무결제) 50 RPM, Tier1($50+) 150 RPM.
 *  · 참고: 2026-07 변경로그 기준 Sonar Chat Completions 는 신규 Agent API 로
 *    이관 권고 상태다(선셋 날짜 미공지, "remains supported"). Agent API 가
 *    호출당 단가는 절반 수준이나 응답 스키마가 다르고 검증 자료가 얕아
 *    이번에는 스키마가 확정된 /v1/sonar 로 구현한다. 후속 과제로 남긴다.
 */

import { postJsonWithRetry } from './http.ts';
import { MAX_SOURCES, type GeoEngineAdapter, type GeoEngineEnv, type GeoEngineRunContext, type GeoLiveAnswer, type GeoSource } from './types.ts';

const DEFAULT_MODEL = 'sonar';
const ENDPOINT = 'https://api.perplexity.ai/v1/sonar';
const MAX_TOKENS = 700;

interface SonarSearchResult {
  title?: string;
  url?: string;
}

interface SonarPayload {
  choices?: Array<{ message?: { content?: string } }>;
  search_results?: SonarSearchResult[];
  citations?: string[];
}

/** search_results 우선, 없으면 구 citations(URL 문자열) 폴백 */
function collectSources(data: SonarPayload): GeoSource[] {
  const sources: GeoSource[] = [];
  for (const item of data.search_results ?? []) {
    if (!item?.url || sources.length >= MAX_SOURCES) continue;
    sources.push({ url: item.url, title: item.title ?? '' });
  }
  if (sources.length > 0) return sources;

  for (const url of data.citations ?? []) {
    if (typeof url !== 'string' || !url || sources.length >= MAX_SOURCES) continue;
    sources.push({ url, title: '' });
  }
  return sources;
}

/** 응답 파싱만 분리 — 스텁 없이 단위 테스트 가능 */
export function parsePerplexityResponse(payload: unknown): GeoLiveAnswer {
  const data = (payload ?? {}) as SonarPayload;
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) {
    throw new Error('Perplexity 응답 텍스트가 비어있습니다.');
  }
  // Sonar 는 요청 1건 = 검색 1건으로 과금된다
  return { text, sources: collectSources(data), searchQueryCount: 1 };
}

export const perplexityEngine: GeoEngineAdapter = {
  id: 'perplexity',
  label: 'Perplexity',

  isConfigured(env: GeoEngineEnv): boolean {
    return Boolean(env.PERPLEXITY_API_KEY);
  },

  async run(question: string, ctx: GeoEngineRunContext): Promise<GeoLiveAnswer> {
    const apiKey = ctx.env.PERPLEXITY_API_KEY;
    if (!apiKey) throw new Error('PERPLEXITY_API_KEY 환경변수가 설정되지 않았습니다.');

    const payload = await postJsonWithRetry({
      url: ENDPOINT,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        model: ctx.env.GEO_PERPLEXITY_MODEL || DEFAULT_MODEL,
        messages: [{ role: 'user', content: question }],
        max_tokens: MAX_TOKENS,
        temperature: 0.2,
        // 비용 가드: 요청 수수료가 컨텍스트 크기에 비례하므로 low 고정
        web_search_options: { search_context_size: 'low' },
        // 한국 병원 질의 — 한국어 결과 우선
        language_preference: 'ko',
        stream: false,
      },
      timeoutMs: ctx.timeoutMs,
      maxAttempts: ctx.maxAttempts,
      fetchImpl: ctx.fetchImpl,
      label: 'Perplexity',
    });

    return parsePerplexityResponse(payload);
  },
};
