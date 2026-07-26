/**
 * 키워드 1개에 대한 순위 스캔 오케스트레이션 (페이지 순회 + 조기 종료).
 *
 * 페이지 호출은 주입(fetchPage)받아 순수하게 테스트 가능하게 둔다.
 * 매칭 자체는 rank-tracking.findPostRank 가 담당한다.
 *
 * ★ 이 모듈의 존재 이유는 세 가지다.
 *  1) 예전 구현은 display=100 한 번만 불러 "100위까지"만 봤다. start 를 쓰면
 *     1099위까지 볼 수 있는데도 그 밖은 전부 "미발견"으로 뭉갰다.
 *  2) 측정 실패(키 없음·429·타임아웃)와 미발견을 반드시 구분해서 올린다.
 *  3) 찾으면 즉시 멈춘다 — 상위 노출된 글일수록 호출을 적게 쓴다(1콜).
 *     비용은 "못 찾은 키워드"에만 쌓이는데, 깊이가 의미 있는 것도 딱 그 경우다.
 */

import {
  collectPageMatches,
  decideRank,
  hasUsableTitle,
  TITLE_CONFIDENT_SCORE,
  type BlogCandidate,
  type BlogSearchResult,
  type RankMatch,
  type RankMatchKind,
  type RankMatchOptions,
} from './rank-tracking.ts';

/** 측정 결과 상태 — DB post_rankings.status 와 1:1 대응. */
export type RankScanStatus =
  /** 순위 확정 */
  | 'ok'
  /** 정상 측정했고, 스캔 범위 안에 없음 ("N위 밖") */
  | 'not_found'
  /** 측정 자체를 못 함 (키 없음·쿼터·네트워크). ★ 미발견이 아니다 */
  | 'failed'
  /** 내 블로그 글이 여럿 잡혔으나 어느 글인지 특정 불가 */
  | 'ambiguous';

export interface RankScanOutcome {
  status: RankScanStatus;
  /** status==='ok' 일 때만 숫자 */
  rank: number | null;
  matchedBy: RankMatchKind | null;
  /** 매칭된 검색결과 URL — published_url 백필용 */
  matchedLink: string | null;
  /** 실제로 훑어본 깊이(위). "몇 위 밖"인지 정직하게 말하기 위해 저장한다 */
  scannedDepth: number;
  /** 이번 스캔이 쓴 API 호출 수 (캐시 히트는 호출부가 별도 계산) */
  pagesFetched: number;
  errorCode?: string;
  errorMessage?: string;
}

export type RankScanPageResult =
  | { ok: true; items: BlogSearchResult[] }
  | { ok: false; errorCode: string; message: string };

export interface RankPageRequest {
  keyword: string;
  /** 1-base 시작 위치 (네이버 start 파라미터) */
  start: number;
  display: number;
}

export type RankPageFetcher = (req: RankPageRequest) => Promise<RankScanPageResult>;

export interface RankScanOptions {
  keyword: string;
  /** 몇 위까지 볼 것인가 */
  depth: number;
  /** 페이지당 건수 (네이버 상한 100) */
  pageSize?: number;
  /** 매칭 단서 (blogId / publishedUrl / title) */
  match: Pick<RankMatchOptions, 'blogId' | 'publishedUrl' | 'title'>;
}

/**
 * ★ 호출 예산은 이 모듈이 관리하지 않는다.
 *   스캔은 어떤 페이지가 캐시 히트인지 알 수 없어서, 페이지 수를 세면
 *   실제 API 호출을 쓰지 않은 캐시 히트까지 예산으로 차감해 버린다.
 *   예산이 없으면 fetchPage 가 { ok:false, errorCode:'budget_exhausted' } 를 돌려주면 되고,
 *   그러면 스캔은 다른 실패와 동일하게 status='failed' 로 보고한다.
 *   (실제 호출 여부를 아는 쪽이 판단한다)
 */
export const BUDGET_EXHAUSTED = 'budget_exhausted';

/**
 * 스캔 가능한 최대 깊이 = 1000위.
 *
 * 네이버 API 는 start ≤ 1000, display ≤ 100 이라 이론상 1099위까지 닿는다(2026-07-26 실측).
 * 다만 1001~1099 를 보려면 마지막 페이지를 start=1000 으로 겹쳐 호출해야 하고,
 * 그 대가로 얻는 99칸은 실무적으로 무의미하다. 페이지 경계를 단순하게 유지한다.
 * ★ start=1001 을 요청하면 HTTP 400 (SE03) 이므로 이 상한은 반드시 지켜야 한다.
 */
export const MAX_SCAN_DEPTH = 1000;

/** 네이버 start 파라미터 최대값 — 초과 시 HTTP 400 SE03. */
export const NAVER_MAX_START = 1000;

/**
 * 키워드 1개의 순위를 depth 위까지 스캔한다.
 *
 * 판정 시점:
 *  - publishedUrl 정확 일치 또는 제목 완전 일치(score 1)를 만나면 즉시 확정하고 멈춘다.
 *    이 둘은 그 자체로 확정적이라 뒤를 더 봐도 뒤집히지 않는다.
 *  - 그 외에는 ★ 전체 깊이의 후보를 모두 모은 뒤 한 번만 판정한다.
 *    페이지 단위로 판정하면 두 가지가 깨진다.
 *      ① "후보가 1건뿐이니 이 글" → 뒤 페이지의 진짜 내 글을 놓친다
 *      ② 부분 일치(0.6)로 확정 → 뒤 페이지의 더 정확한 후보(0.95)를 놓치고,
 *         TITLE_MARGIN(1·2등 근소 판정)도 페이지 안에서만 적용돼 무의미해진다
 *
 * 페이지 실패 시:
 *  - 어떤 페이지든 실패하면 status='failed'. 앞 페이지를 정상 조회했더라도
 *    "뒤를 못 봤으니 없다"고 단정할 수 없기 때문이다 (조용한 오측정 방지).
 */
export async function scanKeywordRank(
  fetchPage: RankPageFetcher,
  options: RankScanOptions,
): Promise<RankScanOutcome> {
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize ?? 100), 1), 100);
  const requestedDepth = Math.max(Math.floor(options.depth), 1);
  const depth = Math.min(requestedDepth, MAX_SCAN_DEPTH);
  const hasTitle = hasUsableTitle(options.match.title);

  const base = (extra: Partial<RankScanOutcome>): RankScanOutcome => ({
    status: 'failed',
    rank: null,
    matchedBy: null,
    matchedLink: null,
    scannedDepth: 0,
    pagesFetched: 0,
    ...extra,
  });

  if (!options.match.blogId && !options.match.publishedUrl) {
    return base({ errorCode: 'no_match_key', errorMessage: '블로그 주소·발행 URL 이 없어 매칭 불가' });
  }

  const confirmed = (match: RankMatch, scanned: number, pages: number): RankScanOutcome => ({
    status: 'ok',
    rank: match.rank,
    matchedBy: match.matchedBy,
    matchedLink: match.link,
    scannedDepth: scanned,
    pagesFetched: pages,
  });

  let scanned = 0;
  let pagesFetched = 0;
  // 전체 깊이에 걸쳐 누적하는 후보들
  const allBlogCandidates: BlogCandidate[] = [];
  const allTitleCandidates: BlogCandidate[] = [];

  for (let start = 1; start <= depth && start <= NAVER_MAX_START; start += pageSize) {
    const display = Math.min(pageSize, depth - start + 1);
    const page = await fetchPage({ keyword: options.keyword, start, display });
    pagesFetched++;

    if (!page.ok) {
      // 예산 소진 포함 — 어떤 이유든 "뒤를 못 봤으니 없다"고 단정하지 않는다.
      return base({
        scannedDepth: scanned,
        pagesFetched: page.errorCode === BUDGET_EXHAUSTED ? pagesFetched - 1 : pagesFetched,
        errorCode: page.errorCode,
        errorMessage: page.message,
      });
    }

    const items = page.items;
    const matches = collectPageMatches(items, { ...options.match, startOffset: start - 1 });
    scanned += items.length;

    // 발행 URL 정확 일치 — 더 볼 것 없다
    if (matches.urlMatch) return confirmed(matches.urlMatch, scanned, pagesFetched);

    allBlogCandidates.push(...matches.blogCandidates);
    allTitleCandidates.push(...matches.titleCandidates);

    // ★ 제목 "완전 일치"(score 1)만 조기 확정한다.
    //   부분 일치(0.6~0.99)에서 멈추면 뒤 페이지에 있는 더 정확한 후보를 놓치고,
    //   그 잘못된 link 가 published_url 로 백필돼 오매칭이 영구 고착된다.
    //   실측상 우리 제목과 네이버 응답 제목은 그대로 일치해 대부분 여기서 끝난다(1콜).
    const perfect = matches.titleCandidates.find((c) => c.score >= TITLE_CONFIDENT_SCORE);
    if (perfect) {
      return confirmed(
        { rank: perfect.rank, matchedBy: 'title', link: perfect.link },
        scanned,
        pagesFetched,
      );
    }

    // 결과 소진 — 더 요청해도 빈 페이지다
    if (items.length < display) break;
  }

  // ★ 전체 깊이를 다 본 뒤 한 번만 판정한다
  const decided = decideRank(
    { urlMatch: null, titleCandidates: allTitleCandidates, blogCandidates: allBlogCandidates },
    { hasTitle },
  );
  if (decided.found) return confirmed(decided.match, scanned, pagesFetched);

  return {
    status: decided.ambiguous ? 'ambiguous' : 'not_found',
    rank: null,
    matchedBy: null,
    matchedLink: null,
    scannedDepth: scanned,
    pagesFetched,
  };
}
