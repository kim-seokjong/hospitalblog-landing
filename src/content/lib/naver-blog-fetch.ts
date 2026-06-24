/**
 * 네이버 블로그 RSS 수집 — VOICE-DNA 문체 학습용 본문 수집기.
 *
 * 사용자가 "본인" 병원 블로그 주소를 입력하면 RSS로 최근 글 본문 여러 편을 모아
 * 문체 분석(analyzeBlogSamples)에 넘긴다. 수집 텍스트는 문체 분석 용도로만 쓴다.
 *
 * 모든 함수는 graceful·방어적이다: 타임아웃·네트워크 실패·비정상 응답·빈 결과 시
 * 빈 배열을 반환하며 절대 throw 하지 않는다. 호출부(본인 블로그 검증·UX)와 분리.
 */

/** RSS/PostView fetch 1건당 타임아웃(ms). */
const REQUEST_TIMEOUT_MS = 12_000;
/** 전체 수집 작업 상한(ms) — 라우트 maxDuration 보호. */
const TOTAL_BUDGET_MS = 50_000;
/** 수집 글 1편당 본문 길이 상한(문체 분석 토큰 보호). */
const POST_BODY_MAX_CHARS = 2000;
/** 본문으로 인정하는 최소 길이(공백 제거 후). 이보다 짧으면 제외. */
const MIN_BODY_CHARS = 60;
/** 수집 글 수 절대 상한(과도한 요청 방지). */
const MAX_POSTS_HARD_CAP = 10;
/** fetch 시 보낼 User-Agent. */
const USER_AGENT =
  'Mozilla/5.0 (compatible; DoctorPostVoiceDNA/1.0; +https://hospitalblog.kr)';

/**
 * 입력에서 네이버 블로그 ID를 추출한다.
 *
 * 지원: blog.naver.com/{id}, m.blog.naver.com/{id}, https://..., {id}.blog.me,
 *       rss.blog.naver.com/{id}.xml, PostList/PostView 쿼리(blogId=), 순수 ID.
 * 유효성: 영문소문자·숫자·`_`·`-` 3~20자. 실패 시 null.
 */
export function parseNaverBlogId(input: string): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  const ID_PATTERN = /^[a-z0-9_-]{3,20}$/;
  const isValid = (candidate: string): string | null =>
    ID_PATTERN.test(candidate) ? candidate : null;

  // 0) rss.blog.naver.com/{id}.xml
  const byRss = raw.match(/rss\.blog\.naver\.com\/([a-z0-9_-]+)\.xml/);
  if (byRss?.[1]) return isValid(byRss[1]);

  // 1) 쿼리형 (PostList.naver?blogId=..., PostView.naver?blogId=...)
  const byQuery = raw.match(/[?&]blogid=([a-z0-9_-]+)/);
  if (byQuery?.[1]) return isValid(byQuery[1]);

  // 2) {id}.blog.me
  const byBlogMe = raw.match(/^(?:https?:\/\/)?([a-z0-9_-]+)\.blog\.me\b/);
  if (byBlogMe?.[1]) return isValid(byBlogMe[1]);

  // 3) (m.)blog.naver.com/{id}[/...]
  const byDomain = raw.match(/(?:^|\/\/)(?:m\.)?blog\.naver\.com\/([a-z0-9_-]+)/);
  if (byDomain?.[1]) return isValid(byDomain[1]);

  // 4) 다른 도메인/URL이면 거부
  if (raw.includes('/') || raw.includes('.') || raw.includes('?')) return null;

  // 5) 맨몸 ID
  return isValid(raw);
}

/** HTML 엔티티를 디코딩한다(주요 엔티티만). */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** HTML/스크립트/스타일을 제거하고 사람이 읽는 본문 텍스트만 남긴다. */
function htmlToText(html: string): string {
  if (typeof html !== 'string' || html === '') return '';
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // 블록 경계는 줄바꿈으로 보존(문장 흐름 유지)
    .replace(/<\/(p|div|br|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped)
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}

/** CDATA 래퍼를 벗긴다. */
function unwrapCdata(text: string): string {
  const m = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : text;
}

/** 타임아웃이 걸린 fetch. 실패·타임아웃 시 null(never throws). */
async function safeFetchText(url: string, deadline: number): Promise<string | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, remaining));
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xml,text/xml,*/*' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

interface RssItem {
  link: string;
  description: string;
}

/** RSS XML 문자열에서 item(link, description)들을 파싱한다. */
function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi);
  if (!itemBlocks) return items;
  for (const block of itemBlocks) {
    const linkMatch = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const descMatch = block.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i);
    const link = linkMatch ? unwrapCdata(linkMatch[1]).trim() : '';
    const description = descMatch ? unwrapCdata(descMatch[1]).trim() : '';
    items.push({ link, description });
  }
  return items;
}

/** item.link 또는 본문에서 logNo(글 번호)를 뽑는다. */
function extractLogNo(link: string): string | null {
  const byPath = link.match(/\/(\d{6,})(?:[/?#]|$)/);
  if (byPath?.[1]) return byPath[1];
  const byQuery = link.match(/[?&]logno=(\d+)/i);
  if (byQuery?.[1]) return byQuery[1];
  return null;
}

/**
 * 네이버 블로그 최근 글 본문 텍스트를 수집한다.
 *
 * 1) RSS(`https://rss.blog.naver.com/{blogId}.xml`) fetch → item 파싱
 * 2) description(본문 일부)이 충분하면 그대로 사용
 * 3) 부족하면 모바일 PostView를 fetch해 본문 텍스트 추출
 * 각 본문은 2000자 상한, 최소 길이 미달은 제외. 최대 limit편(하드캡 10).
 *
 * 실패·타임아웃·빈 결과 시 빈 배열(never throws).
 *
 * @param blogId 네이버 블로그 ID
 * @param limit 수집 상한(기본 8)
 */
export async function fetchNaverBlogPosts(blogId: string, limit = 8): Promise<string[]> {
  if (typeof blogId !== 'string' || !/^[a-z0-9_-]{3,20}$/.test(blogId)) return [];
  const cap = Math.max(1, Math.min(limit, MAX_POSTS_HARD_CAP));
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  const rssXml = await safeFetchText(`https://rss.blog.naver.com/${blogId}.xml`, deadline);
  if (!rssXml) return [];

  const items = parseRssItems(rssXml).slice(0, cap);
  if (items.length === 0) return [];

  const results: string[] = [];
  for (const item of items) {
    if (Date.now() >= deadline) break;
    if (results.length >= cap) break;

    // 1) description 우선
    let text = htmlToText(item.description);

    // 2) 부족하면 PostView 본문 시도
    if (text.replace(/\s/g, '').length < MIN_BODY_CHARS) {
      const logNo = extractLogNo(item.link);
      const postUrl = logNo
        ? `https://m.blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`
        : item.link;
      if (postUrl) {
        const html = await safeFetchText(postUrl, deadline);
        if (html) {
          // 네이버 본문 컨테이너(se-main-container) 우선, 없으면 전체 텍스트
          const container = html.match(
            /<div[^>]*class="[^"]*se-main-container[^"]*"[\s\S]*?<\/div>\s*<\/div>/i,
          );
          text = htmlToText(container ? container[0] : html);
        }
      }
    }

    const cleaned = text.slice(0, POST_BODY_MAX_CHARS).trim();
    if (cleaned.replace(/\s/g, '').length >= MIN_BODY_CHARS) {
      results.push(cleaned);
    }
  }

  return results;
}
