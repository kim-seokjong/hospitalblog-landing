/**
 * 병원 서브도메인 블로그 — 사이트맵 인덱스 생성 (순수 로직 모듈).
 *
 * 목적:
 *  검색엔진은 {slug}.hospitalblog.kr 서브도메인이 "존재한다"는 사실을 알 방법이
 *  없다(메인 사이트에서 링크하지 않고, 병원마다 손으로 서치콘솔에 제출할 수도 없다).
 *  메인 도메인에 "고객 블로그 sitemap.xml 목록"을 담은 사이트맵 인덱스를 두고
 *  그것 하나만 서치콘솔에 제출하면, 새 병원이 첫 글을 발행하는 순간 자동으로 편입된다.
 *
 * 설계 원칙:
 *  - 발행 글이 0편인 병원은 제외한다. 빈 사이트맵을 대량 제출하면 색인 품질 신호가
 *    나빠지고 서치콘솔에 "가져올 수 없음" 오류가 쌓인다.
 *  - 페이지네이션을 지원한다. 사이트맵 인덱스 1개는 최대 50,000개 sitemap 을 담을 수
 *    있고(sitemaps.org 프로토콜), 인덱스의 인덱스는 구글이 지원하지 않는다.
 *    → 페이지당 1,000개 · 최대 50페이지로 상한을 두어 프로토콜 한도 안에 머문다.
 *  - URL 조립·슬러그 검증은 호출부가 주입한다(buildLoc). 이 모듈은 값 import 가 없다.
 *
 * ⚠️ 러너 제약(slug.ts / auto-publish.ts 패턴): node --experimental-strip-types
 *    테스트 러너가 별칭·상대 경로 해석 없이 로드할 수 있도록 값 import 없이
 *    자립 모듈로 유지한다.
 */

/** 인덱스 1페이지에 담는 최대 sitemap 개수. */
export const SITEMAP_INDEX_PAGE_SIZE = 1000;

/**
 * 허용 최대 페이지 번호.
 * 1,000 × 50 = 50,000 = sitemaps.org 프로토콜의 인덱스당 sitemap 상한.
 */
export const SITEMAP_INDEX_MAX_PAGE = 50;

/** DB 에서 읽어온 병원별 발행 현황(집계 결과). */
export interface ClinicSitemapSource {
  /** profiles.site_slug */
  slug: string;
  /** published_to_site=true 글 수 (0 이면 인덱스에서 제외) */
  postCount: number;
  /** 가장 최근 발행 시각 ISO 문자열 (없으면 null → lastmod 생략) */
  lastPublishedAt: string | null;
}

/** 사이트맵 인덱스 1줄 — 자식 sitemap 의 절대 URL + 선택적 lastmod. */
export interface ClinicSitemapIndexEntry {
  loc: string;
  /** ISO 8601 문자열 또는 null(lastmod 생략) */
  lastModified: string | null;
}

/**
 * 슬러그 → 자식 sitemap 절대 URL. 슬러그가 유효하지 않으면 null 을 돌려주어
 * 해당 병원을 인덱스에서 제외한다(호출부가 validateSlug 로 판정).
 */
export type SitemapLocBuilder = (slug: string) => string | null;

/** XML 텍스트 이스케이프 (URL 은 슬러그 조합이라 실질 무해하지만 방어적으로). */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 파싱 가능한 날짜만 ISO 문자열로. 불가하면 null(lastmod 생략 — 오류보다 낫다). */
export function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * 집계 결과에서 인덱스에 넣을 항목만 골라낸다.
 *  - postCount <= 0 제외 (빈 사이트맵 제출 금지)
 *  - buildLoc 이 null 을 주는 슬러그 제외 (형식·예약어 위반 방어)
 *  - 같은 loc 중복 제거 (DB 유니크 인덱스가 있지만 방어적으로)
 *  - 입력 순서를 그대로 유지한다 (호출부가 site_slug 오름차순으로 페이지네이션)
 */
export function selectIndexableClinics(
  sources: ReadonlyArray<ClinicSitemapSource>,
  buildLoc: SitemapLocBuilder,
): ClinicSitemapIndexEntry[] {
  const seen = new Set<string>();
  return sources.reduce<ClinicSitemapIndexEntry[]>((acc, source) => {
    if (!source || typeof source.slug !== 'string') return acc;
    if (!Number.isFinite(source.postCount) || source.postCount <= 0) return acc;

    const loc = buildLoc(source.slug);
    if (!loc || seen.has(loc)) return acc;

    seen.add(loc);
    return [...acc, { loc, lastModified: toIsoOrNull(source.lastPublishedAt) }];
  }, []);
}

/**
 * 사이트맵 인덱스 XML 을 만든다.
 * 항목이 0개여도 well-formed 한 빈 <sitemapindex> 를 돌려준다 — 404/500 보다
 * 서치콘솔 상태가 안정적이고, 첫 병원이 발행하는 순간 자동으로 채워진다.
 */
export function buildSitemapIndexXml(
  entries: ReadonlyArray<ClinicSitemapIndexEntry>,
): string {
  const body = entries
    .map((entry) => {
      const lastmod = entry.lastModified
        ? `\n    <lastmod>${escapeXml(entry.lastModified)}</lastmod>`
        : '';
      return `  <sitemap>\n    <loc>${escapeXml(entry.loc)}</loc>${lastmod}\n  </sitemap>`;
    })
    .join('\n');

  const inner = body === '' ? '' : `\n${body}`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${inner}\n</sitemapindex>\n`;
}

/**
 * ?page= 쿼리 파싱. 1 기반, 범위를 벗어나면 1 로 클램프한다
 * (잘못된 값으로 500 을 내지 않고 항상 유효한 인덱스를 응답).
 */
export function parseSitemapPage(raw: string | null | undefined): number {
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, SITEMAP_INDEX_MAX_PAGE);
}

/** 0 기반 range 시작 인덱스 (Supabase .range(from, to) 용). */
export function sitemapPageRange(page: number): { from: number; to: number } {
  const safePage = page < 1 ? 1 : Math.min(page, SITEMAP_INDEX_MAX_PAGE);
  const from = (safePage - 1) * SITEMAP_INDEX_PAGE_SIZE;
  return { from, to: from + SITEMAP_INDEX_PAGE_SIZE - 1 };
}
