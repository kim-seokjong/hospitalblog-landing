import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readOpenApiCredentials,
  buildGoldenHints,
  selectGoldenCandidates,
  computeCompetitionRatio,
  classifyCompetition,
  rankGoldenKeywords,
  parseBlogTotal,
  fetchBlogDocCount,
  fetchBlogDocCounts,
  fetchGoldenKeywords,
} from '../golden-keywords.ts';
import type { KeywordVolume } from '../keyword-volume.ts';

const vol = (total: number, compIdx = '중간'): KeywordVolume => ({
  pc: Math.floor(total / 2),
  mobile: total - Math.floor(total / 2),
  total,
  compIdx,
});

// ── readOpenApiCredentials: 그레이스풀 ──
test('readOpenApiCredentials: 전부 있으면 객체', () => {
  const creds = readOpenApiCredentials({
    NAVER_CLIENT_ID: 'id',
    NAVER_CLIENT_SECRET: 'secret',
  } as NodeJS.ProcessEnv);
  assert.deepEqual(creds, { clientId: 'id', clientSecret: 'secret' });
});

test('readOpenApiCredentials: 하나라도 없으면 null (throw 안 함)', () => {
  assert.equal(readOpenApiCredentials({ NAVER_CLIENT_ID: 'id' } as NodeJS.ProcessEnv), null);
  assert.equal(readOpenApiCredentials({} as NodeJS.ProcessEnv), null);
});

// ── buildGoldenHints ──
test('buildGoldenHints: 지역 있으면 지역결합 힌트 추가', () => {
  assert.deepEqual(buildGoldenHints('보톡스', '강남'), ['보톡스', '강남보톡스']);
});

test('buildGoldenHints: 지역 없으면 주제만, 빈 주제는 빈 배열', () => {
  assert.deepEqual(buildGoldenHints('보톡스'), ['보톡스']);
  assert.deepEqual(buildGoldenHints('  '), []);
});

test('buildGoldenHints: 주제 공백은 지역결합에서 제거', () => {
  assert.deepEqual(buildGoldenHints('레이저 토닝', '강남'), ['레이저 토닝', '강남레이저토닝']);
});

// ── selectGoldenCandidates ──
test('selectGoldenCandidates: minVolume 필터 + 검색량 내림차순 + limit', () => {
  const volumes = {
    큰키워드: vol(10000),
    중간키워드: vol(500),
    작은키워드: vol(10), // minVolume(100) 미달
  };
  const out = selectGoldenCandidates(volumes, { limit: 2, minCandidates: 1 });
  assert.deepEqual(out.map((c) => c.keyword), ['큰키워드', '중간키워드']);
});

test('selectGoldenCandidates: 니치 주제 폴백 — 필터 결과 부족하면 미달 키워드로 채움', () => {
  const volumes = {
    니치A: vol(50),
    니치B: vol(30),
    니치C: vol(10),
  };
  const out = selectGoldenCandidates(volumes, { minCandidates: 3 });
  assert.equal(out.length, 3);
  assert.equal(out[0].keyword, '니치A');
});

// ── computeCompetitionRatio / classifyCompetition ──
test('computeCompetitionRatio: 문서수÷검색량, 불가 시 null', () => {
  assert.equal(computeCompetitionRatio(1000, 100), 10);
  assert.equal(computeCompetitionRatio(null, 100), null);
  assert.equal(computeCompetitionRatio(100, 0), null);
  assert.equal(computeCompetitionRatio(-1, 100), null);
});

test('classifyCompetition: <10 낮음, <50 중간, 이상 높음, null 은 null', () => {
  assert.equal(classifyCompetition(3), '낮음');
  assert.equal(classifyCompetition(10), '중간');
  assert.equal(classifyCompetition(49.9), '중간');
  assert.equal(classifyCompetition(50), '높음');
  assert.equal(classifyCompetition(null), null);
});

// ── rankGoldenKeywords ──
test('rankGoldenKeywords: 경쟁도(ratio) 오름차순 — 황금 키워드가 먼저', () => {
  const candidates = [
    { keyword: '경쟁높음', volume: vol(10000) },
    { keyword: '황금', volume: vol(1000) },
  ];
  const docCounts = { 경쟁높음: 500000, 황금: 2000 }; // ratio 50 vs 2
  const out = rankGoldenKeywords(candidates, docCounts);
  assert.equal(out[0].keyword, '황금');
  assert.equal(out[0].ratio, 2);
  assert.equal(out[0].competition, '낮음');
  assert.equal(out[1].competition, '높음');
});

test('rankGoldenKeywords: 문서수 없는 항목은 뒤로, 검색량 내림차순 유지', () => {
  const candidates = [
    { keyword: '문서없음큰', volume: vol(9000) },
    { keyword: '문서있음', volume: vol(100) },
    { keyword: '문서없음작은', volume: vol(50) },
  ];
  const out = rankGoldenKeywords(candidates, { 문서있음: 500 });
  assert.deepEqual(out.map((i) => i.keyword), ['문서있음', '문서없음큰', '문서없음작은']);
  assert.equal(out[1].ratio, null);
  assert.equal(out[1].competition, null);
});

test('rankGoldenKeywords: 입력 배열 변형 없음 (불변)', () => {
  const candidates = [
    { keyword: 'B', volume: vol(100) },
    { keyword: 'A', volume: vol(200) },
  ];
  const before = candidates.map((c) => c.keyword);
  rankGoldenKeywords(candidates, { A: 10, B: 10000 });
  assert.deepEqual(candidates.map((c) => c.keyword), before);
});

// ── parseBlogTotal ──
test('parseBlogTotal: total 추출, 이상값은 null', () => {
  assert.equal(parseBlogTotal({ total: 1234 }), 1234);
  assert.equal(parseBlogTotal({ total: 0 }), 0);
  assert.equal(parseBlogTotal({ total: '많음' }), null);
  assert.equal(parseBlogTotal(null), null);
  assert.equal(parseBlogTotal({}), null);
});

// ── fetchBlogDocCount: 그레이스풀 ──
const OPEN_ENV = {
  NAVER_CLIENT_ID: 'id',
  NAVER_CLIENT_SECRET: 'secret',
} as NodeJS.ProcessEnv;

test('fetchBlogDocCount: 키 없으면 null (호출 안 함)', async () => {
  let called = false;
  const out = await fetchBlogDocCount('보톡스', {
    env: {} as NodeJS.ProcessEnv,
    fetchImpl: (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch,
  });
  assert.equal(out, null);
  assert.equal(called, false);
});

test('fetchBlogDocCount: 성공 시 total', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ total: 777, items: [] }), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await fetchBlogDocCount('보톡스', { env: OPEN_ENV, fetchImpl }), 777);
});

test('fetchBlogDocCount: non-ok/throw 는 null', async () => {
  const bad = (async () => new Response('err', { status: 429 })) as unknown as typeof fetch;
  assert.equal(await fetchBlogDocCount('보톡스', { env: OPEN_ENV, fetchImpl: bad }), null);
  const boom = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
  assert.equal(await fetchBlogDocCount('보톡스', { env: OPEN_ENV, fetchImpl: boom }), null);
});

test('fetchBlogDocCounts: 키워드별 total 매핑 (청크 순회)', async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const total = url.includes(encodeURIComponent('황금')) ? 10 : 99;
    return new Response(JSON.stringify({ total }), { status: 200 });
  }) as unknown as typeof fetch;
  const out = await fetchBlogDocCounts(['황금', '일반'], { env: OPEN_ENV, fetchImpl, chunkSize: 1 });
  assert.deepEqual(out, { 황금: 10, 일반: 99 });
});

// ── fetchGoldenKeywords: 전체 파이프라인 ──
const FULL_ENV = {
  NAVER_AD_API_KEY: 'a',
  NAVER_AD_SECRET_KEY: 'b',
  NAVER_AD_CUSTOMER_ID: 'c',
  NAVER_CLIENT_ID: 'id',
  NAVER_CLIENT_SECRET: 'secret',
} as NodeJS.ProcessEnv;

/** searchad → keywordstool 응답, openapi → 문서수 응답으로 분기하는 목 fetch */
function makeDualFetch(docTotals: Record<string, number>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('searchad')) {
      return new Response(
        JSON.stringify({
          keywordList: [
            { relKeyword: '황금', monthlyPcQcCnt: 500, monthlyMobileQcCnt: 500, compIdx: '낮음' },
            { relKeyword: '레드오션', monthlyPcQcCnt: 5000, monthlyMobileQcCnt: 5000, compIdx: '높음' },
            { relKeyword: '너무작음', monthlyPcQcCnt: '< 10', monthlyMobileQcCnt: '< 10', compIdx: '낮음' },
          ],
        }),
        { status: 200 }
      );
    }
    const match = Object.keys(docTotals).find((k) => url.includes(encodeURIComponent(k)));
    return new Response(JSON.stringify({ total: match ? docTotals[match] : 0 }), { status: 200 });
  }) as unknown as typeof fetch;
}

test('fetchGoldenKeywords: 경쟁 낮은 키워드가 1위', async () => {
  // ratio: 황금 3(낮음) < 너무작음 20×20=… '너무작음'(total 10)도 폴백 후보에 포함되므로 문서수 부여
  const fetchImpl = makeDualFetch({ 황금: 3000, 레드오션: 900000, 너무작음: 400 }); // ratio 3 / 90 / 40
  const res = await fetchGoldenKeywords('주제', { env: FULL_ENV, fetchImpl });
  assert.equal(res.available, true);
  assert.equal(res.docAvailable, true);
  assert.equal(res.items[0].keyword, '황금');
  assert.equal(res.items[0].competition, '낮음');
  const red = res.items.find((i) => i.keyword === '레드오션');
  assert.ok(red);
  assert.equal(red.competition, '높음');
  assert.equal(red.ratio, 90);
});

test('fetchGoldenKeywords: 검색광고 키 없으면 available:false', async () => {
  const res = await fetchGoldenKeywords('주제', {
    env: { NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 's' } as NodeJS.ProcessEnv,
    fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
  });
  assert.equal(res.available, false);
  assert.deepEqual(res.items, []);
});

test('fetchGoldenKeywords: 오픈API 키 없으면 docAvailable:false + 검색량순', async () => {
  const env = {
    NAVER_AD_API_KEY: 'a',
    NAVER_AD_SECRET_KEY: 'b',
    NAVER_AD_CUSTOMER_ID: 'c',
  } as NodeJS.ProcessEnv;
  const res = await fetchGoldenKeywords('주제', { env, fetchImpl: makeDualFetch({}) });
  assert.equal(res.available, true);
  assert.equal(res.docAvailable, false);
  // 문서수 없음 → 검색량 내림차순
  assert.equal(res.items[0].keyword, '레드오션');
  assert.equal(res.items[0].docCount, null);
});

test('fetchGoldenKeywords: 빈 주제는 빈 결과 (호출 없음)', async () => {
  let called = false;
  const res = await fetchGoldenKeywords('  ', {
    env: FULL_ENV,
    fetchImpl: (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch,
  });
  assert.equal(called, false);
  assert.deepEqual(res.items, []);
});
