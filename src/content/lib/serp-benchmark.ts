import type { NaverPost } from '@/content/lib/competitor-analysis';

/**
 * 상위노출 역분석 (SERP reverse-analysis).
 *
 * 키워드로 네이버 상위 글을 수집·역분석해 "이 키워드 상위 글의 공통 골격"을
 * 산출한다(SerpBenchmark). 생성 프롬프트 목표치 주입 + SeoAnalysis 동적 기준에 사용.
 *
 * 설계 원칙 (CLAUDE.md / 코딩 규칙):
 * - OpenAPI(blog.json)만 사용. 실제 SERP HTML 스크래핑·대량 크롤링 금지.
 * - 모든 외부 호출은 graceful: 키 없음/실패/파싱불가 시 throw 하지 않고 폴백.
 *   buildSerpBenchmark 는 어떤 경우에도 생성 플로우를 깨지 않는다(최악의 경우 null).
 * - 본문 fetch 는 상위 소수(기본 5개)만, 동시성 제한·짧은 타임아웃. 깨지면 즉시 폴백.
 * - 본문 측정 실패 시 결과 수(경쟁도)·스니펫 기반 "추정 벤치마크"로 약화 degrade.
 * - 권위 신호(bloggername·postdate 최신성)로 상위 글을 가중해 본문 측정 대상을 고른다.
 * - Claude(하위주제 추출)는 competitor-analysis 의 ANALYSIS_GUARD(의료광고법) 경유.
 * - 순수 로직(가중·집계·파싱·폴백)은 외부 의존 없이 단위테스트 가능하게 분리.
 */

export interface SerpPost {
  title: string;
  description: string;
  link: string;
  /** YYYYMMDD (네이버 postdate). 빈 문자열 가능. */
  postdate: string;
  bloggername: string;
}

export type BenchmarkConfidence = 'measured' | 'estimated';
export type CompetitionLevel = 'low' | 'medium' | 'high';

export interface SerpBenchmark {
  /** 목표 글자수(공백 포함, 이미지/요약/FAQ 제외 본문 기준 근사) */
  targetCharCount: number;
  targetH2: number;
  targetH3: number;
  targetImages: number;
  /** 상위 글들이 공통으로 다루는 하위 주제 (의료광고법 가드 경유 추출) */
  subtopics: string[];
  hasFaq: boolean;
  /** 'measured' = 상위 글 본문 실측 / 'estimated' = 경쟁도 기반 추정 */
  confidence: BenchmarkConfidence;
  /** 실제 본문 측정에 성공한 상위 글 수 (0이면 estimated) */
  sampleSize: number;
  /** 결과 수 기반 키워드 경쟁 강도 */
  competitionLevel: CompetitionLevel;
}

/** 본문 1개에서 best-effort 로 측정한 원시 지표. */
export interface PostBodyMetrics {
  charCount: number;
  imageCount: number;
  headingCount: number;
  hasFaq: boolean;
}

// ─────────────────────────────────────────────────────────────
// 상수 (하드코딩 방지 — 한 곳에 모음)
// ─────────────────────────────────────────────────────────────
const NAVER_BLOG_SEARCH_URL = 'https://openapi.naver.com/v1/search/blog.json';
/** 본문으로 인정할 최소 글자수 (이 미만이면 파싱 실패로 간주). */
const MIN_BODY_CHARS = 200;
/** 단일 페이지에서 측정할 최대 글자수 (관련글·댓글 노이즈 폭주 방지). */
const MAX_BODY_CHARS = 8000;
const DEFAULT_TOP_N = 10;
const DEFAULT_BODY_FETCH_LIMIT = 5;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 4000;
/** 추정 폴백 시 경쟁도별 기본 목표치. */
const ESTIMATED_TARGETS: Record<CompetitionLevel, Omit<SerpBenchmark, 'subtopics' | 'confidence' | 'sampleSize' | 'competitionLevel'>> = {
  low: { targetCharCount: 1500, targetH2: 4, targetH3: 2, targetImages: 4, hasFaq: false },
  medium: { targetCharCount: 1800, targetH2: 5, targetH3: 3, targetImages: 5, hasFaq: true },
  high: { targetCharCount: 2200, targetH2: 6, targetH3: 4, targetImages: 6, hasFaq: true },
};

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}

/** 정렬에 영향 없는 안정 median. 빈 배열이면 0. */
export function median(nums: readonly number[]): number {
  const arr = nums.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (arr.length === 0) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
}

// ─────────────────────────────────────────────────────────────
// A. 상위글 수집 + 권위 신호
// ─────────────────────────────────────────────────────────────

interface BlogSearchResponse {
  total?: number;
  items?: Array<{
    title?: string;
    description?: string;
    link?: string;
    postdate?: string;
    bloggername?: string;
  }>;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim();
}

/**
 * 상위 노출 근사용 블로그 검색. sort=sim(관련도)·total 포함.
 * competitor-analysis.fetchNaverBlogPosts 와 같은 OpenAPI 엔드포인트지만:
 *  (1) total(결과 수=경쟁도) 이 필요하고 (2) throw 하지 않는 graceful 동작이 필요하며
 *  (3) fetch 주입으로 테스트 가능해야 하므로 별도 함수로 둔다.
 * 키 없음/실패/파싱불가 → { posts: [], total: 0 }.
 */
export async function fetchTopBlogPosts(
  keyword: string,
  options: { display?: number; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {}
): Promise<{ posts: SerpPost[]; total: number }> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const clientId = env.NAVER_CLIENT_ID;
  const clientSecret = env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) return { posts: [], total: 0 };
  if (!keyword || keyword.trim() === '') return { posts: [], total: 0 };

  try {
    const display = clamp(options.display ?? DEFAULT_TOP_N, 1, 100);
    const params = new URLSearchParams({
      query: keyword.trim(),
      display: String(display),
      sort: 'sim',
    });
    const res = await fetchImpl(`${NAVER_BLOG_SEARCH_URL}?${params}`, {
      headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
    });
    if (!res.ok) return { posts: [], total: 0 };

    const data = (await res.json()) as BlogSearchResponse;
    const posts: SerpPost[] = (data.items ?? []).map((item) => ({
      title: stripTags(item.title ?? ''),
      description: stripTags(item.description ?? ''),
      link: (item.link ?? '').trim(),
      postdate: (item.postdate ?? '').trim(),
      bloggername: stripTags(item.bloggername ?? ''),
    }));
    const total = typeof data.total === 'number' && data.total >= 0 ? data.total : posts.length;
    return { posts, total };
  } catch {
    return { posts: [], total: 0 };
  }
}

/**
 * 권위 신호 가중치. 관련도만 높고 실제론 상위가 아닌 글을 보정하는 용도.
 * - 발행 최신성: 최근일수록 가중(네이버는 최신·활성 블로그를 상위 노출하는 경향).
 * - bloggername 존재: 식별 가능한 운영 블로그(빈 값은 약하게).
 * 반환은 0~1 범위의 상대 가중치. 외부 데이터(postdate)는 신뢰하지 않고 방어 파싱.
 */
export function computeAuthorityWeight(post: SerpPost, nowMs: number = Date.now()): number {
  let recency = 0.5; // postdate 없으면 중립값
  const pd = (post.postdate || '').replace(/[^0-9]/g, '');
  if (pd.length === 8) {
    const year = Number(pd.slice(0, 4));
    const month = Number(pd.slice(4, 6));
    const day = Number(pd.slice(6, 8));
    const ts = Date.parse(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`);
    if (Number.isFinite(ts) && ts <= nowMs) {
      const ageDays = (nowMs - ts) / (1000 * 60 * 60 * 24);
      // 0일=1.0, 365일=~0.5, 730일 이상=~0.0 로 선형 감쇠
      recency = clamp(1 - ageDays / 730, 0, 1);
    }
  }
  const hasName = post.bloggername.trim().length > 0 ? 1 : 0;
  // 최신성 70% + 블로그 식별 30%
  return clamp(recency * 0.7 + hasName * 0.3, 0, 1);
}

/**
 * 권위 가중치 내림차순으로 정렬한 새 배열을 반환(불변). 동률은 입력 순서 유지(안정).
 */
export function rankPostsByAuthority(posts: readonly SerpPost[], nowMs: number = Date.now()): SerpPost[] {
  return posts
    .map((p, i) => ({ p, i, w: computeAuthorityWeight(p, nowMs) }))
    .sort((a, b) => (b.w !== a.w ? b.w - a.w : a.i - b.i))
    .map(({ p }) => p);
}

// ─────────────────────────────────────────────────────────────
// B. 구조 역분석 — 본문 best-effort 측정 + 폴백
// ─────────────────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 본문 컨테이너 추정 슬라이스. 네이버 스마트에디터(se-main-container) /
 * 구버전(postViewArea/post_ct) 마커가 있으면 그 지점부터, 없으면 전체.
 */
function extractMainHtml(html: string): string {
  const idx = html.search(/se-main-container|id="?postViewArea|class="?post_ct/);
  return idx >= 0 ? html.slice(idx) : html;
}

/**
 * 네이버 블로그 본문 HTML 1개에서 골격 지표를 best-effort 로 측정한다.
 * iframe·구조 변경 등으로 본문이 충분히 안 잡히면(MIN_BODY_CHARS 미만) null 반환.
 * 외부 HTML 은 신뢰하지 않으며, 어떤 형식이 와도 throw 하지 않는다.
 */
export function parsePostBodyMetrics(html: string): PostBodyMetrics | null {
  if (typeof html !== 'string' || html.length === 0) return null;

  const main = extractMainHtml(html);
  const text = htmlToText(main);
  const charCount = Math.min(text.length, MAX_BODY_CHARS);
  if (charCount < MIN_BODY_CHARS) return null;

  // 이미지: SE3 모듈 우선, 없으면 일반 <img>
  const seImage = (main.match(/se-module-image/gi) || []).length;
  const imgTag = (main.match(/<img[\s>]/gi) || []).length;
  const imageCount = seImage > 0 ? seImage : imgTag;

  // 소제목: 실제 헤딩 태그 또는 SE3 제목 모듈(best-effort, 누락 가능)
  const headingByTag = (main.match(/<h[1-4][\s>]/gi) || []).length;
  const headingBySE = (main.match(/se-title-text|se-section-title/gi) || []).length;
  const headingCount = Math.max(headingByTag, headingBySE);

  const hasFaq = /자주\s*묻는\s*질문|자주하는\s*질문|FAQ|Q\s*&\s*A|Q1\s*[.:]/i.test(text);

  return { charCount, imageCount, headingCount, hasFaq };
}

/** charCount 로부터 H2/H3 목표를 보수적으로 유도(헤딩 측정이 약할 때 사용). */
function deriveHeadingsFromChars(charCount: number): { h2: number; h3: number } {
  return {
    h2: clamp(Math.round(charCount / 450), 3, 8),
    h3: clamp(Math.round(charCount / 700), 2, 8),
  };
}

/**
 * 실측 지표들을 robust 하게 집계(median)해 목표 골격을 만든다.
 * 헤딩은 측정 신뢰도가 낮으므로, median 헤딩이 충분(>=3)할 때만 그대로 쓰고
 * 아니면 글자수에서 유도한다(투명한 폴백). 입력이 비면 null.
 */
export function aggregateMeasured(metricsList: readonly PostBodyMetrics[]): Omit<SerpBenchmark, 'subtopics' | 'confidence' | 'competitionLevel'> | null {
  if (metricsList.length === 0) return null;

  const targetCharCount = Math.round(median(metricsList.map((m) => m.charCount)));
  const medImages = Math.round(median(metricsList.map((m) => m.imageCount)));
  const targetImages = clamp(medImages, 4, 12);
  const medHeadings = median(metricsList.map((m) => m.headingCount));

  let targetH2: number;
  let targetH3: number;
  if (medHeadings >= 3) {
    targetH2 = clamp(Math.round(medHeadings * 0.6), 3, 8);
    targetH3 = clamp(Math.round(medHeadings * 0.4), 2, 8);
  } else {
    const derived = deriveHeadingsFromChars(targetCharCount);
    targetH2 = derived.h2;
    targetH3 = derived.h3;
  }

  const hasFaq = metricsList.some((m) => m.hasFaq);

  return {
    targetCharCount,
    targetH2,
    targetH3,
    targetImages,
    hasFaq,
    sampleSize: metricsList.length,
  };
}

/** 결과 수(total)로 경쟁 강도를 분류. */
export function competitionLevelFromTotal(total: number): CompetitionLevel {
  if (!Number.isFinite(total) || total < 5000) return 'low';
  if (total < 50000) return 'medium';
  return 'high';
}

/**
 * 본문 측정 실패 시 폴백: 경쟁도 기반 추정 목표.
 * 기능을 깨지 않고 약화만 한다(confidence='estimated').
 */
export function estimateBenchmark(total: number): Omit<SerpBenchmark, 'subtopics' | 'confidence'> {
  const competitionLevel = competitionLevelFromTotal(total);
  const base = ESTIMATED_TARGETS[competitionLevel];
  return { ...base, sampleSize: 0, competitionLevel };
}

// ─────────────────────────────────────────────────────────────
// C. 생성 반영 — 프롬프트 주입 블록
// ─────────────────────────────────────────────────────────────

/**
 * 생성 프롬프트에 주입할 벤치마크 블록. 의료광고법 가드를 항상 포함하며,
 * 수치는 "목표 가이드"임을 명시하고 비교·비방·우열 표현을 금지한다.
 */
export function buildBenchmarkPromptBlock(benchmark: SerpBenchmark, keyword: string): string {
  const basis = benchmark.confidence === 'measured' ? '상위 글 본문 실측' : '경쟁도 기반 추정';
  const subtopicLine = benchmark.subtopics.length > 0
    ? `\n- 상위 글들이 공통으로 다루는 하위 주제: ${benchmark.subtopics.join(', ')} → 이 주제들을 빠짐없이, 더 깊고 구체적으로 다룰 것`
    : '';
  const faqLine = benchmark.hasFaq
    ? '\n- 상위 글에 FAQ(자주 묻는 질문)가 자주 포함됨 → FAQ 섹션을 충실히 작성'
    : '';
  return `【상위노출 역분석 — "${keyword}" 상위 글 벤치마크 (${basis}, 분석 자료)】
현재 "${keyword}" 상위 노출 글들을 역분석한 목표 골격입니다. 아래 "이상"으로 충실히 작성하세요.
- 권장 분량: 약 ${benchmark.targetCharCount}자 이상 (충분한 깊이 확보)
- 주요 소제목(H2): 약 ${benchmark.targetH2}개 / 세부 소제목(H3): 약 ${benchmark.targetH3}개
- 이미지: 약 ${benchmark.targetImages}개${subtopicLine}${faqLine}
→ 단, 위 수치는 목표 가이드일 뿐 의료광고법(타 병원 비교·비방, 효과·수치 단정, 환자 유인 과장 금지)이 항상 최우선입니다. 경쟁 글과의 우열·비교 문구는 절대 쓰지 마세요.`;
}

// ─────────────────────────────────────────────────────────────
// 오케스트레이터 — 본문 fetch(동시성/타임아웃) + 집계/폴백
// ─────────────────────────────────────────────────────────────

/** 네이버 블로그 링크에서 PC/모바일 본문 URL 후보를 만든다. 파싱 실패 시 원본. */
export function toMobilePostUrl(link: string): string {
  try {
    const u = new URL(link);
    const blogIdQ = u.searchParams.get('blogId');
    const logNoQ = u.searchParams.get('logNo');
    if (blogIdQ && logNoQ) {
      return `https://m.blog.naver.com/${blogIdQ}/${logNoQ}`;
    }
    // 경로형: /{blogId}/{logNo}
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
      return `https://m.blog.naver.com/${parts[0]}/${parts[1]}`;
    }
    // m. 호스트로만 치환
    if (u.hostname === 'blog.naver.com') {
      return `https://m.blog.naver.com${u.pathname}${u.search}`;
    }
    return link;
  } catch {
    return link;
  }
}

async function fetchBodyWithTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DoctorpostBot/1.0)' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 동시성 제한 map. 결과는 입력 순서를 보존한다. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface BuildBenchmarkOptions {
  topN?: number;
  bodyFetchLimit?: number;
  concurrency?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: number;
  /** 하위주제 추출기 (기본: competitor-analysis.analyzeCompetitorPosts → topics). 테스트 주입용. */
  analyze?: (posts: SerpPost[]) => Promise<string[]>;
}

async function defaultAnalyze(posts: SerpPost[]): Promise<string[]> {
  // 동적 import — competitor-analysis(→ anthropic SDK) 를 모듈 로드 시점이 아니라
  // 실제 호출 시점에만 끌어온다. 순수 로직 단위테스트가 SDK·경로 alias 없이 동작하게 함.
  const { analyzeCompetitorPosts } = await import('@/content/lib/competitor-analysis');
  const naverPosts: NaverPost[] = posts.map((p) => ({
    title: p.title,
    description: p.description,
    link: p.link,
    postdate: p.postdate,
    bloggername: p.bloggername,
  }));
  const insights = await analyzeCompetitorPosts(naverPosts);
  return insights.topics;
}

/**
 * 키워드 1개의 상위노출 역분석 벤치마크를 만든다.
 *
 * 동작:
 *  1) 상위 글 수집(graceful). 비면 null(벤치마크 없음 → 호출측은 고정 기준 폴백).
 *  2) 권위 가중 정렬 → 상위 소수의 본문을 best-effort fetch(동시성/타임아웃).
 *  3) 본문 측정 성공분이 있으면 robust 집계(confidence='measured'),
 *     하나도 없으면 경쟁도 기반 추정(confidence='estimated').
 *  4) 하위주제는 ANALYSIS_GUARD(의료광고법) 경유 Claude 분석(graceful → []).
 *
 * 전체를 try/catch 로 감싸 어떤 실패도 null 로 폴백한다(생성 플로우 보호).
 */
export async function buildSerpBenchmark(
  keyword: string,
  options: BuildBenchmarkOptions = {}
): Promise<SerpBenchmark | null> {
  try {
    if (!keyword || keyword.trim() === '') return null;

    const fetchImpl = options.fetchImpl ?? fetch;
    const env = options.env ?? process.env;
    const now = options.now ?? Date.now();
    const topN = options.topN ?? DEFAULT_TOP_N;
    const bodyFetchLimit = options.bodyFetchLimit ?? DEFAULT_BODY_FETCH_LIMIT;
    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const analyze = options.analyze ?? defaultAnalyze;

    const { posts, total } = await fetchTopBlogPosts(keyword, { display: topN, fetchImpl, env });
    if (posts.length === 0) return null;

    const ranked = rankPostsByAuthority(posts, now);

    // 하위주제 추출 (graceful)
    let subtopics: string[] = [];
    try {
      subtopics = await analyze(ranked.slice(0, 10));
    } catch {
      subtopics = [];
    }

    // 권위 상위 소수만 본문 측정 (best-effort)
    const targets = ranked.slice(0, Math.max(0, bodyFetchLimit)).filter((p) => p.link);
    const htmls = await mapLimit(targets, concurrency, (p) =>
      fetchBodyWithTimeout(toMobilePostUrl(p.link), timeoutMs, fetchImpl)
    );
    const measured = htmls
      .map((html) => (html ? parsePostBodyMetrics(html) : null))
      .filter((m): m is PostBodyMetrics => m !== null);

    const competitionLevel = competitionLevelFromTotal(total);

    const agg = aggregateMeasured(measured);
    if (agg) {
      return { ...agg, subtopics, confidence: 'measured', competitionLevel };
    }

    const est = estimateBenchmark(total);
    return { ...est, subtopics, confidence: 'estimated' };
  } catch {
    return null;
  }
}
