import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shiftDateKey,
  aiReferralWindowStart,
  normalizeAiReferralSummary,
  emptyAiReferralSummary,
  AI_REFERRAL_WINDOW_DAYS,
  AI_REFERRAL_MIN_POST_CELL,
} from '../summary.ts';

const END = '2026-07-26';

// ---------------------------------------------------------------------------
// 날짜 유틸
// ---------------------------------------------------------------------------

test('shiftDateKey: 월·연 경계를 넘어도 정확하다', () => {
  assert.equal(shiftDateKey('2026-07-26', 1), '2026-07-27');
  assert.equal(shiftDateKey('2026-07-01', -1), '2026-06-30');
  assert.equal(shiftDateKey('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDateKey('2028-02-28', 1), '2028-02-29'); // 윤년
});

test('shiftDateKey: 형식이 아니면 입력을 그대로 돌려준다 (throw 금지)', () => {
  assert.equal(shiftDateKey('nope', 1), 'nope');
});

test('aiReferralWindowStart: 마지막 날 포함 N일 구간의 첫날을 준다', () => {
  assert.equal(aiReferralWindowStart('2026-07-26', 30), '2026-06-27');
  assert.equal(aiReferralWindowStart('2026-07-26', 1), '2026-07-26');
  assert.equal(aiReferralWindowStart('2026-07-26', 0), '2026-07-26'); // 비정상 값 방어
});

// ---------------------------------------------------------------------------
// 0건·비정상 입력 — 초기에는 대부분 0이다
// ---------------------------------------------------------------------------

test('normalizeAiReferralSummary: null(마이그 미적용)이면 빈 요약을 준다', () => {
  const summary = normalizeAiReferralSummary(null, { endDate: END, windowDays: 30 });
  assert.equal(summary.totalVisits, 0);
  assert.equal(summary.homeVisits, 0);
  assert.deepEqual(summary.bySource, []);
  assert.deepEqual(summary.topPosts, []);
  assert.equal(summary.hiddenPostCount, 0);
  assert.equal(summary.hiddenPostVisits, 0);
  assert.equal(summary.daily.length, 30);
  assert.equal(summary.daily[0].date, '2026-06-27');
  assert.equal(summary.daily[29].date, END);
  assert.equal(summary.daily.every((d) => d.visits === 0), true);
});

test('normalizeAiReferralSummary: 형태가 어긋난 입력도 throw 없이 빈 요약이 된다', () => {
  for (const raw of ['nope', 42, [], undefined, { by_source: 'x', daily: 3, top_posts: null }]) {
    const summary = normalizeAiReferralSummary(raw, { endDate: END, windowDays: 7 });
    assert.equal(summary.totalVisits, 0, JSON.stringify(raw));
    assert.equal(summary.daily.length, 7);
  }
});

test('emptyAiReferralSummary: 폴백 값도 동일한 형태다', () => {
  const summary = emptyAiReferralSummary(END);
  assert.equal(summary.windowDays, AI_REFERRAL_WINDOW_DAYS);
  assert.equal(summary.totalVisits, 0);
  assert.equal(summary.daily.length, AI_REFERRAL_WINDOW_DAYS);
});

test('normalizeAiReferralSummary: 잘못된 endDate 도 throw 하지 않는다', () => {
  const summary = normalizeAiReferralSummary(null, { endDate: 'nope', windowDays: 7 });
  assert.equal(summary.daily.length, 7);
});

// ---------------------------------------------------------------------------
// 정규화
// ---------------------------------------------------------------------------

test('normalizeAiReferralSummary: DB 집계 결과를 화면 모델로 옮긴다', () => {
  const raw = {
    total_visits: 11,
    home_visits: 6,
    post_visits: 5,
    post_count: 2,
    by_source: [
      { source: 'chatgpt', visits: 9 },
      { source: 'claude', visits: 1 },
      { source: 'perplexity', visits: 1 },
    ],
    daily: [
      { date: '2026-07-26', visits: 4 },
      { date: '2026-07-25', visits: 6 },
      { date: '2026-07-20', visits: 1 },
    ],
    top_posts: [
      { post_id: 'p1', title: '보톡스 글', visits: 4 },
      { post_id: 'p2', title: '필러 글', visits: 1 },
    ],
  };
  const summary = normalizeAiReferralSummary(raw, { endDate: END, windowDays: 30 });

  assert.equal(summary.totalVisits, 11);
  assert.equal(summary.homeVisits, 6);
  assert.deepEqual(
    summary.bySource.map((s) => [s.source, s.label, s.visits]),
    [['chatgpt', 'ChatGPT', 9], ['claude', 'Claude', 1], ['perplexity', 'Perplexity', 1]],
  );

  const daily = new Map(summary.daily.map((d) => [d.date, d.visits]));
  assert.equal(daily.get('2026-07-26'), 4);
  assert.equal(daily.get('2026-07-25'), 6);
  assert.equal(daily.get('2026-07-20'), 1);
  assert.equal(daily.get('2026-07-21'), 0); // 빈 날은 0 으로 채워진다
  assert.equal(summary.daily.length, 30);
});

test('normalizeAiReferralSummary: numeric 이 문자열로 와도 숫자로 다룬다', () => {
  const summary = normalizeAiReferralSummary(
    { total_visits: '7', home_visits: '2', by_source: [{ source: 'chatgpt', visits: '7' }] },
    { endDate: END, windowDays: 30 },
  );
  assert.equal(summary.totalVisits, 7);
  assert.equal(summary.homeVisits, 2);
  assert.equal(summary.bySource[0].visits, 7);
});

test('normalizeAiReferralSummary: 창 밖 날짜·비정상 수치는 버린다', () => {
  const summary = normalizeAiReferralSummary(
    {
      total_visits: 2,
      daily: [
        { date: '2026-05-01', visits: 100 }, // 창 밖
        { date: 'garbage', visits: 100 },    // 형식 오류
        { date: '2026-07-26', visits: -5 },  // 음수 → 0
        { date: '2026-07-25', visits: 2 },
      ],
    },
    { endDate: END, windowDays: 30 },
  );
  const daily = new Map(summary.daily.map((d) => [d.date, d.visits]));
  assert.equal(daily.get('2026-07-26'), 0);
  assert.equal(daily.get('2026-07-25'), 2);
  assert.equal(summary.daily.reduce((s, d) => s + d.visits, 0), 2);
});

// ---------------------------------------------------------------------------
// 소수 셀 숨김 (최소 집계 규칙)
// ---------------------------------------------------------------------------

test('normalizeAiReferralSummary: 최소 집계치 미만 글은 개별 표시하지 않고 묶는다', () => {
  const summary = normalizeAiReferralSummary(
    {
      total_visits: 9,
      home_visits: 2,
      post_visits: 7,
      post_count: 4,
      top_posts: [
        { post_id: 'p1', title: '글A', visits: 4 },
        { post_id: 'p2', title: '글B', visits: 1 },
        { post_id: 'p3', title: '글C', visits: 1 },
      ],
    },
    { endDate: END, windowDays: 30, minPostCell: 2 },
  );
  // 1회짜리는 개별 노출하지 않는다
  assert.deepEqual(summary.topPosts.map((p) => p.postId), ['p1']);
  // 숨겨진 글은 개수·합계로만 남는다 (top N 밖 글 포함 → 4 - 1 = 3편, 7 - 4 = 3회)
  assert.equal(summary.hiddenPostCount, 3);
  assert.equal(summary.hiddenPostVisits, 3);
  // 총합·출처별 수치는 글 단위가 아니라 영향받지 않는다
  assert.equal(summary.totalVisits, 9);
  assert.equal(summary.homeVisits, 2);
});

test('normalizeAiReferralSummary: 전부 소수 셀이면 목록이 비고 합계만 남는다', () => {
  const summary = normalizeAiReferralSummary(
    {
      total_visits: 2,
      post_visits: 2,
      post_count: 2,
      top_posts: [
        { post_id: 'p1', title: '글A', visits: 1 },
        { post_id: 'p2', title: '글B', visits: 1 },
      ],
    },
    { endDate: END, windowDays: 30 },
  );
  assert.deepEqual(summary.topPosts, []);
  assert.equal(summary.hiddenPostCount, 2);
  assert.equal(summary.hiddenPostVisits, 2);
});

test('최소 집계치 기본값은 1보다 커야 한다 (소수 셀 완충이 실제로 동작)', () => {
  assert.ok(AI_REFERRAL_MIN_POST_CELL >= 2);
});
