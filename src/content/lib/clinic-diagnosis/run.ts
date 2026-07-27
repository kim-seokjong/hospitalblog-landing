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
import {
  analyzePostSeo,
  classifyBodyKind,
  SEO_POST_LIMIT,
  type SeoPostInput,
} from './post-seo.ts';
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
/**
 * 본문 수집 편수 — 최근 글 SEO 점검 표본(5편)과 같은 수로 맞춘다.
 * 편수를 늘리는 대신 **전체 예산(BODY_BUDGET_MS)** 을 걸어 최악 소요를 줄였다:
 *   기존 2편 × 8초 = 최악 16초  →  현재 5편 · 총 14초 상한.
 */
export const BODY_LIMIT = SEO_POST_LIMIT;
export const BODY_TIMEOUT_MS = 6_000;
export const BODY_BUDGET_MS = 14_000;
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

/** 시·도 축약형 ('대구광역시' → '대구'). */
export function shortProvinceOf(province: string): string {
  return (province ?? '').replace(/(특별자치도|특별자치시|특별시|광역시|도)$/u, '');
}

/**
 * 환자가 실제로 말하는 지역 표기.
 *
 * 구·군 이름만 쓰면 안 된다 — "중구 성형외과"는 전국 어느 중구인지 알 수 없어
 * AI 답변이 엉뚱한 지역 병원으로 채워진다(실측에서 그렇게 나왔다).
 * "대구 중구" 처럼 시·도를 앞에 붙인다.
 */
export function displayRegion(clinic: Pick<ClinicCandidate, 'region' | 'province'>): string {
  const short = shortProvinceOf(clinic.province);
  const region = (clinic.region ?? '').trim();
  if (short && region && region !== short) return `${short} ${region}`;
  return region || short;
}

/** 진단 대상 키워드 — 지역·진료과 조합 + 블로그 제목에서 뽑은 실제 타깃. */
export function buildDiagnosisKeywords(
  clinic: Pick<ClinicCandidate, 'region' | 'province' | 'specialty'>,
  titles: readonly string[],
): readonly string[] {
  const out: string[] = [];
  const shortProvince = shortProvinceOf(clinic.province);
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
  postSeo: null,
};

/**
 * 최근 글 SEO 점검 입력 만들기 (순수 함수).
 *
 * 새 호출을 만들지 않는다 — 이미 받아 둔 RSS 항목과 본문 수집분만 합친다.
 * 본문 전문이 있으면 그것을, 없으면 RSS 가 준 내용을 쓰고 확보 수준을 표시한다.
 */
export function buildSeoPosts(
  items: readonly { title: string; link: string; summary: string; hasImage: boolean }[],
  bodyByLink: ReadonlyMap<string, string>,
  limit: number = SEO_POST_LIMIT,
): readonly SeoPostInput[] {
  return items.slice(0, Math.max(0, limit)).map((item) => {
    const full = bodyByLink.get(item.link) ?? '';
    const text = full || item.summary || '';
    return {
      title: item.title,
      link: item.link,
      body: text,
      bodyKind: classifyBodyKind(text, full.length > 0),
      hasImage: item.hasImage,
    };
  });
}

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
    : await discoverClinicBlog(
        {
          name: clinic.name,
          specialty: clinic.specialty,
          // 병원을 이미 특정했으므로 지역·진료과를 블로그 판정에 그대로 쓴다.
          region: clinic.region,
          province: clinic.province,
        },
        { env, fetchImpl },
      );

  /**
   * confident 뿐 아니라 assumed(1위 후보로 일단 진행)도 측정한다.
   * 사용자는 이미 병원을 골랐다 — 여기서 또 고르라고 멈추면 진단을 못 보고 이탈한다.
   * 어느 블로그를 썼는지는 결과 화면 맨 위에서 밝히고 바꿀 수 있게 한다.
   */
  if (resolution.kind !== 'confident' && resolution.kind !== 'assumed') {
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
    deadline: Date.now() + BODY_BUDGET_MS,
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

  /**
   * 의료광고법 검사 표본 — 제목만 보던 것을 확보한 만큼 넓힌다.
   * 본문 전문이 있으면 전문을, 없으면 RSS 가 준 글 앞부분까지 검사한다.
   * 검출 규칙(medical-compliance)은 그대로 두고 **보는 범위만** 넓힌다.
   */
  const sources: ComplianceSource[] = feed.items.map((item) => {
    const full = bodyByLink.get(item.link) ?? '';
    const text = full || item.summary || '';
    const bodyKind = classifyBodyKind(text, full.length > 0);
    return {
      title: item.title,
      link: item.link,
      text: bodyKind === 'none' ? item.title : `${item.title}\n${text}`,
      hasBody: bodyKind === 'full',
      bodyKind,
    };
  });

  const postSeo = analyzePostSeo(
    buildSeoPosts(feed.items, bodyByLink),
    {
      region: clinic.region,
      shortProvince: shortProvinceOf(clinic.province),
      specialty: clinic.specialty,
    },
    titles,
  );

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
      postSeo: postSeo.checked ? postSeo : null,
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
 * 축 하나가 실패했다 — **어느 축인지 서버 로그에 남긴다.**
 *
 * ★ 실측(2026-07-27)에서 진단 실행 4건 중 1건이 결과에 도달하지 못했는데
 *   실패 원인이 어디에도 기록되지 않아 추적이 불가능했다. 축 이름을 접두어로 고정해
 *   로그만 보고 "어느 축이 몇 번 죽었는지" 셀 수 있게 한다.
 */
function logAxisFailure(axis: 'blog' | 'site' | 'ai' | 'compliance', error: unknown): void {
  console.error(
    `[clinic-diagnosis] axis=${axis} 실패:`,
    error instanceof Error ? `${error.name}: ${error.message}` : error,
  );
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
      logAxisFailure('blog', error);
      return { axis: EMPTY_BLOG_AXIS, sources: [] as readonly ComplianceSource[] };
    }),
    measureSite(clinic, options).catch((error: unknown) => {
      logAxisFailure('site', error);
      return EMPTY_SITE_AXIS;
    }),
  ]);

  const owned: OwnedAssets = {
    blogId: blogResult.axis.blogId,
    siteHost: site.url ? (normalizeSiteUrl(site.url)?.hostname ?? null) : null,
  };

  /**
   * 2단계 — AI 인용은 자기 자산 정보가 있어야 경로를 나눌 수 있어 뒤에 돈다.
   *
   * ⚠️ 다른 축과 **같은 방식으로** 감싼다. 예전에는 이 호출만 try/catch 밖에 있어서
   *    한 번 throw 하면 진단 전체가 500 이 됐고, single-flight 팔로워까지 같은 실패를
   *    받아 **동시에 요청한 사용자 전원이 실패**했다.
   */
  const ai =
    options.includeAi === false
      ? EMPTY_AI_AXIS
      : await runAiCitation(
          {
            clinicName: clinic.name,
            // 구·군만 쓰면 전국 동명 지역과 섞인다 → "대구 중구" 형태로.
            region: displayRegion(clinic),
            specialty: clinic.specialty,
            owned,
          },
          { env, fetchImpl, deadlineMs: AI_DEADLINE_MS },
        ).catch((error: unknown) => {
          logAxisFailure('ai', error);
          return EMPTY_AI_AXIS;
        });

  // 컴플라이언스 — 붙여넣은 본문이 있으면 표본에 더한다(상세 진단 경로).
  const pasted = (options.pastedBody ?? '').trim();
  const sources: readonly ComplianceSource[] = pasted
    ? [
        ...blogResult.sources,
        {
          title: '직접 입력한 글',
          link: 'manual:pasted',
          text: pasted.slice(0, 20_000),
          hasBody: true,
          bodyKind: 'full' as const,
        },
      ]
    : blogResult.sources;
  /**
   * ⚠️ 순수 함수라도 감싼다 — 정규식·본문 형태 때문에 던질 여지가 있고, 여기서 던지면
   *    나머지 세 축을 다 측정해 놓고 진단 전체가 실패한다(팔로워까지 함께).
   */
  let compliance = EMPTY_COMPLIANCE_AXIS;
  if (sources.length > 0) {
    try {
      compliance = buildComplianceAxis(sources, checkCompliance);
    } catch (error: unknown) {
      logAxisFailure('compliance', error);
    }
  }

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
