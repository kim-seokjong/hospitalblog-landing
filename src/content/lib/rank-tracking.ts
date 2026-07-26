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
  /** 글 제목 (item.title, HTML 태그 제거본). 같은 블로그 내 글 구분에 쓴다. */
  title?: string;
}

export interface RankMatchOptions {
  /** 사용자 네이버 블로그 ID (link/bloggername 매칭용) */
  blogId?: string;
  /** 발행된 글의 정확한 URL (가장 신뢰도 높은 매칭) */
  publishedUrl?: string;
  /**
   * 우리 DB 의 글 제목. 같은 블로그·같은 키워드 글이 여러 편일 때
   * "어느 글이 이 순위인지" 를 가르는 유일한 단서다.
   * (없으면 blogId 첫 히트를 모든 글에 똑같이 부여하는 오류가 난다)
   */
  title?: string;
  /**
   * 이 결과 배열이 전체 검색결과에서 시작하는 0-base 오프셋.
   * 페이지 순회(start=1,101,201...) 시 2페이지의 1번째 항목이 101위가 되도록 한다.
   */
  startOffset?: number;
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

/** 제목 비교용 정규화: HTML 태그·문장부호·공백 제거 후 소문자. */
function normTitle(value: unknown): string {
  return norm(value)
    .replace(/<[^>]+>/g, '')
    .replace(/[^0-9a-z가-힣]/g, '');
}

/**
 * 두 제목의 유사도 (0~1). bigram Dice 계수 — 외부 의존성 없이 부분 일치를 다룬다.
 * 네이버가 돌려주는 제목은 우리 DB 제목과 완전히 같지 않을 수 있어(말줄임·특수문자
 * 치환) 완전일치만으로는 매칭이 실패한다.
 */
export function titleSimilarity(a: unknown, b: unknown): number {
  const x = normTitle(a);
  const y = normTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // 한쪽이 다른 쪽을 통째로 포함(말줄임·접두 일치)하면 강한 신호
  if (x.length >= 8 && y.length >= 8 && (x.includes(y) || y.includes(x))) return 1;
  if (x.length < 2 || y.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const left = bigrams.get(g) ?? 0;
    if (left > 0) {
      bigrams.set(g, left - 1);
      hits++;
    }
  }
  return (2 * hits) / (x.length - 1 + (y.length - 1));
}

/** 제목이 "같은 글"이라고 볼 최소 유사도. */
export const TITLE_MATCH_THRESHOLD = 0.6;

/** 매칭 근거 — 신뢰도 순 (url > title > blog). */
export type RankMatchKind = 'url' | 'title' | 'blog';

export interface RankMatch {
  /** 1-base 순위 (startOffset 반영) */
  rank: number;
  matchedBy: RankMatchKind;
  /** 매칭된 검색결과의 link — published_url 백필에 쓴다 */
  link: string;
}

/**
 * 매칭 결과.
 *  - found      : 순위 확정
 *  - ambiguous  : 내 블로그 글은 여럿 잡혔는데 어느 것이 이 글인지 특정 불가
 *                 (제목 단서가 없거나 어느 것도 임계 미달) → "미발견"으로 기록하면 거짓말이 된다
 *  - 그 외      : 이 결과범위에서 미발견
 */
export type RankMatchOutcome =
  | { found: true; match: RankMatch }
  | { found: false; ambiguous: boolean };

/**
 * 검색결과 배열에서 사용자 글의 위치를 찾는다.
 *
 * 매칭 우선순위:
 *   1) publishedUrl 정확/부분 일치 — 가장 신뢰. 즉시 확정.
 *   2) blogId 히트 중 제목 유사도가 임계 이상인 것 (여럿이면 최고점, 동점이면 앞선 위치)
 *   3) blogId 히트가 정확히 1건뿐이면 그것 (후보가 하나뿐이라 모호하지 않다)
 *
 * ★ blogId 히트가 2건 이상인데 제목으로 못 가르면 ambiguous 다.
 *   예전 로직은 이때 "첫 히트"를 돌려줘, 같은 키워드로 쓴 글 여러 편에
 *   모두 같은 순위를 부여하는 오류를 냈다.
 *
 * 결과 배열은 관련도순(sim)으로 정렬돼 있다고 가정한다.
 */
export function findPostRank(
  results: readonly BlogSearchResult[] | null | undefined,
  opts: RankMatchOptions = {},
): RankMatchOutcome {
  const notFound: RankMatchOutcome = { found: false, ambiguous: false };
  if (!Array.isArray(results) || results.length === 0) return notFound;

  const blogId = norm(opts.blogId);
  const publishedUrl = norm(opts.publishedUrl);
  if (!blogId && !publishedUrl) return notFound;

  const offset =
    typeof opts.startOffset === 'number' && Number.isFinite(opts.startOffset) && opts.startOffset > 0
      ? Math.floor(opts.startOffset)
      : 0;
  const hasTitle = typeof opts.title === 'string' && normTitle(opts.title).length > 0;

  const blogHits: Array<{ rank: number; link: string; score: number }> = [];

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    if (!item || typeof item !== 'object') continue;
    const rawLink = typeof item.link === 'string' ? item.link : '';
    const link = norm(rawLink);
    const blogger = norm(item.bloggername);
    const rank = offset + i + 1;

    // 1) publishedUrl 일치 — 즉시 확정
    if (publishedUrl && link && urlMatches(link, publishedUrl)) {
      return { found: true, match: { rank, matchedBy: 'url', link: rawLink } };
    }

    if (!blogId) continue;

    const isMine =
      // link 에서 추출한 blogId 정확 일치 (경계 매칭 — happyclinic2 오탐 방지)
      (link !== '' && extractBlogId(link) === blogId) ||
      // PostView.nhn?blogId=... 쿼리스트링 형태
      (link !== '' && link.includes(`blogid=${blogId}&`)) ||
      // bloggername 일치
      (blogger !== '' && blogger === blogId);

    if (isMine) {
      blogHits.push({
        rank,
        link: rawLink,
        score: hasTitle ? titleSimilarity(item.title, opts.title) : 0,
      });
    }
  }

  if (blogHits.length === 0) return notFound;

  // 2) 제목으로 특정 — 임계 이상 중 최고점 (동점이면 앞선 위치)
  if (hasTitle) {
    const best = blogHits
      .filter((h) => h.score >= TITLE_MATCH_THRESHOLD)
      .sort((a, b) => (b.score - a.score) || (a.rank - b.rank))[0];
    if (best) {
      return { found: true, match: { rank: best.rank, matchedBy: 'title', link: best.link } };
    }
  }

  // 3) 후보가 하나뿐이면 그것으로 확정 (모호할 여지가 없다)
  if (blogHits.length === 1) {
    const only = blogHits[0];
    return { found: true, match: { rank: only.rank, matchedBy: 'blog', link: only.link } };
  }

  // 내 글이 여러 개 잡혔는데 특정 불가 → 모호. "미발견"과 구분해서 보고한다.
  return { found: false, ambiguous: true };
}

/**
 * 하위호환 래퍼 — 순위 숫자만 필요할 때. 모호/미발견 모두 null.
 * 새 코드는 findPostRank 를 쓴다(모호 여부·매칭 근거·link 를 함께 준다).
 */
export function findRankInResults(
  results: readonly BlogSearchResult[] | null | undefined,
  opts: RankMatchOptions = {},
): number | null {
  const outcome = findPostRank(results, opts);
  return outcome.found ? outcome.match.rank : null;
}
