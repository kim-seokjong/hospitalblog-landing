import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildKeywordHints,
  selectTopKeywordRows,
  fetchKeywordBoard,
  KEYWORD_BOARD_ROW_LIMIT,
} from '../scoreboard/keyword-volume-board.ts';
import type { KeywordVolume } from '../keyword-volume.ts';

const vol = (total: number, compIdx = '중간'): KeywordVolume => ({
  pc: Math.floor(total / 2),
  mobile: total - Math.floor(total / 2),
  total,
  compIdx,
});

// ── buildKeywordHints ──
test('buildKeywordHints: 지역+진료과(공백제거) 우선, 진료과 보조', () => {
  assert.deepEqual(buildKeywordHints('피부과', '수성구'), ['수성구피부과', '피부과']);
});

test('buildKeywordHints: 지역 없으면 진료과만, 진료과 없으면 빈 배열', () => {
  assert.deepEqual(buildKeywordHints('피부과', ''), ['피부과']);
  assert.deepEqual(buildKeywordHints('  ', '수성구'), []);
});

test('buildKeywordHints: 중복 제거', () => {
  // 지역이 비어 있고 결합 결과가 진료과와 같아지는 경우까지 dedupe
  const hints = buildKeywordHints('피부과', '피부과');
  assert.deepEqual(hints, ['피부과피부과', '피부과']);
  assert.equal(new Set(hints).size, hints.length);
});

// ── selectTopKeywordRows ──
test('selectTopKeywordRows: 검색량 내림차순 + limit', () => {
  const volumes = {
    A: vol(100),
    B: vol(300),
    C: vol(200),
  };
  const rows = selectTopKeywordRows(volumes, 2);
  assert.deepEqual(rows.map((r) => r.keyword), ['B', 'C']);
  assert.equal(rows[0].total, 300);
});

test('selectTopKeywordRows: 동률은 키워드 사전순(안정)', () => {
  const rows = selectTopKeywordRows({ 나: vol(100), 가: vol(100) });
  assert.deepEqual(rows.map((r) => r.keyword), ['가', '나']);
});

test('selectTopKeywordRows: 기본 limit 적용', () => {
  const volumes: Record<string, KeywordVolume> = {};
  for (let i = 0; i < 20; i += 1) {
    volumes[`kw${i}`] = vol(1000 - i);
  }
  assert.equal(selectTopKeywordRows(volumes).length, KEYWORD_BOARD_ROW_LIMIT);
});

// ── fetchKeywordBoard: 그레이스풀 ──
const AD_ENV = {
  NAVER_AD_API_KEY: 'a',
  NAVER_AD_SECRET_KEY: 'b',
  NAVER_AD_CUSTOMER_ID: 'c',
} as NodeJS.ProcessEnv;

test('fetchKeywordBoard: 키 없으면 available:false', async () => {
  const res = await fetchKeywordBoard('피부과', '수성구', {
    env: {} as NodeJS.ProcessEnv,
    fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
  });
  assert.equal(res.available, false);
  assert.deepEqual(res.rows, []);
});

test('fetchKeywordBoard: 성공 시 연관 키워드 상위 행', async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        keywordList: [
          { relKeyword: '수성구피부과', monthlyPcQcCnt: 100, monthlyMobileQcCnt: 900, compIdx: '높음' },
          { relKeyword: '피부과추천', monthlyPcQcCnt: 2000, monthlyMobileQcCnt: 3000, compIdx: '중간' },
        ],
      }),
      { status: 200 }
    )) as unknown as typeof fetch;
  const res = await fetchKeywordBoard('피부과', '수성구', { env: AD_ENV, fetchImpl });
  assert.equal(res.available, true);
  assert.deepEqual(res.rows.map((r) => r.keyword), ['피부과추천', '수성구피부과']);
  assert.equal(res.rows[0].compIdx, '중간');
});

test('fetchKeywordBoard: 진료과 없으면 호출 없이 빈 결과', async () => {
  let called = false;
  const res = await fetchKeywordBoard('', '수성구', {
    env: AD_ENV,
    fetchImpl: (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch,
  });
  assert.equal(called, false);
  assert.equal(res.available, true);
  assert.deepEqual(res.rows, []);
});
