import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scanKeywordRank,
  MAX_SCAN_DEPTH,
  NAVER_MAX_START,
  type RankPageFetcher,
} from '../rank-scan.ts';
import type { BlogSearchResult } from '../rank-tracking.ts';

function item(blogId: string, n: number, title = ''): BlogSearchResult {
  return { link: `https://blog.naver.com/${blogId}/${n}`, bloggername: blogId, title };
}

/** position(1-base) 에 내 글이 있는 가상 검색결과를 만드는 페이지 페처. */
function fakeIndex(myPosition: number | null, total = 1000, myTitle = '내 글'): {
  fetch: RankPageFetcher;
  calls: Array<{ start: number; display: number }>;
} {
  const calls: Array<{ start: number; display: number }> = [];
  const fetch: RankPageFetcher = async ({ start, display }) => {
    calls.push({ start, display });
    const items: BlogSearchResult[] = [];
    for (let i = 0; i < display; i++) {
      const pos = start + i;
      if (pos > total) break;
      items.push(pos === myPosition ? item('myclinic', pos, myTitle) : item('other', pos, '남의 글'));
    }
    return { ok: true, items };
  };
  return { fetch, calls };
}

const MATCH = { blogId: 'myclinic', title: '내 글' };

// ── 미발견 vs 측정 실패 구분 (이번 수정의 핵심) ──
test('★ 측정 실패는 not_found 가 아니다 — status=failed 로 구분된다', async () => {
  const fetch: RankPageFetcher = async () => ({
    ok: false,
    errorCode: 'no_credentials',
    message: 'NAVER_CLIENT_ID 미설정',
  });
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: MATCH });
  assert.equal(out.status, 'failed');
  assert.equal(out.rank, null);
  assert.equal(out.errorCode, 'no_credentials');
});

test('★ 정상 측정했는데 없으면 not_found + 실제 스캔 깊이', async () => {
  const { fetch } = fakeIndex(null, 300);
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: MATCH });
  assert.equal(out.status, 'not_found');
  assert.equal(out.rank, null);
  assert.equal(out.scannedDepth, 300);
  assert.equal(out.errorCode, undefined);
});

test('쿼터 소진(429)도 실패로 보고된다 — "순위권 밖"으로 저장되면 안 된다', async () => {
  const fetch: RankPageFetcher = async () => ({ ok: false, errorCode: 'rate_limited', message: '429' });
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: MATCH });
  assert.equal(out.status, 'failed');
  assert.equal(out.errorCode, 'rate_limited');
});

test('중간 페이지 실패도 failed — 뒤를 못 봤으면 "없다"고 단정하지 않는다', async () => {
  let n = 0;
  const fetch: RankPageFetcher = async ({ start, display }) => {
    n++;
    if (n === 2) return { ok: false, errorCode: 'network_error', message: 'timeout' };
    const items: BlogSearchResult[] = [];
    for (let i = 0; i < display; i++) items.push(item('other', start + i));
    return { ok: true, items };
  };
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: MATCH });
  assert.equal(out.status, 'failed');
  assert.equal(out.errorCode, 'network_error');
  assert.equal(out.scannedDepth, 100); // 1페이지까지만 확인했음을 정직하게 남긴다
});

// ── 100위 초과 탐색 (start 페이징) ──
test('★ 100위 안이면 1콜로 끝난다 (조기 종료)', async () => {
  const { fetch, calls } = fakeIndex(5);
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: MATCH });
  assert.equal(out.status, 'ok');
  assert.equal(out.rank, 5);
  assert.equal(calls.length, 1);
  assert.equal(out.pagesFetched, 1);
});

test('★ 101위 이상도 찾는다 — 예전엔 100위까지만 봐서 전부 미발견이었다', async () => {
  const { fetch, calls } = fakeIndex(147);
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: MATCH });
  assert.equal(out.status, 'ok');
  assert.equal(out.rank, 147);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { start: 101, display: 100 });
});

test('★ 26위 (실제 "병원마케팅 비용" 사례) 도 정확히 잡는다', async () => {
  const { fetch } = fakeIndex(26);
  const out = await scanKeywordRank(fetch, { keyword: '병원마케팅 비용', depth: 300, match: MATCH });
  assert.equal(out.rank, 26);
});

test('300위 경계 — 마지막 페이지 display 가 깊이에 맞춰 잘린다', async () => {
  const { fetch, calls } = fakeIndex(300);
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 250, match: MATCH });
  assert.equal(out.status, 'not_found'); // 250위까지만 봤으므로
  assert.equal(out.scannedDepth, 250);
  assert.deepEqual(calls[2], { start: 201, display: 50 });
});

// ★ 네이버 실측 하드 제약: start=1001 → HTTP 400 SE03, display=101 → HTTP 400 SE02.
//   깊이를 아무리 크게 줘도 이 선을 절대 넘으면 안 된다.
test('네이버 API 하드 상한을 넘겨 요청하지 않는다 (SE02/SE03 방지)', async () => {
  const { fetch, calls } = fakeIndex(null, 5000);
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 99999, match: MATCH });
  assert.ok(calls.length > 0);
  assert.ok(
    calls.every((c) => c.start <= NAVER_MAX_START),
    `start 는 ${NAVER_MAX_START} 이하여야 한다. 실제 최대 ${Math.max(...calls.map((c) => c.start))}`,
  );
  assert.ok(calls.every((c) => c.display <= 100), 'display 는 100 이하여야 한다');
  assert.equal(out.scannedDepth, MAX_SCAN_DEPTH);
  assert.equal(out.status, 'not_found');
});

test('결과가 소진되면 더 요청하지 않는다', async () => {
  const { fetch, calls } = fakeIndex(null, 130);
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: MATCH });
  assert.equal(out.status, 'not_found');
  assert.equal(calls.length, 2);
  assert.equal(out.scannedDepth, 130);
});

// ── 호출 예산 ──
test('★ 예산 0 이면 호출 없이 failed(budget_exhausted) — 미발견으로 위장하지 않는다', async () => {
  const { fetch, calls } = fakeIndex(5);
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: MATCH, callBudget: 0 });
  assert.equal(out.status, 'failed');
  assert.equal(out.errorCode, 'budget_exhausted');
  assert.equal(calls.length, 0);
});

test('예산이 도중에 끊기면 failed — 확인한 깊이를 함께 보고한다', async () => {
  const { fetch, calls } = fakeIndex(250);
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: MATCH, callBudget: 2 });
  assert.equal(out.status, 'failed');
  assert.equal(out.errorCode, 'budget_exhausted');
  assert.equal(out.scannedDepth, 200);
  assert.equal(calls.length, 2);
});

// ── 매칭 단서 없음 ──
test('blogId·publishedUrl 둘 다 없으면 호출 없이 failed', async () => {
  const { fetch, calls } = fakeIndex(1);
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: {} });
  assert.equal(out.status, 'failed');
  assert.equal(out.errorCode, 'no_match_key');
  assert.equal(calls.length, 0);
});

// ── 모호 ──
test('같은 블로그 글이 여럿이고 제목으로 못 가르면 ambiguous', async () => {
  const fetch: RankPageFetcher = async ({ start, display }) => {
    const items: BlogSearchResult[] = [];
    for (let i = 0; i < display; i++) {
      const pos = start + i;
      items.push(pos === 3 || pos === 7 ? item('myclinic', pos, '전혀 다른 글') : item('other', pos));
    }
    return { ok: true, items };
  };
  const out = await scanKeywordRank(fetch, {
    keyword: 'x',
    depth: 100,
    match: { blogId: 'myclinic', title: '내가 쓴 임플란트 보험 안내' },
  });
  assert.equal(out.status, 'ambiguous');
  assert.equal(out.rank, null);
});

test('제목이 일치하면 여럿 중에서도 올바른 글을 고른다', async () => {
  const fetch: RankPageFetcher = async ({ start, display }) => {
    const items: BlogSearchResult[] = [];
    for (let i = 0; i < display; i++) {
      const pos = start + i;
      if (pos === 3) items.push(item('myclinic', pos, '구로동치과 신경치료 실패 줄이는 3가지 주의사항'));
      else if (pos === 7) items.push(item('myclinic', pos, '구로동치과 신경치료 전 알아야 할 4가지 핵심 체크리스트'));
      else items.push(item('other', pos));
    }
    return { ok: true, items };
  };
  const out = await scanKeywordRank(fetch, {
    keyword: '구로동치과',
    depth: 100,
    match: { blogId: 'myclinic', title: '구로동치과 신경치료 전 알아야 할 4가지 핵심 체크리스트' },
  });
  assert.equal(out.status, 'ok');
  assert.equal(out.rank, 7);
  assert.equal(out.matchedBy, 'title');
});

test('matchedLink 를 돌려준다 (published_url 백필용)', async () => {
  const { fetch } = fakeIndex(4);
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 100, match: MATCH });
  assert.equal(out.matchedLink, 'https://blog.naver.com/myclinic/4');
});
