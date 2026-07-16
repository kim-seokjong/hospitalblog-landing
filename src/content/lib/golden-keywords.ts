import { fetchRelatedKeywords, type KeywordVolume } from './keyword-volume.ts';
import { createSpecialtyFilter } from './specialty-filter.ts';
import {
  filterCandidatesByRelevance,
  RELEVANCE_POOL_LIMIT,
  type RelevanceGateCreate,
} from './relevance-gate.ts';

/**
 * 황금 키워드 추천 순수 로직.
 *
 * "검색량은 충분한데 블로그 문서 수(경쟁)는 적은" 키워드를 찾는다.
 * - 연관 키워드·월 검색량·compIdx: 네이버 검색광고 keywordstool (keyword-volume.ts)
 * - 블로그 문서수(total): 네이버 오픈API blog.json (display=1 로 total 만 사용)
 * - 경쟁도(ratio) = 블로그 문서수 ÷ 월 검색량 — 낮을수록 노출 기회가 크다.
 *
 * 그레이스풀 철학은 keyword-volume.ts 와 동일:
 * - 검색광고 env 없음/실패 → available:false (기능만 숨김)
 * - 오픈API env 없음/실패 → docAvailable:false (문서수·경쟁도 배지만 숨김)
 * - LLM 관련성 게이트(relevance-gate.ts) 실패/키 없음 → 게이트만 건너뜀
 */

export interface OpenApiCredentials {
  clientId: string;
  clientSecret: string;
}

/** 네이버 오픈API 자격증명. 하나라도 비면 null (절대 throw 안 함). */
export function readOpenApiCredentials(
  env: NodeJS.ProcessEnv = process.env
): OpenApiCredentials | null {
  const clientId = env.NAVER_CLIENT_ID?.trim();
  const clientSecret = env.NAVER_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export interface GoldenCandidate {
  keyword: string;
  volume: KeywordVolume;
}

export type CompetitionLevel = '낮음' | '중간' | '높음';

export interface GoldenKeywordItem {
  keyword: string;
  volume: KeywordVolume;
  /** 네이버 블로그 문서수 (오픈API total). 조회 불가 시 null */
  docCount: number | null;
  /** 문서수 ÷ 월 검색량 — 낮을수록 좋음. 문서수 없거나 검색량 0이면 null */
  ratio: number | null;
  /** ratio 기반 경쟁도 등급. ratio 가 null 이면 null */
  competition: CompetitionLevel | null;
}

export interface GoldenKeywordResult {
  /** 검색광고(keywordstool) 사용 가능 여부 */
  available: boolean;
  /** 블로그 문서수(오픈API) 사용 가능 여부 */
  docAvailable: boolean;
  items: GoldenKeywordItem[];
}

/** 문서수 조회 대상 후보 수 (오픈API 호출 낭비 방지) */
export const GOLDEN_CANDIDATE_LIMIT = 20;
/** 후보 최소 월 검색량 — 이 미만은 "검색량 충분" 조건 미달 */
export const GOLDEN_MIN_VOLUME = 100;
/** 최소 검색량 필터 후 후보가 이보다 적으면 미달 키워드로 채움 */
export const GOLDEN_MIN_CANDIDATES = 5;
/** ratio < 10 → 경쟁 낮음, < 50 → 중간, 이상 → 높음 */
export const RATIO_LOW_MAX = 10;
export const RATIO_MID_MAX = 50;

/** keywordstool 힌트 구성: 주제 키워드 + (지역이 있으면) 지역결합 키워드 */
export function buildGoldenHints(seed: string, region?: string): string[] {
  const cleanSeed = seed.trim();
  if (!cleanSeed) return [];
  const cleanRegion = (region ?? '').trim();
  const hints = [cleanSeed];
  if (cleanRegion) {
    const combined = `${cleanRegion}${cleanSeed.replace(/\s+/g, '')}`;
    if (combined !== cleanSeed) hints.push(combined);
  }
  return Array.from(new Set(hints));
}

/**
 * 연관 키워드 중 문서수를 조회할 후보를 고른다.
 * 검색량(total) 내림차순 → minVolume 이상 우선. 필터 결과가 너무 적으면
 * (니치 주제) 미달 키워드로 minCandidates 까지 채운다. 입력은 변형하지 않는다.
 *
 * specialty 가 있으면 타 진료과 키워드(예: 피부과 사용자의 "치과", "임플란트")를
 * 먼저 제외한다 — keywordstool 연관어는 광고그룹 동시등록 통계라 무관 키워드가 섞인다.
 * 필터는 정렬 전에 적용하므로 제외된 자리는 다음 순위 키워드로 자동 재충원되어
 * limit 개수가 유지된다. specialty 미설정·사전에 없는 진료과는 필터 없이 기존 동작.
 */
export function selectGoldenCandidates(
  volumes: Record<string, KeywordVolume>,
  options: {
    limit?: number;
    minVolume?: number;
    minCandidates?: number;
    specialty?: string;
  } = {}
): GoldenCandidate[] {
  const limit = options.limit ?? GOLDEN_CANDIDATE_LIMIT;
  const minVolume = options.minVolume ?? GOLDEN_MIN_VOLUME;
  const minCandidates = options.minCandidates ?? GOLDEN_MIN_CANDIDATES;
  const specialtyFilter = createSpecialtyFilter(options.specialty);

  const sorted = Object.entries(volumes)
    .map(([keyword, volume]) => ({ keyword, volume }))
    .filter((c) => specialtyFilter === null || specialtyFilter(c.keyword))
    .sort((a, b) => b.volume.total - a.volume.total);

  const enough = sorted.filter((c) => c.volume.total >= minVolume).slice(0, limit);
  if (enough.length >= Math.min(minCandidates, limit)) {
    return enough;
  }

  // 니치 주제 폴백: 검색량 상위부터 채워서 최소 후보 수 확보
  return sorted.slice(0, Math.max(enough.length, Math.min(minCandidates, limit)));
}

/** 경쟁도 비율 = 문서수 ÷ 월 검색량. 계산 불가는 null. */
export function computeCompetitionRatio(
  docCount: number | null,
  total: number
): number | null {
  if (docCount === null || !Number.isFinite(docCount) || docCount < 0) return null;
  if (total <= 0) return null;
  return docCount / total;
}

/** ratio → 경쟁도 등급 */
export function classifyCompetition(ratio: number | null): CompetitionLevel | null {
  if (ratio === null) return null;
  if (ratio < RATIO_LOW_MAX) return '낮음';
  if (ratio < RATIO_MID_MAX) return '중간';
  return '높음';
}

/**
 * 후보 + 문서수 → 황금 키워드 순위.
 * 정렬: ratio 오름차순(경쟁 낮은 순) → 동률은 검색량 내림차순.
 * ratio 없는 항목(문서수 조회 불가)은 뒤로 보내되 검색량 내림차순 유지.
 */
export function rankGoldenKeywords(
  candidates: readonly GoldenCandidate[],
  docCounts: Record<string, number | null>
): GoldenKeywordItem[] {
  const items = candidates.map((c) => {
    const docCount = docCounts[c.keyword] ?? null;
    const ratio = computeCompetitionRatio(docCount, c.volume.total);
    return {
      keyword: c.keyword,
      volume: c.volume,
      docCount,
      ratio,
      competition: classifyCompetition(ratio),
    };
  });

  return [...items].sort((a, b) => {
    if (a.ratio !== null && b.ratio !== null) {
      if (a.ratio !== b.ratio) return a.ratio - b.ratio;
      return b.volume.total - a.volume.total;
    }
    if (a.ratio !== null) return -1;
    if (b.ratio !== null) return 1;
    return b.volume.total - a.volume.total;
  });
}

/** blog.json 응답에서 total 만 추출. 형태가 다르면 null. */
export function parseBlogTotal(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  const total = (data as { total?: unknown }).total;
  if (typeof total === 'number' && Number.isFinite(total) && total >= 0) {
    return total;
  }
  return null;
}

const BLOG_SEARCH_URL = 'https://openapi.naver.com/v1/search/blog.json';

/**
 * 키워드 하나의 네이버 블로그 문서수(total) 조회.
 * 키 없음/호출 실패/파싱 실패 전부 null (그레이스풀).
 */
export async function fetchBlogDocCount(
  keyword: string,
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}
): Promise<number | null> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;

  const creds = readOpenApiCredentials(env);
  if (!creds) return null;
  const cleaned = keyword.trim();
  if (!cleaned) return null;

  try {
    const params = new URLSearchParams({ query: cleaned, display: '1' });
    const res = await fetchImpl(`${BLOG_SEARCH_URL}?${params}`, {
      headers: {
        'X-Naver-Client-Id': creds.clientId,
        'X-Naver-Client-Secret': creds.clientSecret,
      },
    });
    if (!res.ok) return null;
    return parseBlogTotal(await res.json());
  } catch {
    return null;
  }
}

/**
 * 여러 키워드의 문서수를 청크 단위(기본 5개씩 순차)로 조회한다.
 * 오픈API 초당 호출 제한을 배려하면서 병렬성을 유지.
 */
export async function fetchBlogDocCounts(
  keywords: readonly string[],
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; chunkSize?: number } = {}
): Promise<Record<string, number | null>> {
  const chunkSize = options.chunkSize ?? 5;
  const out: Record<string, number | null> = {};

  for (let i = 0; i < keywords.length; i += chunkSize) {
    const chunk = keywords.slice(i, i + chunkSize);
    const counts = await Promise.all(
      chunk.map((kw) => fetchBlogDocCount(kw, options))
    );
    chunk.forEach((kw, idx) => {
      out[kw] = counts[idx];
    });
  }

  return out;
}

/**
 * 황금 키워드 추천 전체 파이프라인.
 * 1) keywordstool 연관 키워드 + 검색량·compIdx (1콜)
 * 2) 블랙리스트 필터 통과 후보 여유분(RELEVANCE_POOL_LIMIT=40) 확보
 * 3) LLM 관련성 게이트(haiku 배치 1콜) — 진료과명 없는 무관 키워드까지 제거.
 *    키 없음/실패/타임아웃/파싱 실패 시 게이트 건너뜀 (relevance-gate.ts)
 * 4) 통과 후보 상위 GOLDEN_CANDIDATE_LIMIT(20)개만 블로그 문서수 조회
 *    — 비용 있는 오픈API 호출 전에 걸러 낭비를 막는다
 * 5) 경쟁도(문서수÷검색량) 오름차순 정렬
 */
export async function fetchGoldenKeywords(
  seed: string,
  options: {
    region?: string;
    /** 사용자 진료과 — 타 진료과 연관어 제외 필터에 사용 (없으면 무필터) */
    specialty?: string;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    /** 테스트 주입용 — 관련성 게이트 LLM 호출 함수 (미주입 시 anthropic.ts) */
    relevanceCreateMessage?: RelevanceGateCreate;
  } = {}
): Promise<GoldenKeywordResult> {
  const cleanSeed = seed.trim();
  if (!cleanSeed) {
    return { available: true, docAvailable: true, items: [] };
  }

  const hints = buildGoldenHints(cleanSeed, options.region);
  const related = await fetchRelatedKeywords(hints, {
    env: options.env,
    fetchImpl: options.fetchImpl,
  });
  if (!related.available) {
    return { available: false, docAvailable: false, items: [] };
  }

  // 블랙리스트 통과 후보를 여유분(40개)으로 확보 — LLM 게이트에서 걸러져도
  // 다음 순위 키워드가 자연 재충원되어 최종 20개를 최대한 채운다.
  const pool = selectGoldenCandidates(related.volumes, {
    specialty: options.specialty,
    limit: RELEVANCE_POOL_LIMIT,
  });
  if (pool.length === 0) {
    return { available: true, docAvailable: true, items: [] };
  }

  const env = options.env ?? process.env;

  // LLM 관련성 게이트 — 문서수 조회(비용 있는 단계) 전에 무관 키워드 제거.
  // 실패·키 없음이면 applied:false + 입력 그대로 (기존 블랙리스트 결과 유지).
  const gate = await filterCandidatesByRelevance(
    {
      seed: cleanSeed,
      specialty: options.specialty,
      candidates: pool.map((c) => c.keyword),
    },
    { env: options.env, createMessage: options.relevanceCreateMessage }
  );
  const allowed = new Set(gate.keywords);
  const candidates = pool
    .filter((c) => allowed.has(c.keyword))
    .slice(0, GOLDEN_CANDIDATE_LIMIT);
  if (candidates.length === 0) {
    return { available: true, docAvailable: true, items: [] };
  }
  let docCounts: Record<string, number | null> = {};
  let docAvailable = false;
  if (readOpenApiCredentials(env)) {
    docCounts = await fetchBlogDocCounts(
      candidates.map((c) => c.keyword),
      { env: options.env, fetchImpl: options.fetchImpl }
    );
    docAvailable = Object.values(docCounts).some((v) => v !== null);
  }

  return {
    available: true,
    docAvailable,
    items: rankGoldenKeywords(candidates, docCounts),
  };
}
