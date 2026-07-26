import {
  htmlToText,
  extractLogNo,
  resolveSafeRedirect,
  MAX_REDIRECT_HOPS,
} from './naver-blog-fetch.ts';
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
/**
 * RSS <description> 에서 가져올 텍스트 상한(자).
 * 블로그 RSS 설정이 '부분'이면 400자쯤에서 잘려 오고, '전체'면 본문이 통째로 온다 —
 * 둘 다 그대로 담고 어느 쪽인지는 소비자가 길이로 판단한다.
 */
export const BLOG_CHECK_SUMMARY_MAX_CHARS = 6000;

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
  /**
   * RSS 가 준 글 내용(태그 제거 텍스트). 블로그 설정에 따라 앞부분 요약일 수도,
   * 본문 전문일 수도 있다 — 여기서 구분하지 않고 그대로 담는다.
   */
  summary: string;
  /** 글에 사진이 들어 있는가 (RSS 내용에 이미지가 딸려 오는지 기준). */
  hasImage: boolean;
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
    const description = pickTag(block, 'description');
    items.push({
      title,
      link,
      logNo: extractLogNo(link),
      publishedAt: parsePubDate(pickTag(block, 'pubDate')),
      category: pickTag(block, 'category'),
      summary: htmlToText(description).slice(0, BLOG_CHECK_SUMMARY_MAX_CHARS).trim(),
      hasImage: /<img\b/i.test(description),
    });
  }
  return { blogTitle, items };
}

/**
 * 타임아웃 걸린 텍스트 fetch. 실패·비 2xx·타임아웃 전부 null (never throws).
 * 리다이렉트는 자동 추적하지 않고(redirect:'manual') Location 이 허용 호스트일
 * 때만 최대 MAX_REDIRECT_HOPS 홉 수동 추적 — 고정 호스트 불변식 유지
 * (naver-blog-fetch.ts 의 resolveSafeRedirect 재사용).
 *
 * 타임아웃은 체인 전체(모든 홉 + 본문 수신)에 **단일 절대 데드라인** —
 * AbortController·타이머 1개를 홉들이 공유한다. 홉마다 리셋하면 최악
 * (홉수+1)×timeoutMs 까지 늘어나기 때문.
 */
async function safeFetchText(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const res = await fetchImpl(current, {
        signal: controller.signal,
        headers,
        cache: 'no-store',
        redirect: 'manual',
      });
      if (res.status >= 300 && res.status < 400) {
        const next = resolveSafeRedirect(current, res.headers.get('location'));
        if (!next) return null; // 허용 밖 리다이렉트 → 스킵
        current = next;
        continue;
      }
      if (!res.ok) return null;
      return await res.text();
    }
    return null; // 홉 초과
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

/**
 * 본문 영역(se-main-container)을 **여는 div 와 짝이 맞는 닫는 div 까지** 잘라낸다.
 *
 * ⚠️ 이전에는 정규식으로 `...</div></div>` 를 최소 매칭했는데, 스마트에디터 ONE
 *    본문은 문단마다 div 가 중첩돼 있어 **첫 문단 하나(20자쯤)에서 잘렸다.**
 *    그 결과 본문 길이 검사(60자)에 걸려 모든 글이 버려졌고, 의료광고법 본문
 *    검사가 사실상 제목만 보고 있었다(실측: 브이성형외과 본문 수집 0편).
 *    div 깊이를 세는 방식으로 바꿔야 실제 본문 전체가 나온다.
 *
 * 닫는 태그를 못 찾으면 null — 호출부가 원본 HTML 로 폴백한다.
 */
export function sliceMainContainer(html: string): string | null {
  const open = html.search(/<div[^>]*class="[^"]*se-main-container[^"]*"[^>]*>/i);
  if (open === -1) return null;

  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = open;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html)) !== null) {
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth <= 0) return html.slice(open, match.index + match[0].length);
    } else {
      depth += 1;
    }
  }
  return null;
}

/** 모바일 본문 HTML 에서 se-main-container 영역 텍스트를 추출 (순수 함수). */
export function extractMobileBody(html: string, maxChars: number = BLOG_CHECK_BODY_MAX_CHARS): string {
  if (typeof html !== 'string' || html === '') return '';
  const container = sliceMainContainer(html);
  return htmlToText(container ?? html).slice(0, Math.max(0, maxChars)).trim();
}

/**
 * 최신 글 본문을 모바일 UA 로 수집한다(기본 2편). 전부 실패해도 빈 배열(그레이스풀)
 * — 본문 없이도 제목 기반 진단은 계속 진행한다.
 *
 * deadline(절대 시각, epoch ms)을 주면 **수집 전체**가 그 시각을 넘지 않는다.
 * 편수를 늘려도 최악 소요가 (편수 × timeoutMs) 로 늘지 않게 하려는 장치다 —
 * 예산이 끝나면 그때까지 모은 것만 돌려준다(부분 성공 허용).
 */
export async function fetchLatestBodies(
  blogId: string,
  items: readonly BlogCheckRssItem[],
  options: { fetchImpl?: typeof fetch; limit?: number; timeoutMs?: number; deadline?: number } = {},
): Promise<BlogCheckBody[]> {
  if (!BLOG_CHECK_ID_PATTERN.test(blogId)) return [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? BLOG_CHECK_FETCH_TIMEOUT_MS;
  const limit = Math.max(0, Math.min(options.limit ?? BLOG_CHECK_BODY_LIMIT, 5));
  const deadline = options.deadline ?? null;

  const out: BlogCheckBody[] = [];
  for (const item of items) {
    if (out.length >= limit) break;
    if (!item.logNo) continue;
    const remaining = deadline === null ? timeoutMs : Math.min(timeoutMs, deadline - Date.now());
    if (remaining <= 0) break; // 예산 소진 — 남은 글은 포기한다
    const html = await safeFetchText(
      fetchImpl,
      `https://m.blog.naver.com/${blogId}/${item.logNo}`,
      { 'User-Agent': MOBILE_USER_AGENT, Accept: 'text/html,*/*' },
      remaining,
    );
    if (!html) continue;
    const body = extractMobileBody(html);
    if (body.replace(/\s/g, '').length >= 60) {
      out.push({ title: item.title, link: item.link, body });
    }
  }
  return out;
}
