/**
 * 발행글 검색순위 추적 — 순수 로직 (외부 의존성 0).
 *
 * 네이버 블로그 검색결과(sort=sim, 관련도순) 배열에서 "내 글"의 위치를 찾는다.
 * 반환 순위는 정확한 웹 SERP 순위가 아니라 "추정 순위(블로그 검색 관련도 기준)"이다.
 *
 * 모든 함수는 순수·immutable 이며, 비정상 입력(undefined/빈배열/잘못된 타입)을 방어한다.
 */

/** 네이버 블로그 검색결과 1건 (순위 매칭에 필요한 최소 필드) */
export interface BlogSearchResult {
  /** 글 URL (item.link) */
  link: string;
  /** 블로거 이름/ID (item.bloggername 또는 bloggerlink 도메인) */
  bloggername: string;
}

export interface RankMatchOptions {
  /** 사용자 네이버 블로그 ID (link/bloggername 매칭용) */
  blogId?: string;
  /** 발행된 글의 정확한 URL (가장 신뢰도 높은 매칭) */
  publishedUrl?: string;
}

/** 문자열 정규화: 트림 + 소문자. 비문자열은 빈 문자열. */
function norm(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

/**
 * 네이버 블로그 URL에서 블로그 ID(경로 첫 세그먼트)를 추출한다.
 *  - https://blog.naver.com/{blogId}/{logNo}
 *  - https://{blogId}.blog.me/...
 * 추출 실패 시 빈 문자열.
 */
export function extractBlogId(rawUrl: string): string {
  const url = norm(rawUrl);
  if (!url) return '';

  // {blogId}.blog.me 형태
  const blogMe = url.match(/^https?:\/\/([a-z0-9_-]+)\.blog\.me/);
  if (blogMe?.[1]) return blogMe[1];

  // blog.naver.com/{blogId}
  const naver = url.match(/blog\.naver\.com\/([a-z0-9_-]+)/);
  if (naver?.[1]) return naver[1];

  return '';
}

/**
 * 사용자가 프로필에 입력한 "공개 블로그 주소"에서 네이버 블로그 ID를 추출한다.
 * 순위추적용(공개 검색)이라 로그인/쿠키가 전혀 불필요하며, 자동발행 연동과 무관하다.
 *
 * 허용 입력(모두 동일 ID로 정규화):
 *  - 맨몸 ID:                myclinic
 *  - 도메인 경로:            blog.naver.com/myclinic
 *  - 프로토콜 포함:          https://blog.naver.com/myclinic
 *  - 모바일:                 https://m.blog.naver.com/myclinic
 *  - 포스트 경로/끝슬래시:   blog.naver.com/myclinic/223456 , blog.naver.com/myclinic/
 *  - 쿼리형:                 blog.naver.com/PostList.naver?blogId=myclinic
 *  - {id}.blog.me:           https://myclinic.blog.me
 *  - 앞뒤 공백 허용
 *
 * 유효 ID 규칙: 네이버 블로그 ID 문자셋(영문소문자·숫자·`_`·`-`) 3~20자.
 * 그 외/빈값/타 도메인은 null. 결과는 소문자로 정규화.
 *
 * @param input 사용자 입력(주소 또는 ID)
 * @returns 추출된 블로그 ID(소문자) 또는 null
 */
export function extractNaverBlogId(input: unknown): string | null {
  const raw = norm(input); // 트림 + 소문자, 비문자열은 빈 문자열
  if (!raw) return null;

  const ID_PATTERN = /^[a-z0-9_-]{3,20}$/;
  const isValid = (candidate: string): string | null =>
    ID_PATTERN.test(candidate) ? candidate : null;

  // 1) 쿼리형 (PostList.naver?blogId=myclinic, PostView.nhn?blogId=...)
  const byQuery = raw.match(/[?&]blogid=([a-z0-9_-]+)/);
  if (byQuery?.[1]) return isValid(byQuery[1]);

  // 2) {id}.blog.me 형태
  const byBlogMe = raw.match(/^(?:https?:\/\/)?([a-z0-9_-]+)\.blog\.me\b/);
  if (byBlogMe?.[1]) return isValid(byBlogMe[1]);

  // 3) (m.)blog.naver.com/{id}[/...] — 경로 첫 세그먼트
  const byDomain = raw.match(/(?:^|\/\/)(?:m\.)?blog\.naver\.com\/([a-z0-9_-]+)/);
  if (byDomain?.[1]) return isValid(byDomain[1]);

  // 4) 다른 도메인/URL이면 거부 (`/` 또는 `.`이 있는데 위에서 안 잡혔으면 타 도메인)
  if (raw.includes('/') || raw.includes('.') || raw.includes('?')) return null;

  // 5) 맨몸 ID (myclinic)
  return isValid(raw);
}

/** 두 URL이 같은 글을 가리키는지(정확 또는 부분 일치) 판단. */
function urlMatches(resultLink: string, publishedUrl: string): boolean {
  const a = norm(resultLink);
  const b = norm(publishedUrl);
  if (!a || !b) return false;
  if (a === b) return true;
  // 프로토콜/모바일(m.) 차이를 흡수한 부분 일치
  const stripA = a.replace(/^https?:\/\/(m\.)?/, '');
  const stripB = b.replace(/^https?:\/\/(m\.)?/, '');
  if (!stripA || !stripB) return false;
  return stripA === stripB || stripA.includes(stripB) || stripB.includes(stripA);
}

/**
 * 검색결과 배열에서 사용자 글의 위치(1-base)를 찾는다.
 *
 * 매칭 우선순위(앞 결과가 더 신뢰도 높음 → 가장 먼저 매칭되는 결과의 위치 반환):
 *   1) publishedUrl 정확/부분 일치 (가장 신뢰)
 *   2) link 에 blogId 포함 (또는 link 에서 추출한 blogId 일치)
 *   3) bloggername 이 blogId 와 일치
 * 어느 것도 매칭되지 않으면 null.
 *
 * 결과 배열은 관련도순(sim)으로 정렬돼 있다고 가정한다.
 */
export function findRankInResults(
  results: readonly BlogSearchResult[] | null | undefined,
  opts: RankMatchOptions = {},
): number | null {
  if (!Array.isArray(results) || results.length === 0) return null;

  const blogId = norm(opts.blogId);
  const publishedUrl = norm(opts.publishedUrl);
  if (!blogId && !publishedUrl) return null;

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    if (!item || typeof item !== 'object') continue;
    const link = norm((item as BlogSearchResult).link);
    const blogger = norm((item as BlogSearchResult).bloggername);

    // 1) publishedUrl 일치
    if (publishedUrl && link && urlMatches(link, publishedUrl)) {
      return i + 1;
    }

    if (blogId) {
      // 2) link 에서 추출한 blogId 정확 일치 (경계 매칭 — happyclinic2 오탐 방지)
      if (link && extractBlogId(link) === blogId) {
        return i + 1;
      }
      // 2-b) PostView.nhn?blogId=... 쿼리스트링 형태도 매칭
      if (link && link.includes(`blogid=${blogId}&`)) {
        return i + 1;
      }
      // 3) bloggername 일치
      if (blogger && blogger === blogId) {
        return i + 1;
      }
    }
  }

  return null;
}
