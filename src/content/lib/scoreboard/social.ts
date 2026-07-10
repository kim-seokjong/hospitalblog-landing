import { BROWSER_UA, fetchWithTimeout, parseCount } from '@/content/lib/scoreboard/fetch-utils';

/**
 * 인스타그램/쓰레드 공개 지표 (베스트에포트).
 *
 * - 공개 프로필 페이지의 og:description / description 메타에서
 *   팔로워·게시물 수만 파싱한다. 로그인·비공식 API 사용 금지.
 * - SSRF 방어: 허용 호스트(instagram.com / threads.net) URL만 서버가 직접 조립.
 *   사용자 입력은 핸들 문자열뿐이며 정규식으로 검증한다.
 * - 실패 항목은 status:'unavailable' 로 반환 (페이지가 깨지지 않게).
 */

export type SocialPlatform = 'instagram' | 'threads';

export interface SocialHandleInput {
  platform: SocialPlatform;
  handle: string;
}

export interface SocialMetric {
  platform: SocialPlatform;
  handle: string;
  status: 'ok' | 'unavailable';
  followers: number | null;
  posts: number | null;
}

export const MAX_SOCIAL_HANDLES = 5;

/** 인스타/쓰레드 핸들 규칙: 영숫자·밑줄·마침표, 1~30자 */
const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;

export function sanitizeHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, '');
  return HANDLE_RE.test(handle) ? handle : null;
}

/** 허용 호스트만 사용해 서버가 URL 조립 (사용자 입력은 검증된 핸들뿐) */
function buildProfileUrl(platform: SocialPlatform, handle: string): string {
  if (platform === 'threads') {
    return `https://www.threads.net/@${handle}`;
  }
  return `https://www.instagram.com/${handle}/`;
}

/** HTML에서 og:description(우선) 또는 description 메타 content 추출 */
export function extractDescriptionMeta(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match && match[1].trim()) {
      return match[1]
        .replace(/&amp;/g, '&')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
    }
  }
  return null;
}

/**
 * 메타 설명에서 팔로워·게시물 수 파싱.
 * 예) "1,234 Followers, 56 Following, 78 Posts - ..." (영문)
 *     "팔로워 1,234명, 팔로잉 56명, 게시물 78개 - ..." (국문)
 */
export function parseSocialCounts(description: string): { followers: number | null; posts: number | null } {
  const followersEn = description.match(/([\d,.]+[KkMm]?)\s*Followers/i);
  const followersKo = description.match(/팔로워\s*([\d,.]+(?:만|천)?)\s*명?/);
  const postsEn = description.match(/([\d,.]+[KkMm]?)\s*Posts/i);
  const postsKo = description.match(/게시물\s*([\d,.]+(?:만|천)?)\s*개?/);

  return {
    followers: parseCount(followersEn?.[1] ?? followersKo?.[1] ?? null),
    posts: parseCount(postsEn?.[1] ?? postsKo?.[1] ?? null),
  };
}

/** 핸들 1건 조회 — 어떤 실패든 unavailable 로 강등. */
export async function fetchSocialMetric(input: SocialHandleInput): Promise<SocialMetric> {
  const unavailable: SocialMetric = {
    platform: input.platform,
    handle: input.handle,
    status: 'unavailable',
    followers: null,
    posts: null,
  };

  try {
    const res = await fetchWithTimeout(buildProfileUrl(input.platform, input.handle), {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      console.error(`[scoreboard/social] ${input.platform}/${input.handle} HTTP ${res.status}`);
      return unavailable;
    }
    const html = await res.text();
    const description = extractDescriptionMeta(html);
    if (!description) {
      console.error(`[scoreboard/social] ${input.platform}/${input.handle} 메타 없음 (로그인 벽 가능)`);
      return unavailable;
    }
    const { followers, posts } = parseSocialCounts(description);
    if (followers === null && posts === null) {
      console.error(`[scoreboard/social] ${input.platform}/${input.handle} 수치 파싱 실패`);
      return unavailable;
    }
    return { ...unavailable, status: 'ok', followers, posts };
  } catch (err) {
    console.error(
      `[scoreboard/social] ${input.platform}/${input.handle} 조회 실패:`,
      err instanceof Error ? err.message : err
    );
    return unavailable;
  }
}
