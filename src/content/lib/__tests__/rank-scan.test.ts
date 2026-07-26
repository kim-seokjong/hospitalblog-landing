import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scanKeywordRank,
  MAX_SCAN_DEPTH,
  NAVER_MAX_START,
  BUDGET_EXHAUSTED,
  type RankPageFetcher,
  type RankScanPageResult,
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
/** 호출부(cron)의 캐시 + 예산 게이트를 그대로 재현한 페처. */
function budgetedFetcher(inner: RankPageFetcher, maxCalls: number) {
  const cache = new Map<number, RankScanPageResult>();
  const state = { realCalls: 0 };
  const fetch: RankPageFetcher = async (req) => {
    const hit = cache.get(req.start);
    if (hit) return hit;                       // 캐시 히트 — 예산 소모 없음
    if (state.realCalls >= maxCalls) {
      return { ok: false, errorCode: BUDGET_EXHAUSTED, message: '예산 소진' };
    }
    state.realCalls++;
    const page = await inner(req);
    cache.set(req.start, page);
    return page;
  };
  return { fetch, state };
}

test('★ 예산 0 이면 failed(budget_exhausted) — 미발견으로 위장하지 않는다', async () => {
  const { fetch: inner, calls } = fakeIndex(5);
  const { fetch } = budgetedFetcher(inner, 0);
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: MATCH });
  assert.equal(out.status, 'failed');
  assert.equal(out.errorCode, BUDGET_EXHAUSTED);
  assert.equal(calls.length, 0, '실제 API 호출은 없어야 한다');
});

test('예산이 도중에 끊기면 failed — 확인한 깊이를 함께 보고한다', async () => {
  const { fetch: inner } = fakeIndex(250);
  const { fetch, state } = budgetedFetcher(inner, 2);
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: MATCH });
  assert.equal(out.status, 'failed');
  assert.equal(out.errorCode, BUDGET_EXHAUSTED);
  assert.equal(out.scannedDepth, 200, '200위까지는 확인했음을 남긴다');
  assert.equal(state.realCalls, 2);
});

// ★ 캐시 히트가 예산을 갉아먹으면 안 된다 — 예산 판정은 실제 호출 여부를 아는 쪽(페처)이 한다
test('★ 캐시 히트는 예산을 소모하지 않는다 (예산 0이어도 캐시로 끝까지 스캔)', async () => {
  const { fetch: inner } = fakeIndex(250);
  const { fetch, state } = budgetedFetcher(inner, 3);

  const first = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: MATCH });
  assert.equal(first.status, 'ok');
  assert.equal(first.rank, 250);
  assert.equal(state.realCalls, 3);

  // 예산은 이미 소진됐지만 전부 캐시 히트라 정상 완주해야 한다
  const second = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: MATCH });
  assert.equal(second.status, 'ok', '캐시로 처리 가능한 대상은 예산과 무관하게 측정된다');
  assert.equal(second.rank, 250);
  assert.equal(state.realCalls, 3, '추가 API 호출 없음');
});

// ── 매칭 단서 없음 ──
test('blogId·publishedUrl 둘 다 없으면 호출 없이 failed', async () => {
  const { fetch, calls } = fakeIndex(1);
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: {} });
  assert.equal(out.status, 'failed');
  assert.equal(out.errorCode, 'no_match_key');
  assert.equal(calls.length, 0);
});

// ── 제목 단서가 있을 때: 내 블로그 글이 보여도 이 글이 아니면 미발견 ──
// ★ 예전 로직은 "내 블로그 글이 1건뿐이면 그것"으로 확정해서, 색인되지 않은 글이
//   같은 블로그의 다른 글 순위를 가져갔다. 제목 단서가 있으면 그 판정을 하지 않는다.
test('★ 내 블로그의 다른 글만 잡히면 그 순위를 가져오지 않는다 (not_found)', async () => {
  const fetch: RankPageFetcher = async ({ start, display }) => {
    const items: BlogSearchResult[] = [];
    for (let i = 0; i < display; i++) {
      const pos = start + i;
      items.push(pos === 30 ? item('myclinic', pos, '전혀 다른 주제의 글') : item('other', pos));
    }
    return { ok: true, items };
  };
  const out = await scanKeywordRank(fetch, {
    keyword: 'x',
    depth: 100,
    match: { blogId: 'myclinic', title: '내가 쓴 임플란트 보험 안내' },
  });
  assert.equal(out.status, 'not_found');
  assert.equal(out.rank, null);
});

test('제목 단서가 없고 내 글이 여럿이면 ambiguous', async () => {
  const fetch: RankPageFetcher = async ({ start, display }) => {
    const items: BlogSearchResult[] = [];
    for (let i = 0; i < display; i++) {
      const pos = start + i;
      items.push(pos === 3 || pos === 7 ? item('myclinic', pos) : item('other', pos));
    }
    return { ok: true, items };
  };
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 100, match: { blogId: 'myclinic' } });
  assert.equal(out.status, 'ambiguous');
});

// ★ 페이지 단위 판정 금지 — 1페이지에 후보 1건이라고 확정하면 2페이지의 진짜 내 글을 놓친다
test('★ 제목 단서 없을 때 후보 판정은 전체 깊이를 다 본 뒤에 한다', async () => {
  const fetch: RankPageFetcher = async ({ start, display }) => {
    const items: BlogSearchResult[] = [];
    for (let i = 0; i < display; i++) {
      const pos = start + i;
      items.push(pos === 50 || pos === 150 ? item('myclinic', pos) : item('other', pos));
    }
    return { ok: true, items };
  };
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: { blogId: 'myclinic' } });
  // 1페이지만 보고 50위로 확정하면 안 된다 — 150위에도 내 글이 있다
  assert.equal(out.status, 'ambiguous');
  assert.equal(out.rank, null);
});

test('제목 단서 없고 전체 깊이에서 내 글이 딱 1건이면 확정', async () => {
  const fetch: RankPageFetcher = async ({ start, display }) => {
    const items: BlogSearchResult[] = [];
    for (let i = 0; i < display; i++) {
      const pos = start + i;
      items.push(pos === 150 ? item('myclinic', pos) : item('other', pos));
    }
    return { ok: true, items };
  };
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: { blogId: 'myclinic' } });
  assert.equal(out.status, 'ok');
  assert.equal(out.rank, 150);
  assert.equal(out.matchedBy, 'blog');
});

// ★ 부분 일치로 조기 확정하면 뒤 페이지의 더 정확한 후보를 놓치고,
//   그 잘못된 link 가 published_url 로 백필돼 오매칭이 영구 고착된다.
test('★ 부분 일치는 조기 확정하지 않는다 — 뒤 페이지의 더 정확한 글을 고른다', async () => {
  const MY_TITLE = '구로동치과 신경치료 전 알아야 할 4가지 핵심 체크리스트';
  const fetch: RankPageFetcher = async ({ start, display }) => {
    const items: BlogSearchResult[] = [];
    for (let i = 0; i < display; i++) {
      const pos = start + i;
      // 50위: 제목이 어중간하게 겹치는 다른 글 / 150위: 진짜 내 글
      if (pos === 50) items.push(item('myclinic', pos, '구로동치과 신경치료 실패 줄이는 3가지 주의사항'));
      else if (pos === 150) items.push(item('myclinic', pos, MY_TITLE));
      else items.push(item('other', pos));
    }
    return { ok: true, items };
  };
  const out = await scanKeywordRank(fetch, {
    keyword: '구로동치과',
    depth: 300,
    match: { blogId: 'myclinic', title: MY_TITLE },
  });
  assert.equal(out.status, 'ok');
  assert.equal(out.rank, 150, '50위 글로 잘못 확정하면 안 된다');
  assert.equal(out.matchedLink, 'https://blog.naver.com/myclinic/150');
});

test('★ 제목 완전 일치는 조기 확정한다 (1콜로 끝난다)', async () => {
  const { fetch, calls } = fakeIndex(7, 1000, '내 글');
  const out = await scanKeywordRank(fetch, { keyword: 'x', depth: 300, match: MATCH });
  assert.equal(out.status, 'ok');
  assert.equal(out.rank, 7);
  assert.equal(calls.length, 1, '완전 일치면 뒤 페이지를 볼 필요가 없다');
});

test('★ TITLE_MARGIN 은 페이지가 갈려 있어도 적용된다', async () => {
  // 1페이지 0.8, 2페이지 0.79 → 전체로 보면 근소 → ambiguous
  const fetch: RankPageFetcher = async ({ start, display }) => {
    const items: BlogSearchResult[] = [];
    for (let i = 0; i < display; i++) {
      const pos = start + i;
      if (pos === 40) items.push(item('myclinic', pos, '임플란트 건강보험 적용 기준 총정리 안내'));
      else if (pos === 140) items.push(item('myclinic', pos, '임플란트 건강보험 적용 기준 총정리 설명'));
      else items.push(item('other', pos));
    }
    return { ok: true, items };
  };
  const out = await scanKeywordRank(fetch, {
    keyword: '임플란트',
    depth: 300,
    match: { blogId: 'myclinic', title: '임플란트 건강보험 적용 기준 총정리 정리' },
  });
  assert.equal(out.status, 'ambiguous');
});

test('제목이 비슷한 두 글이 근소하면 특정하지 않는다 (ambiguous)', async () => {
  const fetch: RankPageFetcher = async ({ start, display }) => {
    const items: BlogSearchResult[] = [];
    for (let i = 0; i < display; i++) {
      const pos = start + i;
      if (pos === 4) items.push(item('myclinic', pos, '구로동치과 신경치료 주의사항 3가지'));
      else if (pos === 9) items.push(item('myclinic', pos, '구로동치과 신경치료 주의사항 4가지'));
      else items.push(item('other', pos));
    }
    return { ok: true, items };
  };
  const out = await scanKeywordRank(fetch, {
    keyword: '구로동치과',
    depth: 100,
    match: { blogId: 'myclinic', title: '구로동치과 신경치료 주의사항 5가지' },
  });
  assert.equal(out.status, 'ambiguous');
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
