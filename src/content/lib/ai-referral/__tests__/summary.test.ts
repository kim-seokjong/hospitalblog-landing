import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shiftDateKey,
  aiReferralWindowStart,
  summarizeAiReferrals,
  emptyAiReferralSummary,
  AI_REFERRAL_WINDOW_DAYS,
  type AiReferralDbRow,
} from '../summary.ts';

const END = '2026-07-26';

function row(over: Partial<AiReferralDbRow> & { visitDate: string }): AiReferralDbRow {
  return {
    source: 'chatgpt',
    postId: null,
    postTitle: null,
    visits: 1,
    ...over,
  };
}

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
// 0건 상태 — 초기에는 대부분 0이다
// ---------------------------------------------------------------------------

test('summarizeAiReferrals: 행이 0건이어도 형태가 온전한 결과를 준다', () => {
  const summary = summarizeAiReferrals([], { endDate: END, windowDays: 30 });
  assert.equal(summary.totalVisits, 0);
  assert.equal(summary.homeVisits, 0);
  assert.deepEqual(summary.bySource, []);
  assert.deepEqual(summary.topPosts, []);
  assert.equal(summary.daily.length, 30);
  assert.equal(summary.daily[0].date, '2026-06-27');
  assert.equal(summary.daily[29].date, END);
  assert.equal(summary.daily.every((d) => d.visits === 0), true);
});

test('emptyAiReferralSummary: 마이그 미적용 폴백 값도 동일한 형태다', () => {
  const summary = emptyAiReferralSummary(END);
  assert.equal(summary.windowDays, AI_REFERRAL_WINDOW_DAYS);
  assert.equal(summary.totalVisits, 0);
  assert.equal(summary.daily.length, AI_REFERRAL_WINDOW_DAYS);
});

// ---------------------------------------------------------------------------
// 집계
// ---------------------------------------------------------------------------

test('summarizeAiReferrals: 출처별·일자별·글별로 합산한다', () => {
  const rows: AiReferralDbRow[] = [
    row({ visitDate: '2026-07-26', source: 'chatgpt', visits: 3 }),
    row({ visitDate: '2026-07-26', source: 'perplexity', visits: 1 }),
    row({ visitDate: '2026-07-25', source: 'chatgpt', visits: 2 }),
    row({ visitDate: '2026-07-25', source: 'chatgpt', visits: 4, postId: 'p1', postTitle: '보톡스 글' }),
    row({ visitDate: '2026-07-20', source: 'claude', visits: 1, postId: 'p2', postTitle: '필러 글' }),
  ];
  const summary = summarizeAiReferrals(rows, { endDate: END, windowDays: 30 });

  assert.equal(summary.totalVisits, 11);
  assert.equal(summary.homeVisits, 6); // postId 없는 3+1+2
  // 많은 순 → 동점은 id 사전순(결정적 정렬)
  assert.deepEqual(
    summary.bySource.map((s) => [s.source, s.visits]),
    [['chatgpt', 9], ['claude', 1], ['perplexity', 1]],
  );
  assert.equal(summary.bySource[0].label, 'ChatGPT');

  const daily = new Map(summary.daily.map((d) => [d.date, d.visits]));
  assert.equal(daily.get('2026-07-26'), 4);
  assert.equal(daily.get('2026-07-25'), 6);
  assert.equal(daily.get('2026-07-20'), 1);
  assert.equal(daily.get('2026-07-21'), 0);

  assert.deepEqual(
    summary.topPosts.map((p) => [p.postId, p.title, p.visits]),
    [['p1', '보톡스 글', 4], ['p2', '필러 글', 1]],
  );
});

test('summarizeAiReferrals: 같은 글의 여러 출처·날짜 행을 하나로 합친다', () => {
  const rows: AiReferralDbRow[] = [
    row({ visitDate: '2026-07-26', source: 'chatgpt', visits: 2, postId: 'p1', postTitle: '글A' }),
    row({ visitDate: '2026-07-25', source: 'perplexity', visits: 5, postId: 'p1', postTitle: '글A' }),
  ];
  const summary = summarizeAiReferrals(rows, { endDate: END, windowDays: 30 });
  assert.deepEqual(summary.topPosts, [{ postId: 'p1', title: '글A', visits: 7 }]);
});

test('summarizeAiReferrals: 창 밖·형식 오류·비정상 수치 행은 조용히 버린다', () => {
  const rows: AiReferralDbRow[] = [
    row({ visitDate: '2026-05-01', visits: 100 }),   // 창 밖(30일 이전)
    row({ visitDate: '2026-08-01', visits: 100 }),   // 창 밖(미래)
    row({ visitDate: 'garbage', visits: 100 }),      // 형식 오류
    row({ visitDate: '2026-07-26', visits: -5 }),    // 음수
    row({ visitDate: '2026-07-26', visits: Number.NaN }),
    row({ visitDate: '2026-07-26', visits: 2 }),     // 유일한 유효 행
  ];
  const summary = summarizeAiReferrals(rows, { endDate: END, windowDays: 30 });
  assert.equal(summary.totalVisits, 2);
});

test('summarizeAiReferrals: 상위 글은 개수 상한을 지킨다', () => {
  const rows: AiReferralDbRow[] = Array.from({ length: 12 }, (_, i) =>
    row({ visitDate: END, visits: i + 1, postId: `p${i}`, postTitle: `글${i}` }),
  );
  const summary = summarizeAiReferrals(rows, { endDate: END, windowDays: 30, topPosts: 5 });
  assert.equal(summary.topPosts.length, 5);
  assert.equal(summary.topPosts[0].visits, 12);
});

test('summarizeAiReferrals: 잘못된 endDate 도 throw 하지 않는다', () => {
  const summary = summarizeAiReferrals([], { endDate: 'nope', windowDays: 7 });
  assert.equal(summary.daily.length, 7);
  assert.equal(summary.totalVisits, 0);
});
