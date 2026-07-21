import { fetchJsonWithTimeout, EXTERNAL_FETCH_TIMEOUT_MS } from './fetch-timeout.ts';
import { readOpenApiCredentials } from './golden-keywords.ts';

/**
 * 네이버 블로그 무료진단 — 키워드별 실측 (문서수 + 노출 순위).
 *
 * 네이버 오픈API blog.json 을 display=100 으로 1콜 호출하면
 * - total: 해당 키워드의 블로그 문서수 (경쟁 규모, golden-keywords 의 docCount 와 동일 지표)
 * - items: 상위 100개 검색 결과 → 여기서 진단 대상 blogId 의 순위를 찾는다
 * 를 동시에 얻는다 (fetchBlogDocCount 의 display=1 패턴을 확장 — 호출 수 절약).
 *
 * 그레이스풀: 키 없음/호출 실패/파싱 실패 전부 null 필드 (절대 throw 금지).
 */

const BLOG_SEARCH_URL = 'https://openapi.naver.com/v1/search/blog.json';

/** 순위 탐색 범위 — blog.json display 최대값. */
export const BLOG_CHECK_RANK_DEPTH = 100;
/** 키워드 실측 청크 크기 (오픈API 초당 호출 제한 배려 — 청크 내부만 병렬). */
export const SERP_CHUNK_SIZE = 3;
/** 전체 실측 시간 예산(ms) — 라우트 실행 한도 보호. */
export const SERP_TOTAL_BUDGET_MS = 20_000;

export interface KeywordSerp {
  /** 블로그 문서수(total). 조회 불가 시 null. */
  docCount: number | null;
  /** 상위 100 내 노출 순위(1-base). 미노출·조회 불가 시 null. */
  rank: number | null;
}

interface BlogSearchItem {
  link?: unknown;
  bloggerlink?: unknown;
}

/**
 * blog.json 응답에서 total 과 blogId 의 순위를 뽑는다 (순수 함수).
 * bloggerlink(예: blog.naver.com/florps1) 또는 link(글 URL)에 blogId 가
 * 경로 세그먼트로 포함되면 해당 블로그의 글로 판정한다.
 */
export function parseBlogSearch(data: unknown, blogId: string): KeywordSerp {
  if (!data || typeof data !== 'object') return { docCount: null, rank: null };
  const obj = data as { total?: unknown; items?: unknown };

  const docCount =
    typeof obj.total === 'number' && Number.isFinite(obj.total) && obj.total >= 0
      ? obj.total
      : null;

  let rank: number | null = null;
  if (Array.isArray(obj.items) && blogId) {
    // 경로 경계 매칭 — "florps1" 이 "florps12" 에 오매칭되지 않도록 뒤 경계를 본다.
    const idRe = new RegExp(
      `blog\\.naver\\.com/${blogId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[/?#]|$)`,
      'i',
    );
    for (let i = 0; i < obj.items.length; i++) {
      const item = obj.items[i] as BlogSearchItem;
      const link = typeof item?.link === 'string' ? item.link : '';
      const bloggerlink = typeof item?.bloggerlink === 'string' ? item.bloggerlink : '';
      if (idRe.test(link) || idRe.test(bloggerlink)) {
        rank = i + 1;
        break;
      }
    }
  }
  return { docCount, rank };
}

/**
 * 키워드 1개의 문서수+순위를 조회한다. 실패 전부 null 필드 (그레이스풀).
 */
export async function fetchKeywordSerp(
  keyword: string,
  blogId: string,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    /** 전체 마감시각(epoch ms) — 지나면 호출 없이 즉시 null. */
    deadline?: number;
  } = {},
): Promise<KeywordSerp> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const none: KeywordSerp = { docCount: null, rank: null };

  const creds = readOpenApiCredentials(env);
  if (!creds) return none;
  const cleaned = keyword.trim();
  if (!cleaned) return none;

  const budget = options.timeoutMs ?? EXTERNAL_FETCH_TIMEOUT_MS;
  const remaining = options.deadline !== undefined ? options.deadline - Date.now() : budget;
  if (remaining <= 0) return none;

  const params = new URLSearchParams({ query: cleaned, display: String(BLOG_CHECK_RANK_DEPTH) });
  const res = await fetchJsonWithTimeout(
    fetchImpl,
    `${BLOG_SEARCH_URL}?${params}`,
    {
      headers: {
        'X-Naver-Client-Id': creds.clientId,
        'X-Naver-Client-Secret': creds.clientSecret,
      },
    },
    Math.min(budget, remaining),
  );
  if (!res.ok) return none;
  return parseBlogSearch(res.data, blogId);
}

/**
 * 여러 키워드의 문서수+순위를 청크 단위로 조회한다 (청크 내부만 병렬).
 * deadline 이 지나면 남은 키워드는 null 로 남긴다 (그레이스풀).
 */
export async function fetchKeywordSerps(
  keywords: readonly string[],
  blogId: string,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    deadline?: number;
    chunkSize?: number;
  } = {},
): Promise<Record<string, KeywordSerp>> {
  const chunkSize = Math.max(1, options.chunkSize ?? SERP_CHUNK_SIZE);
  const out: Record<string, KeywordSerp> = {};
  for (const kw of keywords) out[kw] = { docCount: null, rank: null };

  for (let i = 0; i < keywords.length; i += chunkSize) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) break;
    const chunk = keywords.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map((kw) => fetchKeywordSerp(kw, blogId, options)),
    );
    chunk.forEach((kw, idx) => {
      out[kw] = results[idx];
    });
  }
  return out;
}
