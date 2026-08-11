import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FUNNEL_DAILY_WINDOW_DAYS,
  funnelWindowStartUtcIso,
  aggregateFunnelStats,
  type FunnelStatRow,
} from '../funnel-admin-stats.ts';

// 고정 현재 시각: 2026-07-24T03:00:00Z = KST 2026-07-24 12:00
const NOW = Date.parse('2026-07-24T03:00:00Z');

function row(
  event: string,
  createdAt: string,
  anonId: string | null = null,
  userId: string | null = null,
): FunnelStatRow {
  return { event, created_at: createdAt, anon_id: anonId, user_id: userId };
}

// ── funnelWindowStartUtcIso: KST 자정 경계 → UTC 변환 ──
test('funnelWindowStartUtcIso: 14일 창 시작 = 13일 전 KST 자정 (UTC 로 -9h)', () => {
  // 오늘 KST 7/24 → 창 첫날 KST 7/11 자정 = UTC 7/10 15:00
  assert.equal(funnelWindowStartUtcIso(NOW, 14), '2026-07-10T15:00:00.000Z');
  assert.equal(funnelWindowStartUtcIso(NOW, 1), '2026-07-23T15:00:00.000Z');
});

// ── aggregateFunnelStats: 종합 시나리오 ──
test('aggregateFunnelStats: KST 귀속·고유 dedup·창 경계·오염 이벤트 무시', () => {
  const rows: FunnelStatRow[] = [
    // 오늘(KST 7/24): UTC 7/23 16:00 = KST 7/24 01:00 — KST 경계 검증
    row('landing_view', '2026-07-23T16:00:00Z', 'a'.repeat(32)),
    row('landing_view', '2026-07-24T01:00:00Z', 'a'.repeat(32)), // 동일 anon 중복 방문
    row('landing_view', '2026-07-24T02:00:00Z', 'b'.repeat(32)),
    row('landing_view', '2026-07-24T02:30:00Z', null), // anon 없음 → 방문 수만
    // 7일 창 내 과거일 (KST 7/20)
    row('landing_view', '2026-07-20T05:00:00Z', 'c'.repeat(32)),
    // 14일 창 내·7일 창 밖 (KST 7/13)
    row('landing_view', '2026-07-13T05:00:00Z', 'd'.repeat(32)),
    // 14일 창 밖 → 완전 무시
    row('landing_view', '2026-07-05T05:00:00Z', 'e'.repeat(32)),
    // 진단 퍼널 (랜딩 첫 화면 → /clinic-check) — 입력 2명, 제출·실행·결과 각 1명
    row('diagnosis_input_start', '2026-07-24T02:00:00Z', 'a'.repeat(32)),
    row('diagnosis_input_start', '2026-07-24T02:05:00Z', 'b'.repeat(32)),
    row('diagnosis_submit', '2026-07-24T02:06:00Z', 'b'.repeat(32)),
    row('diagnosis_run', '2026-07-24T02:06:30Z', 'b'.repeat(32)),
    row('diagnosis_report_view', '2026-07-24T02:07:00Z', 'b'.repeat(32)),
    row('diagnosis_email_submitted', '2026-07-24T02:08:00Z', 'b'.repeat(32)),
    // 가입 시작 — 동일 anon 이틀 연속 → 고유 1
    row('signup_start', '2026-07-24T02:00:00Z', 'a'.repeat(32)),
    row('signup_start', '2026-07-23T02:00:00Z', 'a'.repeat(32)),
    // 서버 확정 이벤트 (user_id 귀속)
    row('signup_complete', '2026-07-24T02:00:00Z', null, 'user-1'),
    row('first_post_generated', '2026-07-24T02:10:00Z', null, 'user-1'),
    row('payment_success', '2026-07-24T02:20:00Z', null, 'user-1'),
    row('payment_success', '2026-07-22T02:20:00Z', null, 'user-2'),
    // 오염: 화이트리스트 외 이벤트·파싱 불가 날짜 → 무시
    row('bogus_event', '2026-07-24T02:00:00Z', 'f'.repeat(32)),
    row('landing_view', 'not-a-date', 'g'.repeat(32)),
  ];

  const stats = aggregateFunnelStats(rows, NOW);

  // 오늘: 고유 anon 2 (a·b), 방문 수 4 (null anon 포함)
  assert.equal(stats.todayVisitors, 2);
  assert.equal(stats.todayViews, 4);

  // 일별 추이: 14포인트, 과거→오늘 순
  assert.equal(stats.daily.length, FUNNEL_DAILY_WINDOW_DAYS);
  assert.equal(stats.daily[stats.daily.length - 1].day, '2026-07-24');
  assert.equal(stats.daily[stats.daily.length - 1].visitors, 2);
  assert.equal(stats.daily[stats.daily.length - 1].views, 4);
  const d20 = stats.daily.find((d) => d.day === '2026-07-20');
  assert.equal(d20?.visitors, 1);
  const d13 = stats.daily.find((d) => d.day === '2026-07-13');
  assert.equal(d13?.visitors, 1); // 14일 창 안이므로 일별엔 포함
  assert.equal(stats.daily.some((d) => d.day === '2026-07-05'), false);

  // 주간 퍼널 (KST 7/18~7/24): 방문 3(a·b·c, d 는 7일 밖·null 제외)
  // → 진단 입력 2 → 제출 1 → 실행 1 → 결과 1
  // → 가입시작 1 → 가입완료 1 → 첫 글 1 → 결제 2
  assert.deepEqual(
    stats.weekly.map((s) => [s.stage, s.count]),
    [
      ['landing_view', 3],
      ['diagnosis_input_start', 2],
      ['diagnosis_submit', 1],
      ['diagnosis_run', 1],
      ['diagnosis_report_view', 1],
      ['diagnosis_email_submitted', 1],
      ['diagnosis_cta_view', 0],
      ['diagnosis_cta_click', 0],
      ['pricing_view', 0],
      ['signup_start', 1],
      ['signup_complete', 1],
      ['first_post_generated', 1],
      ['payment_success', 2],
    ],
  );

  // 인식된 창 내 이벤트 수 (창 밖·bogus·파싱 불가 제외)
  assert.equal(stats.totalEvents, 18);
});

// ── 빈 상태 ──
test('aggregateFunnelStats: 데이터 없음 → totalEvents 0·전 단계 0 (빈 상태 판정)', () => {
  const stats = aggregateFunnelStats([], NOW);
  assert.equal(stats.totalEvents, 0);
  assert.equal(stats.todayVisitors, 0);
  assert.equal(stats.todayViews, 0);
  assert.equal(stats.daily.length, FUNNEL_DAILY_WINDOW_DAYS);
  assert.equal(stats.weekly.length, 13);
  assert.equal(stats.weekly.every((s) => s.count === 0), true);
});
