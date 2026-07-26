import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MONTHLY_REPORT_VERSION,
  isValidPeriod,
  previousPeriodKST,
  periodRangeKST,
  periodLabel,
  periodMonth,
  aggregateRankings,
  buildRecommendedActions,
  buildReportData,
  monthlyReportNotification,
  type RankingPointRow,
  type ActionInput,
  type BuildReportInput,
} from '../monthly-report.ts';

// ── isValidPeriod: YYYY-MM 형식 검증 ──
test('isValidPeriod: 올바른 형식은 통과', () => {
  assert.equal(isValidPeriod('2026-06'), true);
  assert.equal(isValidPeriod('2026-01'), true);
  assert.equal(isValidPeriod('2026-12'), true);
});

test('isValidPeriod: 잘못된 형식은 거부', () => {
  assert.equal(isValidPeriod('2026-13'), false);
  assert.equal(isValidPeriod('2026-00'), false);
  assert.equal(isValidPeriod('2026-6'), false);
  assert.equal(isValidPeriod('202606'), false);
  assert.equal(isValidPeriod('2026-06-01'), false);
  assert.equal(isValidPeriod(''), false);
  assert.equal(isValidPeriod('abcd-ef'), false);
});

// ── previousPeriodKST: KST 기준 지난달 ──
test('previousPeriodKST: 매월 1일 00:00 UTC 실행 시 지난달을 가리킨다', () => {
  // 2026-07-01 00:00 UTC = 2026-07-01 09:00 KST → 지난달 = 2026-06
  assert.equal(previousPeriodKST(new Date('2026-07-01T00:00:00Z')), '2026-06');
});

test('previousPeriodKST: 연 경계 (1월 → 지난해 12월)', () => {
  assert.equal(previousPeriodKST(new Date('2026-01-01T00:00:00Z')), '2025-12');
});

test('previousPeriodKST: UTC/KST 날짜가 갈리는 시각은 KST 기준으로 판정', () => {
  // 2025-12-31 15:30 UTC = 2026-01-01 00:30 KST → KST로는 이미 1월 → 지난달 = 2025-12
  assert.equal(previousPeriodKST(new Date('2025-12-31T15:30:00Z')), '2025-12');
  // 2025-12-31 14:30 UTC = 2025-12-31 23:30 KST → KST로 아직 12월 → 지난달 = 2025-11
  assert.equal(previousPeriodKST(new Date('2025-12-31T14:30:00Z')), '2025-11');
});

// ── periodRangeKST: KST 월 경계 → UTC ISO 범위 ──
test('periodRangeKST: KST 자정 경계가 UTC-9시간으로 변환된다', () => {
  const range = periodRangeKST('2026-06');
  assert.ok(range);
  assert.equal(range.startIso, '2026-05-31T15:00:00.000Z'); // 2026-06-01 00:00 KST
  assert.equal(range.endIso, '2026-06-30T15:00:00.000Z');   // 2026-07-01 00:00 KST
});

test('periodRangeKST: 12월은 다음 해 1월 시작 전까지', () => {
  const range = periodRangeKST('2025-12');
  assert.ok(range);
  assert.equal(range.startIso, '2025-11-30T15:00:00.000Z');
  assert.equal(range.endIso, '2025-12-31T15:00:00.000Z');
});

test('periodRangeKST: 잘못된 형식은 null', () => {
  assert.equal(periodRangeKST('2026-13'), null);
  assert.equal(periodRangeKST('nope'), null);
});

// ── periodLabel / periodMonth ──
test('periodLabel: 한국어 표기', () => {
  assert.equal(periodLabel('2026-06'), '2026년 6월');
  assert.equal(periodLabel('2026-12'), '2026년 12월');
});

test('periodMonth: 월 숫자 추출, 형식 오류는 null', () => {
  assert.equal(periodMonth('2026-06'), 6);
  assert.equal(periodMonth('bad'), null);
});

// ── aggregateRankings ──
function point(
  postId: string | null,
  keyword: string,
  rank: number | null,
  day: number,
): RankingPointRow {
  return {
    postId,
    keyword,
    rank,
    checkedAt: `2026-06-${String(day).padStart(2, '0')}T09:00:00Z`,
  };
}

// ★ 순위는 "글 × 키워드" 단위로 기록된다. postId 로만 묶으면 시계열 첫 점이 키워드 A,
//   마지막 점이 키워드 B 가 되어 존재하지 않는 "급상승"이 만들어진다.
test('★ 같은 글의 서로 다른 키워드를 한 시계열로 섞지 않는다', () => {
  const agg = aggregateRankings([
    point('p1', '임플란트', 150, 1),   // A 키워드: 계속 150위
    point('p1', '건강보험', 3, 28),    // B 키워드: 계속 3위
  ]);
  // 키워드별로 관측이 1회씩뿐이라 "상승"으로 볼 근거가 없다
  assert.equal(agg.improved.length, 0, '키워드가 섞여 허위 상승이 생기면 안 된다');
  assert.equal(agg.trackedKeywords, 2);
  assert.equal(agg.top10Count, 1, '글 단위 집계 — 한 편이 10위 안');
});

test('★ 키워드별로 각각 상승했어도 글은 목록에 1번만 (화면 key=postId)', () => {
  const agg = aggregateRankings([
    point('p1', '임플란트', 90, 1), point('p1', '임플란트', 40, 28),   // delta 50
    point('p1', '건강보험', 80, 1), point('p1', '건강보험', 20, 28),   // delta 60
    point('p2', '치아교정', 70, 1), point('p2', '치아교정', 65, 28),   // delta 5
  ]);
  const p1Entries = agg.improved.filter((i) => i.postId === 'p1');
  assert.equal(p1Entries.length, 1, '같은 글이 중복으로 들어가면 안 된다');
  assert.equal(p1Entries[0].keyword, '건강보험', '상승 폭이 큰 키워드가 대표');
  assert.equal(agg.improved[0].postId, 'p1');
});

test('같은 글의 여러 키워드가 10위 안이어도 top10 은 1편으로 센다', () => {
  const agg = aggregateRankings([
    point('p1', '임플란트', 3, 1),
    point('p1', '건강보험', 5, 1),
  ]);
  assert.equal(agg.top10Count, 1);
});

test('aggregateRankings: 빈 입력은 전부 0', () => {
  const agg = aggregateRankings([]);
  assert.equal(agg.trackedKeywords, 0);
  assert.equal(agg.top10Count, 0);
  assert.deepEqual(agg.improved, []);
});

test('aggregateRankings: 키워드는 중복 제거, 빈 키워드 제외', () => {
  const agg = aggregateRankings([
    point('p1', '임플란트', 5, 1),
    point('p1', '임플란트', 4, 2),
    point('p2', '충치치료', 20, 1),
    point('p3', '  ', null, 1),
  ]);
  assert.equal(agg.trackedKeywords, 2);
});

test('aggregateRankings: 월중 최고 순위 10위 이내면 top10 집계', () => {
  const agg = aggregateRankings([
    point('p1', 'a', 8, 1),   // 진입 (best 8)
    point('p1', 'a', 15, 2),
    point('p2', 'b', 11, 1),  // 미진입 (best 11)
    point('p3', 'c', null, 1) // 순위 관측 없음
  ]);
  assert.equal(agg.top10Count, 1);
});

test('aggregateRankings: 순위 상승 글은 월초→월말 비교, 상승 폭 큰 순 정렬', () => {
  const agg = aggregateRankings([
    point('p1', 'a', 30, 1), point('p1', 'a', 10, 30), // +20
    point('p2', 'b', 15, 1), point('p2', 'b', 12, 30), // +3
    point('p3', 'c', 5, 1),  point('p3', 'c', 9, 30),  // 하락 → 제외
    point('p4', 'd', 7, 1),                            // 관측 1회 → 제외
  ]);
  assert.deepEqual(
    agg.improved.map((p) => p.postId),
    ['p1', 'p2'],
  );
  assert.equal(agg.improved[0].fromRank, 30);
  assert.equal(agg.improved[0].toRank, 10);
});

test('aggregateRankings: null 순위(미발견)는 상승 비교에서 무시된다', () => {
  const agg = aggregateRankings([
    point('p1', 'a', null, 1),
    point('p1', 'a', 20, 5),
    point('p1', 'a', 10, 20),
    point('p1', 'a', null, 30),
  ]);
  assert.equal(agg.improved.length, 1);
  assert.equal(agg.improved[0].fromRank, 20);
  assert.equal(agg.improved[0].toRank, 10);
});

test('aggregateRankings: 상승 글은 최대 5건까지만', () => {
  const rows: RankingPointRow[] = [];
  for (let i = 1; i <= 7; i += 1) {
    rows.push(point(`p${i}`, `k${i}`, 50, 1));
    rows.push(point(`p${i}`, `k${i}`, 50 - i, 30)); // p7이 가장 큰 상승
  }
  const agg = aggregateRankings(rows);
  assert.equal(agg.improved.length, 5);
  assert.equal(agg.improved[0].postId, 'p7');
});

test('aggregateRankings: postId 없는 행은 글 집계에서 제외하되 키워드는 집계', () => {
  const agg = aggregateRankings([point(null, '도수치료', 3, 1)]);
  assert.equal(agg.trackedKeywords, 1);
  assert.equal(agg.top10Count, 0);
  assert.equal(agg.improved.length, 0);
});

// ── buildRecommendedActions: 규칙 분기 ──
function actionInput(overrides: Partial<ActionInput> = {}): ActionInput {
  return {
    blogConfigured: true,
    postsCreated: 5,
    postsPublished: 3,
    trackedKeywords: 3,
    top10Count: 0,
    monthlyLimit: -1,
    generated: 5,
    ...overrides,
  };
}

test('buildRecommendedActions: 항상 1~3개를 반환한다', () => {
  // 모든 규칙이 걸리는 케이스도 3개로 캡
  const many = buildRecommendedActions(actionInput({
    blogConfigured: false,
    postsCreated: 0,
    top10Count: 2,
    monthlyLimit: 20,
    generated: 3,
  }));
  assert.ok(many.length >= 1 && many.length <= 3);
  // 아무 규칙도 안 걸리면 기본 액션 1개
  const none = buildRecommendedActions(actionInput());
  assert.equal(none.length, 1);
  assert.match(none[0], /꾸준한 발행/);
});

test('buildRecommendedActions: 블로그 미등록이 최우선', () => {
  const actions = buildRecommendedActions(actionInput({ blogConfigured: false }));
  assert.match(actions[0], /블로그 주소를 등록/);
});

test('buildRecommendedActions: 글 생성 0건 → 생성 시작 권유', () => {
  const actions = buildRecommendedActions(actionInput({ postsCreated: 0, postsPublished: 0, trackedKeywords: 0 }));
  assert.ok(actions.some((a) => /글 생성을 시작/.test(a)));
});

test('buildRecommendedActions: 생성했지만 발행 0건 → 발행 권유', () => {
  const actions = buildRecommendedActions(actionInput({ postsCreated: 4, postsPublished: 0, trackedKeywords: 0 }));
  assert.ok(actions.some((a) => /발행하면/.test(a)));
});

test('buildRecommendedActions: 발행했지만 추적 키워드 0 → 키워드 설정 권유', () => {
  const actions = buildRecommendedActions(actionInput({ trackedKeywords: 0 }));
  assert.ok(actions.some((a) => /핵심 키워드를 설정/.test(a)));
});

test('buildRecommendedActions: 상위 10위 진입 시 연관 키워드 확장 권유', () => {
  const actions = buildRecommendedActions(actionInput({ top10Count: 2 }));
  assert.ok(actions.some((a) => /연관 키워드/.test(a)));
});

test('buildRecommendedActions: 한도 미소진 시 잔여 횟수 안내 (무제한/플랜 없음은 제외)', () => {
  const remaining = buildRecommendedActions(actionInput({ monthlyLimit: 20, generated: 12 }));
  assert.ok(remaining.some((a) => a.includes('8회')));
  const unlimited = buildRecommendedActions(actionInput({ monthlyLimit: -1, generated: 12 }));
  assert.ok(!unlimited.some((a) => /사용하지 않았습니다/.test(a)));
  const noPlan = buildRecommendedActions(actionInput({ monthlyLimit: 0, generated: 0, postsCreated: 1 }));
  assert.ok(!noPlan.some((a) => /사용하지 않았습니다/.test(a)));
});

// ── buildReportData ──
function reportInput(overrides: Partial<BuildReportInput> = {}): BuildReportInput {
  return {
    period: '2026-06',
    generatedAt: '2026-07-01T00:00:00.000Z',
    postsCreated: 6,
    postsPublished: 4,
    complianceChecked: 6,
    rankings: { trackedKeywords: 3, top10Count: 1, improved: [] },
    improvedPosts: [
      { postId: 'p1', title: '임플란트 관리법', keyword: '임플란트', fromRank: 30, toRank: 10 },
    ],
    generated: 6,
    monthlyLimit: 20,
    planName: '스탠다드',
    blogConfigured: true,
    ...overrides,
  };
}

test('buildReportData: 스냅샷 필드가 전부 채워진다', () => {
  const data = buildReportData(reportInput());
  assert.equal(data.version, MONTHLY_REPORT_VERSION);
  assert.equal(data.period, '2026-06');
  assert.equal(data.posts.created, 6);
  assert.equal(data.posts.published, 4);
  assert.equal(data.compliance.checked, 6);
  assert.equal(data.rankings.trackedKeywords, 3);
  assert.equal(data.rankings.top10Count, 1);
  assert.equal(data.rankings.improved.length, 1);
  assert.equal(data.usage.generated, 6);
  assert.equal(data.usage.monthlyLimit, 20);
  assert.equal(data.usage.planName, '스탠다드');
  assert.ok(data.actions.length >= 1 && data.actions.length <= 3);
});

// ── monthlyReportNotification ──
test('monthlyReportNotification: 제목에 월, 본문에 핵심 지표 포함', () => {
  const data = buildReportData(reportInput());
  const { title, message } = monthlyReportNotification('2026-06', data);
  assert.equal(title, '6월 성과 리포트가 도착했어요');
  assert.ok(message.includes('글 생성 6회'));
  assert.ok(message.includes('발행 4건'));
  assert.ok(message.includes('의료광고법 검사 6건'));
  assert.ok(message.includes('상위 10위 진입 1건'));
  assert.ok(message.includes('성과 리포트 탭'));
});

test('monthlyReportNotification: 상위 10위 0건이면 해당 문구 생략', () => {
  const data = buildReportData(reportInput({
    rankings: { trackedKeywords: 0, top10Count: 0, improved: [] },
    improvedPosts: [],
  }));
  const { message } = monthlyReportNotification('2026-06', data);
  assert.ok(!message.includes('상위 10위'));
});
