import { htmlToText, extractLogNo } from './naver-blog-fetch.ts';
import { BLOG_CHECK_ID_PATTERN } from './blog-check-input.ts';

/**
 * 네이버 블로그 무료진단 — RSS 수집·파싱 + 최신 글 본문 수집.
 *
 * naver-blog-fetch.ts(VOICE-DNA 수집기)와 달리 진단에는 발행일·카테고리가
 * 필요하므로 <pubDate>·<category>·채널 <title>(블로그명)까지 파싱한다.
 * 파싱은 순수 함수로 분리해 단위테스트하고, fetch 는 그레이스풀(절대 throw 금지).
 *
 * SSRF: fetch URL 은 고정 호스트(rss.blog.naver.com / m.blog.naver.com)에
 * 검증된 blogId 만 끼워 조립한다 (blog-check-input.ts 참조).
 */

/** RSS/본문 fetch 1건당 타임아웃(ms). */
export const BLOG_CHECK_FETCH_TIMEOUT_MS = 10_000;
/** 진단에 사용하는 최근 글 수 상한. */
export const BLOG_CHECK_POST_LIMIT = 50;
/** 본문 수집 편수(최신 글부터). 실패해도 진단은 계속 진행. */
export const BLOG_CHECK_BODY_LIMIT = 2;
/** 본문 1편당 수집 길이 상한(자) — 컴플라이언스 검사·문체 프리뷰용. */
export const BLOG_CHECK_BODY_MAX_CHARS = 6000;

/** 모바일 본문 수집용 UA — m.blog.naver.com 은 모바일 UA 에서 본문을 내려준다. */
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 DoctorPostBlogCheck/1.0';

export interface BlogCheckRssItem {
  title: string;
  link: string;
  /** 글 번호(모바일 본문 URL 조립용). 추출 실패 시 null. */
  logNo: string | null;
  /** 발행일 ISO 문자열. 파싱 실패 시 null. */
  publishedAt: string | null;
  category: string;
}

export interface BlogCheckFeed {
  /** 블로그명(채널 title) — 병원명 추정에 사용. */
  blogTitle: string;
  items: BlogCheckRssItem[];
}

function unwrapCdata(text: string): string {
  const m = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : text;
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function pickTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeBasicEntities(unwrapCdata(m[1]).trim()) : '';
}

/** pubDate(RFC 822 등)를 ISO 문자열로. 파싱 불가면 null. */
export function parsePubDate(raw: string): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

/**
 * RSS XML 을 진단용 피드로 파싱한다 (순수 함수).
 * item 이 하나도 없으면 items: [] — 호출부가 "글 없음"으로 처리.
 */
export function parseBlogCheckFeed(xml: string, limit: number = BLOG_CHECK_POST_LIMIT): BlogCheckFeed {
  if (typeof xml !== 'string' || xml === '') return { blogTitle: '', items: [] };

  // 채널 title — 첫 <item> 이전 구간에서 찾는다 (item 의 title 과 혼동 방지)
  const firstItemIdx = xml.search(/<item\b/i);
  const head = firstItemIdx === -1 ? xml : xml.slice(0, firstItemIdx);
  const blogTitle = pickTag(head, 'title');

  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const items: BlogCheckRssItem[] = [];
  for (const block of blocks.slice(0, Math.max(0, limit))) {
    const title = pickTag(block, 'title');
    const link = pickTag(block, 'link');
    items.push({
      title,
      link,
      logNo: extractLogNo(link),
      publishedAt: parsePubDate(pickTag(block, 'pubDate')),
      category: pickTag(block, 'category'),
    });
  }
  return { blogTitle, items };
}

/** 타임아웃 걸린 텍스트 fetch. 실패·비 2xx·타임아웃 전부 null (never throws). */
async function safeFetchText(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers, cache: 'no-store' });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type BlogCheckRssResult =
  | { ok: true; feed: BlogCheckFeed }
  | { ok: false; reason: 'invalid_id' | 'fetch_failed' | 'empty' };

/**
 * RSS 를 수집·파싱한다. 실패 사유를 구분해 반환(그레이스풀).
 * - fetch_failed: 존재하지 않는 블로그이거나 RSS 비공개(비공개 블로그) 포함
 * - empty: RSS 는 있으나 발행 글이 없음
 */
export async function fetchBlogCheckFeed(
  blogId: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<BlogCheckRssResult> {
  if (!BLOG_CHECK_ID_PATTERN.test(blogId)) return { ok: false, reason: 'invalid_id' };
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? BLOG_CHECK_FETCH_TIMEOUT_MS;

  const xml = await safeFetchText(
    fetchImpl,
    `https://rss.blog.naver.com/${blogId}.xml`,
    { Accept: 'application/xml,text/xml,*/*' },
    timeoutMs,
  );
  if (!xml) return { ok: false, reason: 'fetch_failed' };

  const feed = parseBlogCheckFeed(xml);
  if (feed.items.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, feed };
}

export interface BlogCheckBody {
  title: string;
  link: string;
  body: string;
}

/** 모바일 본문 HTML 에서 se-main-container 영역 텍스트를 추출 (순수 함수). */
export function extractMobileBody(html: string, maxChars: number = BLOG_CHECK_BODY_MAX_CHARS): string {
  if (typeof html !== 'string' || html === '') return '';
  const container = html.match(
    /<div[^>]*class="[^"]*se-main-container[^"]*"[\s\S]*?<\/div>\s*<\/div>/i,
  );
  return htmlToText(container ? container[0] : html).slice(0, Math.max(0, maxChars)).trim();
}

/**
 * 최신 글 본문을 모바일 UA 로 수집한다(기본 2편). 전부 실패해도 빈 배열(그레이스풀)
 * — 본문 없이도 제목 기반 진단은 계속 진행한다.
 */
export async function fetchLatestBodies(
  blogId: string,
  items: readonly BlogCheckRssItem[],
  options: { fetchImpl?: typeof fetch; limit?: number; timeoutMs?: number } = {},
): Promise<BlogCheckBody[]> {
  if (!BLOG_CHECK_ID_PATTERN.test(blogId)) return [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? BLOG_CHECK_FETCH_TIMEOUT_MS;
  const limit = Math.max(0, Math.min(options.limit ?? BLOG_CHECK_BODY_LIMIT, 5));

  const out: BlogCheckBody[] = [];
  for (const item of items) {
    if (out.length >= limit) break;
    if (!item.logNo) continue;
    const html = await safeFetchText(
      fetchImpl,
      `https://m.blog.naver.com/${blogId}/${item.logNo}`,
      { 'User-Agent': MOBILE_USER_AGENT, Accept: 'text/html,*/*' },
      timeoutMs,
    );
    if (!html) continue;
    const body = extractMobileBody(html);
    if (body.replace(/\s/g, '').length >= 60) {
      out.push({ title: item.title, link: item.link, body });
    }
  }
  return out;
}
