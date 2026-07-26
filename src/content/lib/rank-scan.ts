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
  findPostRank,
  type BlogSearchResult,
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
  /**
   * 남은 호출 예산. 이 수보다 많은 페이지는 요청하지 않는다.
   * 예산이 0이면 아무 호출 없이 failed('budget_exhausted') 로 즉시 반환한다.
   */
  callBudget?: number;
}

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
  const budget = options.callBudget ?? Number.POSITIVE_INFINITY;

  const base = (extra: Partial<RankScanOutcome>): RankScanOutcome => ({
    status: 'failed',
    rank: null,
    matchedBy: null,
    matchedLink: null,
    scannedDepth: 0,
    pagesFetched: 0,
    ...extra,
  });

  if (budget <= 0) {
    return base({ errorCode: 'budget_exhausted', errorMessage: '이번 회차 호출 예산 소진' });
  }
  if (!options.match.blogId && !options.match.publishedUrl) {
    return base({ errorCode: 'no_match_key', errorMessage: '블로그 주소·발행 URL 이 없어 매칭 불가' });
  }

  let scanned = 0;
  let pagesFetched = 0;
  let sawAmbiguous = false;

  for (let start = 1; start <= depth && start <= NAVER_MAX_START; start += pageSize) {
    if (pagesFetched >= budget) {
      // 예산이 도중에 끊겼다 — 여기까지의 결과로 "없다"고 말하지 않는다.
      return base({
        scannedDepth: scanned,
        pagesFetched,
        errorCode: 'budget_exhausted',
        errorMessage: `호출 예산 소진 (${scanned}위까지만 확인)`,
      });
    }

    const display = Math.min(pageSize, depth - start + 1);
    const page = await fetchPage({ keyword: options.keyword, start, display });
    pagesFetched++;

    if (!page.ok) {
      return base({
        scannedDepth: scanned,
        pagesFetched,
        errorCode: page.errorCode,
        errorMessage: page.message,
      });
    }

    const items = page.items;
    const outcome = findPostRank(items, { ...options.match, startOffset: start - 1 });
    scanned += items.length;

    if (outcome.found) {
      return {
        status: 'ok',
        rank: outcome.match.rank,
        matchedBy: outcome.match.matchedBy,
        matchedLink: outcome.match.link,
        scannedDepth: scanned,
        pagesFetched,
      };
    }
    if (outcome.ambiguous) sawAmbiguous = true;

    // 결과 소진 — 더 요청해도 빈 페이지다
    if (items.length < display) break;
  }

  return {
    status: sawAmbiguous ? 'ambiguous' : 'not_found',
    rank: null,
    matchedBy: null,
    matchedLink: null,
    scannedDepth: scanned,
    pagesFetched,
  };
}
