import { fetchKeywordVolumes, normalizeKeyword, type KeywordVolume } from './keyword-volume.ts';
import { fetchBlogCheckFeed, fetchLatestBodies, type BlogCheckFeed } from './blog-check-rss.ts';
import {
  extractTargetKeywords,
  extractKeywordsWithLlmFallback,
  type TargetKeywordCandidate,
} from './blog-check-keywords.ts';
import { fetchKeywordSerps, SERP_TOTAL_BUDGET_MS } from './blog-check-serp.ts';
import {
  computeCadence,
  computeSeoScore,
  computeGeoScore,
  computeTitleQuality,
  buildFallbackFeedback,
  type Cadence,
  type SeoScoreBreakdown,
  type GeoScore,
  type TitleQualityStats,
  type CheckFeedback,
  type KeywordMeasurement,
} from './blog-check-score.ts';
import { checkCompliance } from './medical-compliance.ts';
import { buildAuditPost, type AuditPostResult } from './compliance-report.ts';
import type { RelevanceGateCreate } from './relevance-gate.ts';

/**
 * 네이버 블로그 무료진단 — 간단분석 파이프라인 (오케스트레이터).
 *
 * RSS 수집 → 본문 1~2편 → 타깃 키워드 추출 → 실측(검색량·문서수·순위)
 * → 점수 산출 → 컴플라이언스 검출(A층, 검출만) → 장단점 요약(LLM 1콜, 폴백 룰).
 *
 * 그레이스풀 철학: RSS 실패만 진단 실패이며, 나머지 단계는 전부 부분 실패를
 * 허용한다(해당 지표만 null/생략). LLM 은 실패 시 규칙 기반 폴백.
 *
 * 컴플라이언스: 매출·방문자 추정 없음(공개 지표만), 타 병원 비교 없음,
 * 위험 표현은 검출·표시만(자동치환 금지 원칙).
 */

/** 요약(장단점) LLM 타임아웃(ms). */
export const BLOG_CHECK_FEEDBACK_TIMEOUT_MS = 12_000;

export interface BlogCheckCompliancePost {
  title: string;
  link: string;
  grade: AuditPostResult['grade'];
  violations: AuditPostResult['violations'];
  warnings: string[];
}

export interface BlogCheckReport {
  version: 1;
  blogId: string;
  blogTitle: string;
  runAt: string;
  /** RSS 에서 수집한 최근 글 수 (최대 50). */
  totalPosts: number;
  /** 수집한 글 제목 목록 (상세분석 품질 진단·근거 표시용). */
  titles: string[];
  cadence: Cadence;
  seo: SeoScoreBreakdown;
  geo: GeoScore;
  compliance: {
    /** 위반+경고 총 검출 건수 (간단분석 표시용). */
    count: number;
    violationCount: number;
    warningCount: number;
    /** 검출이 있었던 글 수. */
    postsWithFindings: number;
  };
  /** 키워드별 실측 전체 (상세분석 테이블). */
  keywords: KeywordMeasurement[];
  /** 검색광고 API(월 검색량) 사용 가능 여부. */
  volumesAvailable: boolean;
  /** 오픈API(문서수·순위) 사용 가능 여부. */
  serpAvailable: boolean;
  quality: TitleQualityStats;
  /** 장점 2~3 + 부족한 점 2~3 (마지막 항목이 심화 지적 — 비회원에겐 블러). */
  feedback: CheckFeedback;
  feedbackSource: 'llm' | 'rule';
  /** 검출이 있었던 글 상세 (상세분석 전용). */
  compliancePosts: BlogCheckCompliancePost[];
  /** 황금 키워드 씨앗 (상세분석에서 golden-keywords 연결용). */
  seedKeyword: { base: string; region: string } | null;
  /** 수집한 본문 편수 (VOICE-DNA 안내 표시용). */
  bodiesCollected: number;
}

export type BlogCheckRunResult =
  | { ok: true; report: BlogCheckReport }
  | { ok: false; reason: 'not_found' | 'empty' };

/** LLM 장단점 응답 파싱 (순수 함수). 형태 미달 시 null → 폴백. */
export function parseFeedbackJson(text: string): CheckFeedback | null {
  if (!text || typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as { strengths?: unknown; weaknesses?: unknown };
  const clean = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter((v) => v.length >= 5 && v.length <= 200)
          .slice(0, 3)
      : [];
  const strengths = clean(obj.strengths);
  const weaknesses = clean(obj.weaknesses);
  if (strengths.length < 2 || weaknesses.length < 2) return null;
  return { strengths, weaknesses };
}

const FEEDBACK_SYSTEM = `당신은 병원 블로그 진단 코치입니다. 실측 지표 요약을 보고
장점 2~3개, 부족한 점 3개를 짧고 구체적으로 씁니다.

【규칙】
- 각 항목은 한 문장(40~90자), 존댓말, 실측 수치를 근거로.
- weaknesses 의 마지막 항목은 가장 임팩트 있는 심화 지적으로 (상세분석 유인).
- 의료광고법 금지 표현(최고·보장·완치 등) 사용 금지. 매출·방문자 추정 금지. 타 병원 비교 금지.
- JSON 만 출력: {"strengths":["..."],"weaknesses":["..."]}`;

async function buildLlmFeedback(
  report: Pick<BlogCheckReport, 'seo' | 'geo' | 'cadence' | 'compliance' | 'totalPosts'>,
  keywords: readonly KeywordMeasurement[],
  options: { env?: NodeJS.ProcessEnv; createMessage?: RelevanceGateCreate; timeoutMs?: number },
): Promise<CheckFeedback | null> {
  const env = options.env ?? process.env;
  if (!env.ANTHROPIC_API_KEY?.trim()) return null;

  try {
    // 기본 경로는 본문 생성과 동일한 MODEL 상수를 재사용한다(다운그레이드 금지).
    // 테스트 주입 시에는 SDK 로드 없이 주입 함수를 그대로 쓴다.
    let createMessage = options.createMessage;
    let model = 'claude-sonnet-4-6';
    if (!createMessage) {
      const { getAnthropicClient, MODEL } = await import('./anthropic.ts');
      const client = getAnthropicClient();
      model = MODEL;
      createMessage = (params) => client.messages.create(params);
    }

    const summary = {
      totalPosts: report.totalPosts,
      seo: report.seo,
      geo: report.geo.score,
      cadence: report.cadence,
      complianceFindings: report.compliance.count,
      keywords: keywords.slice(0, 10).map((m) => ({
        keyword: m.keyword,
        monthlyVolume: m.volume?.total ?? null,
        docCount: m.docCount,
        rank: m.rank,
      })),
    };

    const timeoutMs = options.timeoutMs ?? BLOG_CHECK_FEEDBACK_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const response = await Promise.race([
      createMessage({
        model,
        max_tokens: 1024,
        system: FEEDBACK_SYSTEM,
        messages: [
          { role: 'user', content: `진단 지표 요약:\n${JSON.stringify(summary, null, 1)}\n\nJSON으로 장단점을 작성하세요.` },
        ],
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`blog_check_feedback_timeout_${timeoutMs}ms`)), timeoutMs);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && typeof textBlock.text === 'string' ? textBlock.text : '';
    return parseFeedbackJson(text);
  } catch (error) {
    console.error(
      '[blog-check] 장단점 LLM 실패 — 규칙 폴백:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/** 후보 키워드들의 월 검색량을 5개 단위로 나눠 조회한다 (keywordstool 힌트 제한). */
async function fetchVolumesChunked(
  keywords: readonly string[],
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch },
): Promise<{ available: boolean; byNorm: Map<string, KeywordVolume> }> {
  const byNorm = new Map<string, KeywordVolume>();
  let available = false;
  for (let i = 0; i < keywords.length; i += 5) {
    const chunk = keywords.slice(i, i + 5);
    const result = await fetchKeywordVolumes(chunk, options);
    if (result.available) available = true;
    for (const [kw, vol] of Object.entries(result.volumes)) {
      byNorm.set(normalizeKeyword(kw), vol);
    }
  }
  return { available, byNorm };
}

/** 황금 키워드 씨앗 선정 — 지역 결합 후보 중 최빈, 없으면 첫 후보. */
export function pickSeedKeyword(
  candidates: readonly TargetKeywordCandidate[],
): { base: string; region: string } | null {
  if (candidates.length === 0) return null;
  const withRegion = candidates.find((c) => c.region !== '');
  const chosen = withRegion ?? candidates[0];
  return { base: chosen.base, region: chosen.region };
}

/**
 * 간단분석 전체 파이프라인 실행.
 * RSS 실패만 실패로 반환하고, 나머지 단계는 부분 실패를 허용한다.
 */
export async function runBlogCheck(
  blogId: string,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    /** 테스트 주입용 LLM 호출 (키워드 폴백·장단점 공용). */
    createMessage?: RelevanceGateCreate;
    now?: number;
  } = {},
): Promise<BlogCheckRunResult> {
  const now = options.now ?? Date.now();

  // 1) RSS — 유일한 하드 실패 지점
  const rss = await fetchBlogCheckFeed(blogId, { fetchImpl: options.fetchImpl });
  if (!rss.ok) {
    return { ok: false, reason: rss.reason === 'empty' ? 'empty' : 'not_found' };
  }
  const feed: BlogCheckFeed = rss.feed;
  const titles = feed.items.map((it) => it.title);

  // 2) 최신 본문 1~2편 (실패해도 계속)
  const bodies = await fetchLatestBodies(blogId, feed.items, { fetchImpl: options.fetchImpl });

  // 3) 타깃 키워드 — 규칙 우선 + 부족 시 Haiku 1콜
  const ruleCandidates = extractTargetKeywords(titles);
  const candidates = await extractKeywordsWithLlmFallback(titles, ruleCandidates, {
    env: options.env,
    createMessage: options.createMessage,
  });

  // 4) 실측 — 월 검색량(keywordstool) + 문서수·순위(blog.json)
  const keywordTexts = candidates.map((c) => c.keyword);
  const [volumes, serps] = await Promise.all([
    fetchVolumesChunked(keywordTexts, { env: options.env, fetchImpl: options.fetchImpl }),
    fetchKeywordSerps(keywordTexts, blogId, {
      env: options.env,
      fetchImpl: options.fetchImpl,
      deadline: Date.now() + SERP_TOTAL_BUDGET_MS,
    }),
  ]);

  const measurements: KeywordMeasurement[] = candidates.map((c) => ({
    keyword: c.keyword,
    volume: volumes.byNorm.get(normalizeKeyword(c.keyword)) ?? null,
    docCount: serps[c.keyword]?.docCount ?? null,
    rank: serps[c.keyword]?.rank ?? null,
  }));
  const serpAvailable = measurements.some((m) => m.docCount !== null || m.rank !== null);

  // 5) 컴플라이언스 — 제목 전체 + 수집 본문, A층 검출만 (자동치환 금지)
  const bodyByLink = new Map(bodies.map((b) => [b.link, b.body]));
  const compliancePosts: BlogCheckCompliancePost[] = [];
  let violationCount = 0;
  let warningCount = 0;
  for (const item of feed.items) {
    const body = bodyByLink.get(item.link);
    const text = body ? `${item.title}\n${body}` : item.title;
    const result = checkCompliance(text);
    if (result.violations.length === 0 && result.warnings.length === 0) continue;
    violationCount += result.violations.length;
    warningCount += result.warnings.length;
    const post = buildAuditPost({
      title: item.title || '(제목 없음)',
      link: item.link,
      body: text,
      compliance: result,
    });
    compliancePosts.push({
      title: post.title,
      link: post.link,
      grade: post.grade,
      violations: post.violations,
      warnings: post.warnings,
    });
  }
  compliancePosts.sort((a, b) => b.violations.length - a.violations.length);

  // 6) 점수 산출
  const cadence = computeCadence(feed.items.map((it) => it.publishedAt), now);
  const seo = computeSeoScore(measurements, cadence);
  const geo = computeGeoScore({ totalPosts: feed.items.length, cadenceGrade: cadence.grade });
  const quality = computeTitleQuality(titles);
  const compliance = {
    count: violationCount + warningCount,
    violationCount,
    warningCount,
    postsWithFindings: compliancePosts.length,
  };

  // 7) 장단점 요약 — LLM 1콜, 실패 시 규칙 폴백
  const partial = { seo, geo, cadence, compliance, totalPosts: feed.items.length };
  const llmFeedback = await buildLlmFeedback(partial, measurements, {
    env: options.env,
    createMessage: options.createMessage,
  });
  const feedback =
    llmFeedback ??
    buildFallbackFeedback({
      seo,
      geo,
      cadence,
      complianceCount: compliance.count,
      measurements,
    });

  return {
    ok: true,
    report: {
      version: 1,
      blogId,
      blogTitle: feed.blogTitle,
      runAt: new Date(now).toISOString(),
      totalPosts: feed.items.length,
      titles,
      cadence,
      seo,
      geo,
      compliance,
      keywords: measurements,
      volumesAvailable: volumes.available,
      serpAvailable,
      quality,
      feedback,
      feedbackSource: llmFeedback ? 'llm' : 'rule',
      compliancePosts: compliancePosts.slice(0, 20),
      seedKeyword: pickSeedKeyword(candidates),
      bodiesCollected: bodies.length,
    },
  };
}

/* ── 글 품질 진단 (상세분석 전용 — LLM 1콜 + 규칙 폴백) ───── */

const QUALITY_SYSTEM = `당신은 병원 블로그 글 품질 코치입니다. 제목 목록과 반복도 통계를 보고
템플릿 반복·제목 중복 관점의 진단 코멘트를 2~3문장으로 씁니다.

【규칙】
- 존댓말, 구체적으로 (예: 어떤 패턴이 반복되는지 짚기).
- 의료광고법 금지 표현 사용 금지. 매출·방문자 추정 금지. 타 병원 비교 금지.
- 코멘트 텍스트만 출력 (JSON·머리말 없이).`;

/** 규칙 기반 품질 코멘트 (LLM 실패 폴백). */
export function buildFallbackQualityComment(stats: TitleQualityStats): string {
  if (stats.duplicatePairs > 0) {
    return (
      `제목 ${stats.pairsChecked}쌍 중 ${stats.duplicatePairs}쌍이 사실상 중복이에요(최대 유사도 ${Math.round(stats.maxSimilarity * 100)}%). ` +
      '같은 틀의 제목이 반복되면 검색 노출에서 서로 경쟁하고 저품질 신호가 될 수 있어요. 제목 구조를 다양화해 보세요.'
    );
  }
  return '제목 중복은 발견되지 않았어요. 다만 검색 수요가 있는 키워드를 제목 앞쪽에 배치하는 패턴을 유지하는 것이 좋아요.';
}

/**
 * 글 품질 진단 코멘트 — LLM 1콜, 실패·키 없음 시 규칙 폴백 (절대 throw 금지).
 */
export async function buildQualityDiagnosis(
  stats: TitleQualityStats,
  titles: readonly string[],
  options: { env?: NodeJS.ProcessEnv; createMessage?: RelevanceGateCreate; timeoutMs?: number } = {},
): Promise<{ comment: string; source: 'llm' | 'rule' }> {
  const fallback = { comment: buildFallbackQualityComment(stats), source: 'rule' as const };
  const env = options.env ?? process.env;
  if (!env.ANTHROPIC_API_KEY?.trim()) return fallback;

  try {
    let createMessage = options.createMessage;
    let model = 'claude-sonnet-4-6';
    if (!createMessage) {
      const { getAnthropicClient, MODEL } = await import('./anthropic.ts');
      const client = getAnthropicClient();
      model = MODEL;
      createMessage = (params) => client.messages.create(params);
    }

    const timeoutMs = options.timeoutMs ?? BLOG_CHECK_FEEDBACK_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const response = await Promise.race([
      createMessage({
        model,
        max_tokens: 512,
        system: QUALITY_SYSTEM,
        messages: [
          {
            role: 'user',
            content:
              `반복도 통계: ${JSON.stringify(stats)}\n\n최근 글 제목:\n` +
              titles.slice(0, 30).map((t) => `- ${t}`).join('\n') +
              '\n\n진단 코멘트를 2~3문장으로 작성하세요.',
          },
        ],
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`blog_check_quality_timeout_${timeoutMs}ms`)), timeoutMs);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && typeof textBlock.text === 'string' ? textBlock.text.trim() : '';
    if (text.length < 20 || text.length > 600) return fallback;
    return { comment: text, source: 'llm' };
  } catch (error) {
    console.error(
      '[blog-check] 품질 진단 LLM 실패 — 규칙 폴백:',
      error instanceof Error ? error.message : error,
    );
    return fallback;
  }
}

/* ── 캐시 키·TTL (간단/상세 라우트 공용) ──────────────────── */

/** 진단 리포트 캐시 TTL — 7일 (스펙: blogId 7일 결과 캐시). */
export const BLOG_CHECK_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 진단 리포트 캐시 키 — 간단분석·상세분석 라우트가 공유한다. */
export function blogCheckCacheKey(blogId: string): string {
  return `blogcheck:${blogId}`;
}

/* ── 간단분석 공개 응답 (비회원용 축약) ───────────────────── */

export interface BlogCheckSimpleResult {
  blogId: string;
  blogTitle: string;
  runAt: string;
  totalPosts: number;
  scores: {
    seo: number;
    seoBreakdown: SeoScoreBreakdown;
    geo: number;
    geoReason: string;
    complianceCount: number;
    cadenceGrade: Cadence['grade'];
    postsPerWeek: number;
  };
  /** 상위 키워드 실측 미리보기 (전체 테이블은 상세분석). */
  keywordPreview: KeywordMeasurement[];
  strengths: string[];
  /** 공개되는 부족한 점 (마지막 심화 지적 제외). */
  weaknesses: string[];
  /** 블러 처리되는 심화 지적 — 본문은 회원 전용, 티저만 노출. */
  lockedWeakness: { teaser: string } | null;
}

/**
 * 내부 리포트 → 비회원 공개 응답. 심화 지적(마지막 weakness) 본문은
 * 응답에서 제거하고 티저(앞 12자)만 담는다 — 클라이언트 블러 우회 방지.
 */
export function toSimpleResult(report: BlogCheckReport): BlogCheckSimpleResult {
  const weaknesses = [...report.feedback.weaknesses];
  const locked = weaknesses.length >= 2 ? weaknesses.pop() ?? null : null;

  return {
    blogId: report.blogId,
    blogTitle: report.blogTitle,
    runAt: report.runAt,
    totalPosts: report.totalPosts,
    scores: {
      seo: report.seo.total,
      seoBreakdown: report.seo,
      geo: report.geo.score,
      geoReason: report.geo.reason,
      complianceCount: report.compliance.count,
      cadenceGrade: report.cadence.grade,
      postsPerWeek: report.cadence.postsPerWeek,
    },
    keywordPreview: report.keywords.slice(0, 3),
    strengths: report.feedback.strengths,
    weaknesses,
    lockedWeakness: locked ? { teaser: `${locked.slice(0, 12)}…` } : null,
  };
}
