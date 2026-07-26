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

/**
 * 네이버 블로그 글 URL을 (blogId, logNo)로 분해한다. 글 식별이 불가하면 null.
 *
 *  - https://blog.naver.com/{blogId}/{logNo}
 *  - https://m.blog.naver.com/{blogId}/{logNo}
 *  - .../PostView.naver?blogId={blogId}&logNo={logNo}
 *  - https://{blogId}.blog.me/{logNo}
 *
 * ★ 글 번호(logNo)까지 봐야 한다. 예전에는 문자열 부분일치로 비교해서
 *   ".../happyclinic/123" 과 ".../happyclinic/1234" 가 같은 글로 판정됐고,
 *   블로그 홈 주소는 그 블로그의 모든 글과 일치해 버렸다.
 */
export function parseNaverPostUrl(rawUrl: unknown): { blogId: string; logNo: string } | null {
  const url = norm(rawUrl);
  if (!url) return null;

  // 쿼리형: blogId= & logNo=
  const qBlog = url.match(/[?&]blogid=([a-z0-9_-]+)/);
  const qLog = url.match(/[?&]logno=(\d+)/);
  if (qBlog?.[1] && qLog?.[1]) return { blogId: qBlog[1], logNo: qLog[1] };

  // {blogId}.blog.me/{logNo}
  const blogMe = url.match(/^(?:https?:\/\/)?([a-z0-9_-]+)\.blog\.me\/(\d+)/);
  if (blogMe?.[1] && blogMe[2]) return { blogId: blogMe[1], logNo: blogMe[2] };

  // (m.)blog.naver.com/{blogId}/{logNo}
  const path = url.match(/(?:^|\/\/)(?:m\.)?blog\.naver\.com\/([a-z0-9_-]+)\/(\d+)/);
  if (path?.[1] && path[2]) return { blogId: path[1], logNo: path[2] };

  return null;
}

/**
 * 두 URL이 "같은 글"을 가리키는지 판단한다.
 * 양쪽 모두에서 (blogId, logNo)를 뽑아 정확히 비교한다.
 * 한쪽이라도 글 번호를 못 뽑으면(예: 블로그 홈 주소) 일치로 보지 않는다.
 */
function urlMatches(resultLink: string, publishedUrl: string): boolean {
  const a = parseNaverPostUrl(resultLink);
  const b = parseNaverPostUrl(publishedUrl);
  if (!a || !b) return false;
  return a.blogId === b.blogId && a.logNo === b.logNo;
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

/**
 * 1등과 2등 제목 점수가 이 폭 안으로 붙어 있으면 특정하지 않는다.
 * 병원 글은 제목 형식이 비슷해("○○치과 신경치료 …") 근소한 차이로 엉뚱한 글을 고를 수 있다.
 */
export const TITLE_MARGIN = 0.05;

/** 매칭 근거 — 신뢰도 순 (url > title > blog). */
export type RankMatchKind = 'url' | 'title' | 'blog';

export interface RankMatch {
  /** 1-base 순위 (startOffset 반영) */
  rank: number;
  matchedBy: RankMatchKind;
  /** 매칭된 검색결과의 link — published_url 백필에 쓴다 */
  link: string;
}

/** 내 블로그로 판정된 검색결과 1건. */
export interface BlogCandidate {
  rank: number;
  link: string;
  /** 제목 단서가 있을 때의 유사도 (0~1). 단서가 없으면 0 */
  score: number;
}

/**
 * 한 페이지에서 뽑은 후보들 (판정은 하지 않는다).
 *
 * ★ 판정을 페이지 단위로 내리면 안 된다. 1페이지에 내 블로그 글이 1건뿐이라고
 *   확정해 버리면, 2페이지에 있는 진짜 내 글을 영영 못 본다.
 *   호출부(rank-scan)가 전체 깊이의 후보를 모은 뒤 한 번만 판정한다.
 */
export interface PageMatches {
  /** publishedUrl 이 정확히 일치한 결과 — 가장 신뢰. 있으면 즉시 확정해도 된다 */
  urlMatch: RankMatch | null;
  /** 제목 유사도가 임계 이상인 후보들 (점수 내림차순) */
  titleCandidates: BlogCandidate[];
  /** 내 블로그로 판정된 모든 후보 (제목 점수 무관) */
  blogCandidates: BlogCandidate[];
}

/**
 * 검색결과 한 페이지에서 후보를 수집한다 (판정 없음, 순수).
 *
 * "내 블로그" 판정 근거:
 *   1) link 에서 파싱한 blogId 일치 (경계 매칭 — happyclinic2 오탐 방지)
 *   2) link 를 전혀 파싱할 수 없을 때에 한해 bloggername 일치
 *      ★ bloggername 은 블로그 ID 가 아니라 표시용 별명이라 오탐 가능성이 있다.
 *        link 로 판별되는 정상 응답에서는 쓰지 않는다.
 */
export function collectPageMatches(
  results: readonly BlogSearchResult[] | null | undefined,
  opts: RankMatchOptions = {},
): PageMatches {
  const empty: PageMatches = { urlMatch: null, titleCandidates: [], blogCandidates: [] };
  if (!Array.isArray(results) || results.length === 0) return empty;

  const blogId = norm(opts.blogId);
  const publishedUrl = norm(opts.publishedUrl);
  if (!blogId && !publishedUrl) return empty;

  const offset =
    typeof opts.startOffset === 'number' && Number.isFinite(opts.startOffset) && opts.startOffset > 0
      ? Math.floor(opts.startOffset)
      : 0;
  const hasTitle = typeof opts.title === 'string' && normTitle(opts.title).length > 0;

  let urlMatch: RankMatch | null = null;
  const blogCandidates: BlogCandidate[] = [];

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    if (!item || typeof item !== 'object') continue;
    const rawLink = typeof item.link === 'string' ? item.link : '';
    const link = norm(rawLink);
    const rank = offset + i + 1;

    if (publishedUrl && link && urlMatch === null && urlMatches(link, publishedUrl)) {
      urlMatch = { rank, matchedBy: 'url', link: rawLink };
      continue;
    }

    if (!blogId) continue;

    const parsed = parseNaverPostUrl(link);
    const linkBlogId = parsed?.blogId ?? extractBlogId(link);
    const isMine = linkBlogId
      ? linkBlogId === blogId
      : norm(item.bloggername) === blogId && norm(item.bloggername) !== '';

    if (isMine) {
      blogCandidates.push({
        rank,
        link: rawLink,
        score: hasTitle ? titleSimilarity(item.title, opts.title) : 0,
      });
    }
  }

  const titleCandidates = hasTitle
    ? blogCandidates
        .filter((c) => c.score >= TITLE_MATCH_THRESHOLD)
        .sort((a, b) => (b.score - a.score) || (a.rank - b.rank))
    : [];

  return { urlMatch, titleCandidates, blogCandidates };
}

/**
 * 매칭 결과.
 *  - found      : 순위 확정
 *  - ambiguous  : 내 블로그 글은 잡혔는데 어느 것이 이 글인지 특정 불가
 *                 → "미발견"으로 기록하면 거짓말이 된다
 */
export type RankMatchOutcome =
  | { found: true; match: RankMatch }
  | { found: false; ambiguous: boolean };

/**
 * 모아둔 후보로 최종 판정한다 (순수).
 *
 * ★ 제목 단서가 있는데 임계를 넘는 후보가 없으면 "미발견"이다.
 *   예전 로직은 이때 "내 블로그 글이 1건뿐이면 그것" 으로 확정해서,
 *   색인되지 않은 글 A 가 같은 블로그의 다른 글 B 의 순위를 가져가는 오류를 냈다.
 *   제목 단서가 아예 없을 때만 blogId 단독 판정을 허용한다.
 */
export function decideRank(
  matches: Pick<PageMatches, 'urlMatch' | 'titleCandidates' | 'blogCandidates'>,
  opts: { hasTitle: boolean },
): RankMatchOutcome {
  if (matches.urlMatch) return { found: true, match: matches.urlMatch };

  if (opts.hasTitle) {
    const [best, second] = matches.titleCandidates;
    if (!best) {
      // 내 블로그 글은 보였지만 이 글은 아니다 → 미발견(모호 아님)
      return { found: false, ambiguous: false };
    }
    // 1·2등이 근소하면 특정하지 않는다 (제목이 비슷한 글 오매칭 방지)
    if (second && best.score - second.score < TITLE_MARGIN) {
      return { found: false, ambiguous: true };
    }
    return { found: true, match: { rank: best.rank, matchedBy: 'title', link: best.link } };
  }

  if (matches.blogCandidates.length === 1) {
    const only = matches.blogCandidates[0];
    return { found: true, match: { rank: only.rank, matchedBy: 'blog', link: only.link } };
  }
  if (matches.blogCandidates.length > 1) return { found: false, ambiguous: true };
  return { found: false, ambiguous: false };
}

/** 제목 단서가 유효한지 (decideRank 분기 기준과 동일하게 판단). */
export function hasUsableTitle(title: unknown): boolean {
  return typeof title === 'string' && normTitle(title).length > 0;
}

/**
 * 단일 페이지 편의 함수 — 수집 + 판정을 한 번에.
 * 여러 페이지를 순회할 때는 collectPageMatches + decideRank 를 직접 쓴다.
 */
export function findPostRank(
  results: readonly BlogSearchResult[] | null | undefined,
  opts: RankMatchOptions = {},
): RankMatchOutcome {
  const matches = collectPageMatches(results, opts);
  return decideRank(matches, { hasTitle: hasUsableTitle(opts.title) });
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
