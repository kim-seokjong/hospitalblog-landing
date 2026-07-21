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
/** 수집 글 1편당 본문 길이 상한 기본값(문체 분석 토큰 보호). */
const POST_BODY_MAX_CHARS = 2000;
/** 본문 길이 상한 절대 최대치(소급 진단 등 옵션 지정 시에도 이 이상 불가). */
const POST_BODY_MAX_CHARS_CAP = 6000;
/** 본문으로 인정하는 최소 길이(공백 제거 후). 이보다 짧으면 제외. */
const MIN_BODY_CHARS = 60;
/** 수집 글 수 절대 상한(과도한 요청 방지) — 소급 진단(20편)까지 허용. */
const MAX_POSTS_HARD_CAP = 20;
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

/**
 * HTML/스크립트/스타일을 제거하고 사람이 읽는 본문 텍스트만 남긴다.
 * (블로그 무료진단 blog-check-rss.ts 에서 재사용하기 위해 export)
 */
export function htmlToText(html: string): string {
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

/** 리다이렉트 수동 추적 최대 홉 수. */
export const MAX_REDIRECT_HOPS = 3;

/** safeFetchText 가 허용하는 fetch 호스트 (리다이렉트 추적 포함 고정 불변식). */
const SAFE_FETCH_HOSTS = new Set(['rss.blog.naver.com', 'blog.naver.com', 'm.blog.naver.com']);

/** URL 이 https + 네이버 블로그 계열 고정 호스트인지 (리다이렉트 목적지 검증용). */
export function isAllowedNaverFetchUrl(url: string): boolean {
  if (typeof url !== 'string' || url === '') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && SAFE_FETCH_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * 3xx Location 헤더를 해석해 "추적해도 되는" 절대 URL 을 반환한다 (순수 함수).
 * 상대 경로는 현재 URL 기준으로 해석하며, 허용 판정(isAllowed)을 통과하지
 * 못하면 null — 리다이렉트가 고정 호스트 밖으로 나가는 것을 차단한다.
 */
export function resolveSafeRedirect(
  currentUrl: string,
  location: string | null,
  isAllowed: (url: string) => boolean = isAllowedNaverFetchUrl,
): string | null {
  if (!location) return null;
  let next: string;
  try {
    next = new URL(location, currentUrl).toString();
  } catch {
    return null;
  }
  return isAllowed(next) ? next : null;
}

/**
 * 타임아웃이 걸린 fetch. 실패·타임아웃 시 null(never throws).
 * 리다이렉트는 자동 추적하지 않고(redirect:'manual') Location 을 검증해
 * 허용 호스트일 때만 최대 MAX_REDIRECT_HOPS 홉까지 수동 추적한다 —
 * 리다이렉트로 고정 호스트 불변식이 깨지는 것을 방지.
 *
 * 타임아웃은 체인 전체(모든 홉 + 본문 수신)에 **단일 절대 데드라인** 으로 건다
 * (AbortController·타이머 1개). 홉마다 타이머를 리셋하면 최악의 경우
 * (홉수+1)×REQUEST_TIMEOUT_MS 까지 늘어나기 때문.
 */
async function safeFetchText(url: string, deadline: number): Promise<string | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, remaining));
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const res = await fetch(current, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xml,text/xml,*/*' },
        cache: 'no-store',
        redirect: 'manual',
      });
      if (res.status >= 300 && res.status < 400) {
        const next = resolveSafeRedirect(current, res.headers.get('location'));
        if (!next) return null; // 허용 밖 리다이렉트 → 해당 항목 스킵
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
    clearTimeout(timeout);
  }
}

interface RssItem {
  title: string;
  link: string;
  description: string;
}

/** RSS XML 문자열에서 item(title, link, description)들을 파싱한다. */
function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi);
  if (!itemBlocks) return items;
  for (const block of itemBlocks) {
    const titleMatch = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const descMatch = block.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i);
    const title = titleMatch ? decodeEntities(unwrapCdata(titleMatch[1]).trim()) : '';
    const link = linkMatch ? unwrapCdata(linkMatch[1]).trim() : '';
    const description = descMatch ? unwrapCdata(descMatch[1]).trim() : '';
    items.push({ title, link, description });
  }
  return items;
}

/**
 * item.link 또는 본문에서 logNo(글 번호)를 뽑는다.
 * (블로그 무료진단 blog-check-rss.ts 에서 재사용하기 위해 export)
 */
export function extractLogNo(link: string): string | null {
  const byPath = link.match(/\/(\d{6,})(?:[/?#]|$)/);
  if (byPath?.[1]) return byPath[1];
  const byQuery = link.match(/[?&]logno=(\d+)/i);
  if (byQuery?.[1]) return byQuery[1];
  return null;
}

/**
 * RSS item.link 를 본문 fetch 폴백으로 써도 되는지 검증한다 (고정 호스트 불변식).
 * https + blog.naver.com/m.blog.naver.com 일 때만 허용 — RSS 에 임의 URL 이
 * 섞여도 외부 호스트로 fetch 가 나가지 않는다. 그 외에는 해당 항목을 건너뛴다.
 */
export function isAllowedNaverPostUrl(link: string): boolean {
  if (typeof link !== 'string' || link === '') return false;
  try {
    const url = new URL(link);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'blog.naver.com' || url.hostname === 'm.blog.naver.com')
    );
  } catch {
    return false;
  }
}

/** 수집된 글 1편 — 제목·링크 포함(소급 진단 카드 표시용). */
export interface NaverBlogPostItem {
  title: string;
  link: string;
  body: string;
}

/** 상세 수집 옵션 — 미지정 시 VOICE-DNA 기본값(8편·2000자)과 동일하게 동작. */
export interface NaverBlogFetchOptions {
  /** 수집 글 수 상한(기본 8, 하드캡 20). */
  limit?: number;
  /** 글 1편당 본문 길이 상한(기본 2000자, 최대 6000자). */
  bodyMaxChars?: number;
}

/**
 * 네이버 블로그 최근 글을 제목·링크·본문과 함께 수집한다.
 *
 * 1) RSS(`https://rss.blog.naver.com/{blogId}.xml`) fetch → item 파싱
 * 2) description(본문 일부)이 충분하면 그대로 사용
 * 3) 부족하면 모바일 PostView를 fetch해 본문 텍스트 추출
 * 각 본문은 bodyMaxChars 상한, 최소 길이 미달은 제외. 최대 limit편(하드캡 20).
 *
 * 실패·타임아웃·빈 결과 시 빈 배열(never throws).
 */
export async function fetchNaverBlogPostItems(
  blogId: string,
  options: NaverBlogFetchOptions = {},
): Promise<NaverBlogPostItem[]> {
  if (typeof blogId !== 'string' || !/^[a-z0-9_-]{3,20}$/.test(blogId)) return [];
  const cap = Math.max(1, Math.min(options.limit ?? 8, MAX_POSTS_HARD_CAP));
  const bodyMaxChars = Math.max(
    MIN_BODY_CHARS,
    Math.min(options.bodyMaxChars ?? POST_BODY_MAX_CHARS, POST_BODY_MAX_CHARS_CAP),
  );
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  const rssXml = await safeFetchText(`https://rss.blog.naver.com/${blogId}.xml`, deadline);
  if (!rssXml) return [];

  const items = parseRssItems(rssXml).slice(0, cap);
  if (items.length === 0) return [];

  const results: NaverBlogPostItem[] = [];
  for (const item of items) {
    if (Date.now() >= deadline) break;
    if (results.length >= cap) break;

    // 1) description 우선
    let text = htmlToText(item.description);

    // 2) 부족하면 PostView 본문 시도
    if (text.replace(/\s/g, '').length < MIN_BODY_CHARS) {
      const logNo = extractLogNo(item.link);
      // logNo 가 있으면 고정 호스트로 조립. 없으면 item.link 폴백을 쓰되,
      // https + 네이버 블로그 호스트일 때만 허용(아니면 이 항목은 본문 수집 스킵).
      const postUrl = logNo
        ? `https://m.blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`
        : isAllowedNaverPostUrl(item.link)
          ? item.link
          : null;
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

    const cleaned = text.slice(0, bodyMaxChars).trim();
    if (cleaned.replace(/\s/g, '').length >= MIN_BODY_CHARS) {
      results.push({ title: item.title, link: item.link, body: cleaned });
    }
  }

  return results;
}

/**
 * 네이버 블로그 최근 글 본문 텍스트만 수집한다 — VOICE-DNA 문체 학습용.
 * (fetchNaverBlogPostItems 의 얇은 래퍼. 기본값 8편·2000자로 기존 동작 불변.)
 *
 * @param blogId 네이버 블로그 ID
 * @param limit 수집 상한(기본 8)
 */
export async function fetchNaverBlogPosts(blogId: string, limit = 8): Promise<string[]> {
  const items = await fetchNaverBlogPostItems(blogId, {
    limit,
    bodyMaxChars: POST_BODY_MAX_CHARS,
  });
  return items.map((item) => item.body);
}
