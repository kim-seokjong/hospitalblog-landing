import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSymptomPool,
  getTargetMonths,
  computeSeasonalBoost,
  rankSeasonalKeywords,
  buildDatalabBody,
  buildDatalabDateRange,
  formatDateYmd,
  parseDatalabSeries,
  matchSeasonal,
  applySeasonalBoost,
  fetchSeasonalKeywords,
  SEASONAL_BOOST_THRESHOLD,
  DATALAB_GROUP_LIMIT,
  type MonthlyPoint,
} from '../seasonal-keywords.ts';
import type { GoldenKeywordItem } from '../golden-keywords.ts';
import type { KeywordVolume } from '../keyword-volume.ts';

// ── 픽스처: 3년치 월별 시계열 생성 ──

/** 월별 기본 ratio 10, peakMonths 는 peakRatio — 3년 반복 */
function makeSeries(peakMonths: readonly number[], peakRatio: number, base = 10): MonthlyPoint[] {
  const points: MonthlyPoint[] = [];
  for (let year = 0; year < 3; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      points.push({ month, ratio: peakMonths.includes(month) ? peakRatio : base });
    }
  }
  return points;
}

// ── getSymptomPool ──
test('getSymptomPool: 지원 진료과는 증상 명사 풀 반환', () => {
  const pool = getSymptomPool('내과');
  assert.ok(pool.length >= 10);
  assert.ok(pool.includes('냉방병'));
});

test('getSymptomPool: 별칭(소아청소년과→소아과)·미지원 과·빈 값', () => {
  assert.ok(getSymptomPool('소아청소년과').includes('수족구병'));
  assert.ok(getSymptomPool('비뇨의학과').includes('방광염'));
  assert.deepEqual(getSymptomPool('기타'), []);
  assert.deepEqual(getSymptomPool(''), []);
});

// ── getTargetMonths ──
test('getTargetMonths: 현재월+다음월, 12월은 [12,1]', () => {
  assert.deepEqual(getTargetMonths(new Date(2026, 6, 15)), [7, 8]); // 7월
  assert.deepEqual(getTargetMonths(new Date(2026, 11, 3)), [12, 1]); // 12월
});

// ── computeSeasonalBoost: 핵심 점수 공식 ──
test('computeSeasonalBoost: 7월 냉방병 — 여름 피크 시계열은 7월에 부스트', () => {
  // 냉방병: 7·8월 ratio 60, 나머지 10 → 7월 대상 boost 훨씬 > 1.2
  const series = makeSeries([7, 8], 60);
  const boost = computeSeasonalBoost(series, [7, 8]);
  assert.ok(boost !== null && boost >= SEASONAL_BOOST_THRESHOLD, `boost=${boost}`);
  // 겨울(1·2월) 기준으로는 부스트 없음
  const winter = computeSeasonalBoost(series, [1, 2]);
  assert.ok(winter !== null && winter < 1);
});

test('computeSeasonalBoost: 평평한 시계열은 배율 1 (계절성 없음)', () => {
  const flat = makeSeries([], 10);
  const boost = computeSeasonalBoost(flat, [7, 8]);
  assert.ok(boost !== null);
  assert.ok(Math.abs(boost - 1) < 1e-9);
});

test('computeSeasonalBoost: 데이터 부족·전체 0·대상월 관측 없음은 null', () => {
  assert.equal(computeSeasonalBoost([{ month: 7, ratio: 10 }], [7]), null); // < 12 포인트
  assert.equal(computeSeasonalBoost(makeSeries([], 0, 0), [7]), null); // 전체 평균 0
  const noTarget = makeSeries([], 10).filter((p) => p.month !== 7);
  assert.equal(computeSeasonalBoost(noTarget, [7]), null);
});

// ── rankSeasonalKeywords ──
test('rankSeasonalKeywords: 임계 이상만, 배율 내림차순 + 반올림', () => {
  const out = rankSeasonalKeywords({
    냉방병: 3.456,
    장염: 1.5,
    감기: 0.7, // 미달
    비염: null, // 판정 불가
  });
  assert.deepEqual(out, [
    { keyword: '냉방병', boost: 3.46 },
    { keyword: '장염', boost: 1.5 },
  ]);
});

test('rankSeasonalKeywords: limit 적용', () => {
  const boosts: Record<string, number | null> = {};
  for (let i = 0; i < 12; i += 1) boosts[`kw${i}`] = 2 + i * 0.01;
  assert.equal(rankSeasonalKeywords(boosts, { limit: 3 }).length, 3);
});

// ── 데이터랩 요청/응답 순수 함수 ──
test('buildDatalabBody: 그룹 최대 5개, groupName=keyword', () => {
  const body = buildDatalabBody(
    ['a', 'b', 'c', 'd', 'e', 'f'],
    '2023-07-01',
    '2026-06-30'
  );
  assert.equal(body.keywordGroups.length, DATALAB_GROUP_LIMIT);
  assert.deepEqual(body.keywordGroups[0], { groupName: 'a', keywords: ['a'] });
  assert.equal(body.timeUnit, 'month');
});

test('buildDatalabDateRange: 완결 월만 — 3년 전 1일 ~ 지난달 말일', () => {
  const range = buildDatalabDateRange(new Date(2026, 6, 15)); // 2026-07-15
  assert.equal(range.startDate, '2023-07-01');
  assert.equal(range.endDate, '2026-06-30');
});

test('formatDateYmd: 로컬 기준 yyyy-mm-dd (0패딩)', () => {
  assert.equal(formatDateYmd(new Date(2026, 0, 5)), '2026-01-05');
});

test('parseDatalabSeries: 응답 매핑 + 이상 항목 스킵', () => {
  const out = parseDatalabSeries({
    results: [
      { title: '냉방병', data: [{ period: '2026-07-01', ratio: 55.5 }, { period: 'bad', ratio: 1 }] },
      { title: '', data: [] }, // 제목 없음 → 스킵
      null,
    ],
  });
  assert.deepEqual(out['냉방병'], [{ month: 7, ratio: 55.5 }]);
  assert.equal(Object.keys(out).length, 1);
  assert.deepEqual(parseDatalabSeries(null), {});
});

// ── matchSeasonal / applySeasonalBoost ──

const vol = (total: number): KeywordVolume => ({ pc: 0, mobile: total, total, compIdx: '중간' });

const goldenItem = (
  keyword: string,
  total: number,
  ratio: number | null
): GoldenKeywordItem => ({
  keyword,
  volume: vol(total),
  docCount: ratio === null ? null : Math.round(ratio * total),
  ratio,
  competition: ratio === null ? null : ratio < 10 ? '낮음' : ratio < 50 ? '중간' : '높음',
});

test('matchSeasonal: 부분 포함 매칭 (공백 무시), 최고 배율 우선', () => {
  const seasonal = [
    { keyword: '냉방병', boost: 2.5 },
    { keyword: '장염', boost: 1.8 },
  ];
  assert.deepEqual(matchSeasonal('냉방병 증상', seasonal), { keyword: '냉방병', boost: 2.5 });
  assert.equal(matchSeasonal('감기몸살', seasonal), null);
});

test('applySeasonalBoost: 계절 매칭 키워드가 앞으로 (ratio ÷ boost)', () => {
  const items = [
    goldenItem('일반키워드', 1000, 4), // sortKey 4
    goldenItem('냉방병주의', 1000, 6), // boost 2 → sortKey 3 → 1위로
  ];
  const out = applySeasonalBoost(items, [{ keyword: '냉방병', boost: 2 }]);
  assert.equal(out[0].keyword, '냉방병주의');
  assert.deepEqual(out[0].seasonal, { keyword: '냉방병', boost: 2 });
  assert.equal(out[1].seasonal, null);
});

test('applySeasonalBoost: ratio 없는 그룹은 뒤에서 검색량×boost 내림차순', () => {
  const items = [
    goldenItem('문서있음', 100, 5),
    goldenItem('큰볼륨', 1000, null),
    goldenItem('냉방병시즌', 600, null), // boost 2 → 1200 > 1000
  ];
  const out = applySeasonalBoost(items, [{ keyword: '냉방병', boost: 2 }]);
  assert.deepEqual(out.map((i) => i.keyword), ['문서있음', '냉방병시즌', '큰볼륨']);
});

test('applySeasonalBoost: 입력 불변 + 계절 없으면 순서 로직 유지', () => {
  const items = [goldenItem('B', 100, 5), goldenItem('A', 100, 2)];
  const before = items.map((i) => i.keyword);
  const out = applySeasonalBoost(items, []);
  assert.deepEqual(items.map((i) => i.keyword), before);
  assert.deepEqual(out.map((i) => i.keyword), ['A', 'B']);
});

// ── fetchSeasonalKeywords: 그레이스풀 + 통합 ──
const OPEN_ENV = {
  NAVER_CLIENT_ID: 'id',
  NAVER_CLIENT_SECRET: 'secret',
} as NodeJS.ProcessEnv;

test('fetchSeasonalKeywords: 키 없으면 available:false (호출 안 함)', async () => {
  let called = false;
  const res = await fetchSeasonalKeywords('내과', {
    env: {} as NodeJS.ProcessEnv,
    fetchImpl: (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch,
  });
  assert.equal(res.available, false);
  assert.equal(called, false);
});

test('fetchSeasonalKeywords: 미지원 진료과는 available:true + 빈 항목', async () => {
  const res = await fetchSeasonalKeywords('기타', { env: OPEN_ENV });
  assert.equal(res.available, true);
  assert.deepEqual(res.items, []);
});

test('fetchSeasonalKeywords: 7월 내과 — 냉방병이 계절 키워드로 감지', async () => {
  const now = new Date(2026, 6, 15); // 7월
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      keywordGroups: { groupName: string }[];
    };
    // 냉방병만 여름 피크, 나머지는 평평 — 3년 월별 시계열
    const results = body.keywordGroups.map((g) => {
      const peak = g.groupName === '냉방병';
      const data: { period: string; ratio: number }[] = [];
      for (let y = 2023; y <= 2025; y += 1) {
        for (let m = 1; m <= 12; m += 1) {
          const ratio = peak && (m === 7 || m === 8) ? 80 : 10;
          data.push({ period: `${y}-${String(m).padStart(2, '0')}-01`, ratio });
        }
      }
      return { title: g.groupName, data };
    });
    return new Response(JSON.stringify({ results }), { status: 200 });
  }) as unknown as typeof fetch;

  const res = await fetchSeasonalKeywords('내과', { now, env: OPEN_ENV, fetchImpl });
  assert.equal(res.available, true);
  assert.deepEqual(res.targetMonths, [7, 8]);
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].keyword, '냉방병');
  assert.ok(res.items[0].boost >= SEASONAL_BOOST_THRESHOLD);
});

test('fetchSeasonalKeywords: 전 배치 실패 시 available:false', async () => {
  const res = await fetchSeasonalKeywords('내과', {
    env: OPEN_ENV,
    fetchImpl: (async () => new Response('err', { status: 500 })) as unknown as typeof fetch,
  });
  assert.equal(res.available, false);
});
