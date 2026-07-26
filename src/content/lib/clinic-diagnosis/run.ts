import { fetchBlogCheckFeed, fetchLatestBodies } from '../blog-check-rss.ts';
import { extractTargetKeywords } from '../blog-check-keywords.ts';
import { fetchKeywordSerps } from '../blog-check-serp.ts';
import { checkCompliance } from '../medical-compliance.ts';
import { discoverClinicBlog, type NaverSearchEnv } from './blog-discovery.ts';
import { findClinicSiteUrl } from './naver-local.ts';
import { auditSite, EMPTY_SITE_AXIS } from './site-audit.ts';
import { runAiCitation, EMPTY_AI_AXIS, type OwnedAssets } from './ai-citation.ts';
import {
  buildComplianceAxis,
  EMPTY_COMPLIANCE_AXIS,
  type ComplianceSource,
} from './compliance-scan.ts';
import { buildFindings, collectUnchecked } from './findings.ts';
import { normalizeSiteUrl } from './site-audit.ts';
import type {
  BlogAxis,
  ClinicCandidate,
  DiagnosisReport,
  KeywordRank,
  SiteAxis,
} from './types.ts';

/**
 * 병원명 무료진단 — 오케스트레이터.
 *
 * 그레이스풀 철학(blog-check 와 동일): **어떤 축이 실패해도 진단은 계속된다.**
 * 실패한 축은 checked:false 로 남고 화면에 "확인하지 못했습니다"로 나간다.
 * 이 파이프라인에는 하드 실패가 없다 — 병원 특정은 이미 앞 단계에서 끝났다.
 *
 * 시간 예산 (라우트 maxDuration 60초 기준):
 *   1단계 탐색(블로그·홈페이지 주소)   ~8초   — 병렬
 *   2단계 측정(블로그 · 홈페이지 · AI)  ~40초  — 병렬
 * 각 하위 호출은 자체 타임아웃을 갖고, 초과분은 그 항목만 null 로 떨어진다.
 *
 * 크롤링 금지 — 네이버 공식 API·공식 RSS·대상 사이트 1회 GET 까지만.
 */

/** 블로그 RSS 타임아웃(ms). */
export const RSS_TIMEOUT_MS = 8_000;
/** 본문 수집 편수·타임아웃 — 컴플라이언스 검사 표본. */
export const BODY_LIMIT = 2;
export const BODY_TIMEOUT_MS = 8_000;
/** 키워드 실측 상한과 예산. */
export const MAX_KEYWORDS = 4;
export const KEYWORD_BUDGET_MS = 12_000;
/** AI 축 데드라인(ms). */
export const AI_DEADLINE_MS = 30_000;
/** 최근 발행 리듬 계산 구간(주). */
export const CADENCE_WEEKS = 12;

export interface DiagnosisEnv extends NaverSearchEnv {
  readonly [key: string]: string | undefined;
}

export interface RunDiagnosisOptions {
  readonly env?: DiagnosisEnv;
  readonly fetchImpl?: typeof fetch;
  readonly now?: number;
  /** 사용자가 직접 지정한 블로그 ID — 자동 탐색을 건너뛴다(상세 진단 경로). */
  readonly manualBlogId?: string | null;
  /** 사용자가 직접 지정한 홈페이지 주소 — 자동 탐색을 건너뛴다. */
  readonly manualSiteUrl?: string | null;
  /** 사용자가 붙여넣은 글 본문 — 컴플라이언스 정밀 점검용(상세 진단 경로). */
  readonly pastedBody?: string | null;
  /** AI 인용 축을 돌릴지. 비용 방어로 호출부가 끈다(캐시 히트 시 등). */
  readonly includeAi?: boolean;
}

/** 진단 대상 키워드 — 지역·진료과 조합 + 블로그 제목에서 뽑은 실제 타깃. */
export function buildDiagnosisKeywords(
  clinic: Pick<ClinicCandidate, 'region' | 'province' | 'specialty'>,
  titles: readonly string[],
): readonly string[] {
  const out: string[] = [];
  const shortProvince = clinic.province.replace(/(특별자치도|특별자치시|특별시|광역시|도)$/u, '');
  const specialty = clinic.specialty.trim();

  if (specialty) {
    if (clinic.region) out.push(`${clinic.region} ${specialty}`);
    if (shortProvince && shortProvince !== clinic.region) out.push(`${shortProvince} ${specialty}`);
  }
  for (const candidate of extractTargetKeywords(titles)) {
    out.push(candidate.keyword);
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const kw of out) {
    const value = kw.trim();
    if (value.length < 2 || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
    if (unique.length >= MAX_KEYWORDS) break;
  }
  return unique;
}

/** 발행일 목록 → 최근성·리듬 (순수 함수). */
export function computeBlogRhythm(
  publishedAt: readonly (string | null)[],
  now: number,
): { latestPostAt: string | null; daysSinceLatest: number | null; postsPerWeek: number | null } {
  const times = publishedAt
    .map((iso) => (iso ? Date.parse(iso) : Number.NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a);
  if (times.length === 0) return { latestPostAt: null, daysSinceLatest: null, postsPerWeek: null };

  const latest = times[0];
  const windowStart = now - CADENCE_WEEKS * 7 * 24 * 60 * 60 * 1000;
  const inWindow = times.filter((t) => t >= windowStart).length;
  return {
    latestPostAt: new Date(latest).toISOString(),
    daysSinceLatest: Math.max(0, Math.floor((now - latest) / (24 * 60 * 60 * 1000))),
    postsPerWeek: Math.round((inWindow / CADENCE_WEEKS) * 10) / 10,
  };
}

const EMPTY_BLOG_AXIS: BlogAxis = {
  checked: false,
  source: null,
  resolution: { kind: 'none' },
  blogId: null,
  blogTitle: null,
  postCount: null,
  latestPostAt: null,
  daysSinceLatest: null,
  postsPerWeek: null,
  keywords: [],
  rankChecked: false,
};

/** 블로그 축 측정 — 탐색 결과가 확정일 때만 RSS 이후 단계로 간다. */
async function measureBlog(
  clinic: ClinicCandidate,
  options: RunDiagnosisOptions,
  now: number,
): Promise<{ axis: BlogAxis; sources: readonly ComplianceSource[] }> {
  const env = options.env ?? (process.env as DiagnosisEnv);
  const fetchImpl = options.fetchImpl ?? fetch;

  const manual = (options.manualBlogId ?? '').trim();
  const resolution = manual
    ? ({ kind: 'confident' as const, guess: { blogId: manual, bloggerName: '', hits: 0, nameInBloggerName: false, titleMentions: 0, confidence: 100 } })
    : await discoverClinicBlog(clinic.name, clinic.specialty, { env, fetchImpl });

  if (resolution.kind !== 'confident') {
    return { axis: { ...EMPTY_BLOG_AXIS, checked: true, source: manual ? 'manual' : 'auto', resolution }, sources: [] };
  }

  const blogId = resolution.guess.blogId;
  const base: BlogAxis = {
    ...EMPTY_BLOG_AXIS,
    checked: true,
    source: manual ? 'manual' : 'auto',
    resolution,
    blogId,
  };

  const rss = await fetchBlogCheckFeed(blogId, { fetchImpl, timeoutMs: RSS_TIMEOUT_MS });
  if (!rss.ok) {
    // 블로그는 특정했지만 RSS 가 비공개·없음 — 측정만 실패한 것으로 남긴다.
    return { axis: base, sources: [] };
  }

  const feed = rss.feed;
  const titles = feed.items.map((it) => it.title);
  const rhythm = computeBlogRhythm(feed.items.map((it) => it.publishedAt), now);

  const bodies = await fetchLatestBodies(blogId, feed.items, {
    fetchImpl,
    limit: BODY_LIMIT,
    timeoutMs: BODY_TIMEOUT_MS,
  });

  const keywordTexts = buildDiagnosisKeywords(clinic, titles);
  const serps = await fetchKeywordSerps(keywordTexts, blogId, {
    env: env as NodeJS.ProcessEnv,
    fetchImpl,
    deadline: Date.now() + KEYWORD_BUDGET_MS,
  });
  const keywords: readonly KeywordRank[] = keywordTexts.map((keyword) => ({
    keyword,
    apiRank: serps[keyword]?.rank ?? null,
    docCount: serps[keyword]?.docCount ?? null,
  }));

  const bodyByLink = new Map(bodies.map((b) => [b.link, b.body]));
  const sources: ComplianceSource[] = feed.items.map((item) => {
    const body = bodyByLink.get(item.link);
    return {
      title: item.title,
      link: item.link,
      text: body ? `${item.title}\n${body}` : item.title,
      hasBody: Boolean(body),
    };
  });

  return {
    axis: {
      ...base,
      blogTitle: feed.blogTitle || null,
      postCount: feed.items.length,
      latestPostAt: rhythm.latestPostAt,
      daysSinceLatest: rhythm.daysSinceLatest,
      postsPerWeek: rhythm.postsPerWeek,
      keywords,
      rankChecked: keywords.some((k) => k.docCount !== null || k.apiRank !== null),
    },
    sources,
  };
}

/** 홈페이지 축 측정 — 주소를 못 찾으면 요청 자체를 하지 않는다. */
async function measureSite(clinic: ClinicCandidate, options: RunDiagnosisOptions): Promise<SiteAxis> {
  const env = options.env ?? (process.env as DiagnosisEnv);
  const fetchImpl = options.fetchImpl ?? fetch;

  const manual = (options.manualSiteUrl ?? '').trim();
  if (manual) {
    if (!normalizeSiteUrl(manual)) return { ...EMPTY_SITE_AXIS, source: 'manual' };
    return auditSite(manual, { fetchImpl, source: 'manual' });
  }

  const found = await findClinicSiteUrl(clinic.name, clinic.region, { env, fetchImpl });
  if (!found) return { ...EMPTY_SITE_AXIS, source: null };
  return auditSite(found, { fetchImpl, source: 'naver' });
}

/**
 * 진단 1건 실행. 절대 throw 하지 않는다 — 축별 실패는 축 내부에서 흡수된다.
 */
export async function runClinicDiagnosis(
  clinic: ClinicCandidate,
  options: RunDiagnosisOptions = {},
): Promise<DiagnosisReport> {
  const now = options.now ?? Date.now();
  const env = options.env ?? (process.env as DiagnosisEnv);
  const fetchImpl = options.fetchImpl ?? fetch;

  // 1단계 — 블로그 특정과 홈페이지 진단은 서로 독립이라 병렬로 돈다.
  const [blogResult, site] = await Promise.all([
    measureBlog(clinic, options, now).catch((error: unknown) => {
      console.error('[clinic-diagnosis] 블로그 축 실패:', error instanceof Error ? error.message : error);
      return { axis: EMPTY_BLOG_AXIS, sources: [] as readonly ComplianceSource[] };
    }),
    measureSite(clinic, options).catch((error: unknown) => {
      console.error('[clinic-diagnosis] 홈페이지 축 실패:', error instanceof Error ? error.message : error);
      return EMPTY_SITE_AXIS;
    }),
  ]);

  const owned: OwnedAssets = {
    blogId: blogResult.axis.blogId,
    siteHost: site.url ? (normalizeSiteUrl(site.url)?.hostname ?? null) : null,
  };

  // 2단계 — AI 인용은 자기 자산 정보가 있어야 경로를 나눌 수 있어 뒤에 돈다.
  const ai =
    options.includeAi === false
      ? EMPTY_AI_AXIS
      : await runAiCitation(
          { clinicName: clinic.name, region: clinic.region, specialty: clinic.specialty, owned },
          { env, fetchImpl, deadlineMs: AI_DEADLINE_MS },
        );

  // 컴플라이언스 — 붙여넣은 본문이 있으면 표본에 더한다(상세 진단 경로).
  const pasted = (options.pastedBody ?? '').trim();
  const sources: readonly ComplianceSource[] = pasted
    ? [
        ...blogResult.sources,
        { title: '직접 입력한 글', link: 'manual:pasted', text: pasted.slice(0, 20_000), hasBody: true },
      ]
    : blogResult.sources;
  const compliance = sources.length > 0 ? buildComplianceAxis(sources, checkCompliance) : EMPTY_COMPLIANCE_AXIS;

  const axes = { blog: blogResult.axis, site, ai, compliance };
  return {
    version: 1,
    runAt: new Date(now).toISOString(),
    clinic,
    ...axes,
    findings: buildFindings(axes),
    unchecked: collectUnchecked(axes),
  };
}
