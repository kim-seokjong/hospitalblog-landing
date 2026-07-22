import test from 'node:test';
import assert from 'node:assert/strict';
import {
  kstDayNumber,
  daysUntilKST,
  isDMinus3Window,
  findTrialReportTargets,
  buildTrialReportSummary,
  buildTrialReportEmail,
  buildTrialReportAdminDigest,
  TRIAL_REPORT_WINDOW_DAYS,
  type TrialCandidate,
  type TrialReportInput,
} from '../trial-report.ts';

// ── kstDayNumber / daysUntilKST ──
test('kstDayNumber: 잘못된 값은 null', () => {
  assert.equal(kstDayNumber('not-a-date'), null);
  assert.equal(typeof kstDayNumber('2026-07-22T00:00:00Z'), 'number');
});

test('daysUntilKST: KST 캘린더 일수 차이', () => {
  const now = new Date('2026-07-22T01:00:00Z'); // KST 10:00 7/22
  // KST 7/25 09:00 == UTC 7/25 00:00 → 3일 뒤
  assert.equal(daysUntilKST('2026-07-25T00:00:00Z', now), 3);
  assert.equal(daysUntilKST('2026-07-22T10:00:00Z', now), 0); // KST 7/22 19:00 = 같은 KST 날짜
  assert.equal(daysUntilKST(null, now), null);
});

test('isDMinus3Window: 정확히 D-3 만 true', () => {
  const now = new Date('2026-07-22T01:00:00Z');
  assert.equal(isDMinus3Window('2026-07-25T00:00:00Z', now), true); // +3
  assert.equal(isDMinus3Window('2026-07-24T00:00:00Z', now), false); // +2
  assert.equal(isDMinus3Window('2026-07-26T00:00:00Z', now), false); // +4
  assert.equal(TRIAL_REPORT_WINDOW_DAYS, 3);
});

// ── findTrialReportTargets ──
test('findTrialReportTargets: D-3 만 남기고 userId 중복 제거', () => {
  const now = new Date('2026-07-22T01:00:00Z');
  const plus3 = '2026-07-25T00:00:00Z';
  const plus2 = '2026-07-24T00:00:00Z';
  const candidates: TrialCandidate[] = [
    { userId: 'u1', email: 'a@x.com', hospitalName: 'A', expiresAt: plus3, source: 'trial_until' },
    { userId: 'u1', email: 'a@x.com', hospitalName: 'A', expiresAt: plus3, source: 'plan_expires_at' }, // 중복
    { userId: 'u2', email: 'b@x.com', hospitalName: 'B', expiresAt: plus2, source: 'trial_until' }, // D-2 제외
    { userId: 'u3', email: null, hospitalName: null, expiresAt: plus3, source: 'plan_expires_at' },
    { userId: '', email: null, hospitalName: null, expiresAt: plus3, source: 'trial_until' }, // 빈 id 제외
  ];
  const targets = findTrialReportTargets(candidates, now);
  assert.deepEqual(
    targets.map((t) => t.userId),
    ['u1', 'u3'],
  );
  assert.equal(targets[0].source, 'trial_until'); // 먼저 등장한 소스 유지
  assert.equal(targets[0].daysLeft, 3);
});

// ── buildTrialReportSummary ──
function baseInput(): TrialReportInput {
  return {
    hospitalName: '바르다권치과',
    postsCreated: 14,
    postsPublished: 8,
    trackedKeywords: 5,
    top10Count: 2,
    geoCitedCount: 1,
    geoReadiness: 70,
    topKeyword: '임플란트',
  };
}

test('buildTrialReportSummary: 성과 있는 회원 프레이밍', () => {
  const s = buildTrialReportSummary(baseInput());
  assert.match(s.headline, /14개/);
  assert.ok(s.lines.some((l) => l.includes('14개')));
  assert.ok(s.lines.some((l) => l.includes('발행')));
  assert.ok(s.lines.some((l) => l.includes('상위 10위')));
  assert.ok(s.lines.some((l) => l.includes('AI 검색')));
  assert.match(s.closing, /3일 뒤/);
});

test('buildTrialReportSummary: 글 0개면 "시작 유도" 분기', () => {
  const s = buildTrialReportSummary({ ...baseInput(), postsCreated: 0 });
  assert.match(s.headline, /3일 뒤 종료/);
  assert.ok(s.lines.length >= 1);
});

test('buildTrialReportSummary: GEO 인용 0 이면 준비도 점수로 대체', () => {
  const s = buildTrialReportSummary({ ...baseInput(), geoCitedCount: 0, geoReadiness: 55 });
  assert.ok(s.lines.some((l) => l.includes('55점')));
  assert.ok(!s.lines.some((l) => l.includes('인용')));
});

// ── 이메일 조립 ──
test('buildTrialReportEmail: 제목·HTML 생성, XSS 이스케이프', () => {
  const s = buildTrialReportSummary({ ...baseInput(), hospitalName: '<script>x</script>치과' });
  const email = buildTrialReportEmail(s);
  assert.ok(email.subject.length > 0);
  assert.ok(email.html.includes('<h2'));
  assert.ok(!email.html.includes('<script>x</script>')); // 이스케이프됨
});

test('buildTrialReportAdminDigest: 대상 0건/N건', () => {
  const empty = buildTrialReportAdminDigest([]);
  assert.match(empty.subject, /대상 없음/);
  const digest = buildTrialReportAdminDigest([
    { hospitalName: 'A치과', email: 'a@x.com', postsCreated: 14, headline: '당신이 만든 글 14개' },
  ]);
  assert.match(digest.subject, /1건/);
  assert.ok(digest.html.includes('A치과'));
});
