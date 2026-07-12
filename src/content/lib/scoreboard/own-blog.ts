import type { NaverPost } from '@/content/lib/competitor-analysis';
import {
  computePublishFrequency,
  type PublishFrequencyResult,
} from '@/content/lib/scoreboard/publish-frequency';
import { BROWSER_UA, fetchWithTimeout } from '@/content/lib/scoreboard/fetch-utils';

/**
 * 자사 네이버 블로그 발행 빈도 (베스트에포트).
 *
 * 경쟁 종합 비교의 발행 빈도(publish-frequency)는 네이버 블로그 "검색" 표본을 쓰지만,
 * 자사 블로그는 공개 RSS(`rss.blog.naver.com/{blogId}.xml`)로 최근 글의 발행일을 직접 모아
 * 동일한 computePublishFrequency 로 최근 30일 주당 발행 수를 계산한다.
 *
 * - 로그인·쿠키 불필요(공개 RSS). 자동발행 연동과 무관.
 * - SSRF 방어: blogId 정규식 검증 후 서버가 URL 을 고정 조립한다(사용자 입력 raw fetch 금지).
 * - 실패(차단·타임아웃·빈 결과) 시 null — 호출부는 '확인 불가'로 강등한다(never throws).
 */

/** 네이버 블로그 ID 규칙: 영문소문자·숫자·`_`·`-` 3~20자. */
const BLOG_ID_RE = /^[a-z0-9_-]{3,20}$/;

/** RSS <pubDate>(RFC822) → "YYYYMMDD". 파싱 실패 시 null. */
export function pubDateToYyyymmdd(pubDate: string): string | null {
  const t = Date.parse(pubDate.trim());
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/** CDATA 래퍼를 벗긴다. */
function unwrapCdata(text: string): string {
  const m = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return (m ? m[1] : text).trim();
}

/**
 * RSS XML 에서 발행일이 확인되는 글만 NaverPost 로 변환한다.
 * bloggername 은 blogId 로 고정(자사 블로그 단일 집계).
 * postdate 없는(파싱 실패) 항목은 제외한다.
 */
export function parseRssToPosts(xml: string, blogId: string): NaverPost[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi);
  if (!blocks) return [];

  const posts: NaverPost[] = [];
  for (const block of blocks) {
    const pubMatch = block.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i);
    if (!pubMatch) continue;
    const postdate = pubDateToYyyymmdd(unwrapCdata(pubMatch[1]));
    if (!postdate) continue;

    const titleMatch = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);

    posts.push({
      title: titleMatch ? unwrapCdata(titleMatch[1]) : '',
      description: '',
      link: linkMatch ? unwrapCdata(linkMatch[1]) : '',
      postdate,
      bloggername: blogId,
    });
  }
  return posts;
}

/**
 * 자사 블로그 RSS 를 조회해 최근 30일 발행 빈도를 계산한다.
 * @param blogId 네이버 블로그 ID (검증된 값)
 * @param now 기준 시각 (테스트 주입용)
 * @returns 발행 빈도 결과. blogId 형식 오류·조회 실패·빈 결과 시 null.
 */
export async function fetchOwnBlogFrequency(
  blogId: string,
  now: Date = new Date(),
): Promise<PublishFrequencyResult | null> {
  if (!BLOG_ID_RE.test(blogId)) return null;

  try {
    const res = await fetchWithTimeout(`https://rss.blog.naver.com/${blogId}.xml`, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/xml,text/xml,*/*',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      console.error(`[scoreboard/own-blog] ${blogId} RSS HTTP ${res.status}`);
      return null;
    }
    const xml = await res.text();
    const posts = parseRssToPosts(xml, blogId);
    if (posts.length === 0) {
      console.error(`[scoreboard/own-blog] ${blogId} RSS 항목 없음 (비공개 또는 구조 변경)`);
      return null;
    }
    return computePublishFrequency(posts, now);
  } catch (err) {
    console.error(
      `[scoreboard/own-blog] ${blogId} 조회 실패:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
