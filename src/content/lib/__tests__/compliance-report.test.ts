import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildComplianceReport,
  computeComplianceGrade,
  validateComplianceReport,
  computeRiskScore,
  isCooldownActive,
  cooldownEndsAt,
  buildExcerpt,
  buildAuditPost,
  applyAiFindings,
  isRiskyGrade,
  buildAuditResults,
  COMPLIANCE_ENGINE_VERSION,
  COMPLIANCE_REPORT_SCHEMA_VERSION,
  AUDIT_COOLDOWN_HOURS,
} from '../compliance-report.ts';

/* ─── computeComplianceGrade — 최종 등급 산정 ─── */

test('computeComplianceGrade: 검출 없음은 PASS', () => {
  assert.equal(computeComplianceGrade({ violations: [], warnings: [] }), 'PASS');
});

test('computeComplianceGrade: CRITICAL 위반이 최우선', () => {
  const grade = computeComplianceGrade({
    violations: [{ severity: 'CRITICAL' }, { severity: 'MEDIUM' }],
    warnings: ['w'],
  });
  assert.equal(grade, 'CRITICAL');
});

test('computeComplianceGrade: A층 HIGH 또는 B층 HIGH → HIGH', () => {
  assert.equal(
    computeComplianceGrade({ violations: [{ severity: 'HIGH' }], warnings: [] }),
    'HIGH',
  );
  assert.equal(
    computeComplianceGrade({
      violations: [],
      warnings: [],
      aiFindings: [{ severity: 'HIGH' }],
    }),
    'HIGH',
  );
});

test('computeComplianceGrade: MEDIUM 위반/지적 → MEDIUM', () => {
  assert.equal(
    computeComplianceGrade({ violations: [{ severity: 'MEDIUM' }], warnings: [] }),
    'MEDIUM',
  );
  assert.equal(
    computeComplianceGrade({ violations: [], warnings: [], aiFindings: [{ severity: 'MEDIUM' }] }),
    'MEDIUM',
  );
});

test('computeComplianceGrade: 경고 또는 B층 LOW 만 있으면 LOW', () => {
  assert.equal(computeComplianceGrade({ violations: [], warnings: ['주의'] }), 'LOW');
  assert.equal(
    computeComplianceGrade({ violations: [], warnings: [], aiFindings: [{ severity: 'LOW' }] }),
    'LOW',
  );
});

/* ─── buildComplianceReport — 스냅샷 빌드 ─── */

test('buildComplianceReport: A층 위반+B층 지적을 스냅샷으로 정리', () => {
  const report = buildComplianceReport({
    compliance: {
      isCompliant: false,
      violations: [
        { word: '완치', index: 3, suggestion: '치료에 도움', rule: '치료 결과 보장 금지 (의료법 제56조 제1항)', severity: 'CRITICAL' },
      ],
      warnings: ['가격 할인 표현 주의'],
    },
    aiReview: {
      reviewed: true,
      findings: [
        { category: '환자유인·알선', snippet: '반값', severity: 'HIGH', reason: '유인 소지', needsReview: true },
      ],
    },
  });
  assert.equal(report.version, COMPLIANCE_REPORT_SCHEMA_VERSION);
  assert.equal(report.engine, COMPLIANCE_ENGINE_VERSION);
  assert.equal(report.grade, 'CRITICAL');
  assert.equal(report.needsManualReview, true);
  assert.equal(report.keyword.violations.length, 1);
  assert.equal(report.keyword.violations[0].rule, '치료 결과 보장 금지 (의료법 제56조 제1항)');
  assert.ok(report.aiReview);
  assert.equal(report.aiReview!.findings.length, 1);
  assert.ok(!Number.isNaN(Date.parse(report.checkedAt)));
});

test('buildComplianceReport: 검출 없음이면 PASS·검수 불필요', () => {
  const report = buildComplianceReport({
    compliance: { isCompliant: true, violations: [], warnings: [] },
    aiReview: { reviewed: true, findings: [] },
  });
  assert.equal(report.grade, 'PASS');
  assert.equal(report.needsManualReview, false);
});

test('buildComplianceReport: B층 미수행(reviewed=false/null)은 aiReview=null', () => {
  const r1 = buildComplianceReport({
    compliance: { isCompliant: true, violations: [], warnings: [] },
    aiReview: { reviewed: false, findings: [] },
  });
  assert.equal(r1.aiReview, null);
  const r2 = buildComplianceReport({
    compliance: { isCompliant: true, violations: [], warnings: [] },
  });
  assert.equal(r2.aiReview, null);
});

test('buildComplianceReport: warnings 에 합류된 [AI 심의·…] 문자열은 A층에서 제거(중복 방지)', () => {
  const report = buildComplianceReport({
    compliance: {
      isCompliant: true,
      violations: [],
      warnings: ['[AI 심의·LOW] 심의미필: 애매 (위반 소지·검수 필요)', '일반 경고'],
    },
    aiReview: { reviewed: true, findings: [{ category: '심의미필', snippet: '', severity: 'LOW', reason: '애매', needsReview: true }] },
  });
  assert.deepEqual(report.keyword.warnings, ['일반 경고']);
});

/* ─── validateComplianceReport — 외부 입력 검증 ─── */

test('validateComplianceReport: 정상 스냅샷은 왕복(빌드→검증) 보존', () => {
  const built = buildComplianceReport({
    compliance: {
      isCompliant: false,
      violations: [{ word: '최고', index: 0, suggestion: '우수한', rule: '최상급 표현 금지', severity: 'HIGH' }],
      warnings: ['주의'],
    },
    aiReview: { reviewed: true, findings: [{ category: '과장·최상급', snippet: '최고', severity: 'MEDIUM', reason: 'r', needsReview: true }] },
  });
  const validated = validateComplianceReport(JSON.parse(JSON.stringify(built)));
  assert.ok(validated);
  assert.equal(validated!.grade, 'HIGH');
  assert.equal(validated!.keyword.violations.length, 1);
  assert.equal(validated!.aiReview!.findings.length, 1);
});

test('validateComplianceReport: 비객체·필수 필드 결손은 null', () => {
  assert.equal(validateComplianceReport(null), null);
  assert.equal(validateComplianceReport('string'), null);
  assert.equal(validateComplianceReport([]), null);
  assert.equal(validateComplianceReport({}), null);
  assert.equal(
    validateComplianceReport({ version: 1, checkedAt: 'not-a-date', grade: 'PASS', keyword: { violations: [], warnings: [] } }),
    null,
  );
  assert.equal(
    validateComplianceReport({ version: 1, checkedAt: new Date().toISOString(), grade: '위험', keyword: { violations: [], warnings: [] } }),
    null,
  );
});

test('validateComplianceReport: 배열 길이·문자열 길이 캡 적용', () => {
  const manyViolations = Array.from({ length: 500 }, (_, i) => ({
    word: 'x'.repeat(1000),
    index: i,
    suggestion: 's',
    rule: 'r'.repeat(1000),
    severity: 'HIGH',
  }));
  const raw = {
    version: 1,
    engine: 'e',
    checkedAt: new Date().toISOString(),
    grade: 'HIGH',
    needsManualReview: true,
    keyword: { isCompliant: false, violations: manyViolations, warnings: Array.from({ length: 500 }, () => 'w') },
    aiReview: null,
  };
  const validated = validateComplianceReport(raw);
  assert.ok(validated);
  assert.ok(validated!.keyword.violations.length <= 100);
  assert.ok(validated!.keyword.warnings.length <= 50);
  assert.ok(validated!.keyword.violations[0].word.length <= 100);
  assert.ok(validated!.keyword.violations[0].rule.length <= 300);
});

test('validateComplianceReport: aiReview 형태 불일치는 null 로 강등(전체 저장은 유지)', () => {
  const raw = {
    version: 1,
    checkedAt: new Date().toISOString(),
    grade: 'PASS',
    keyword: { isCompliant: true, violations: [], warnings: [] },
    aiReview: { reviewed: 'yes', findings: 'broken' },
  };
  const validated = validateComplianceReport(raw);
  assert.ok(validated);
  assert.equal(validated!.aiReview, null);
});

/* ─── computeRiskScore — 위험점수 산정 ─── */

test('computeRiskScore: CRITICAL 8 / HIGH 5 / MEDIUM 2 + 경고 1점', () => {
  const score = computeRiskScore(
    [{ severity: 'CRITICAL' }, { severity: 'HIGH' }, { severity: 'MEDIUM' }],
    3,
  );
  assert.equal(score, 8 + 5 + 2 + 3);
});

test('computeRiskScore: 미지정 심각도는 MEDIUM 가중, 음수 경고는 0 처리', () => {
  assert.equal(computeRiskScore([{ severity: 'UNKNOWN' }], -5), 2);
  assert.equal(computeRiskScore([], 0), 0);
});

/* ─── isCooldownActive / cooldownEndsAt — 쿨다운 판정 ─── */

test('isCooldownActive: 24시간 이내면 true, 지나면 false', () => {
  const now = new Date('2026-07-05T12:00:00Z');
  const oneHourAgo = new Date('2026-07-05T11:00:00Z').toISOString();
  const twoDaysAgo = new Date('2026-07-03T12:00:00Z').toISOString();
  assert.equal(isCooldownActive(oneHourAgo, now), true);
  assert.equal(isCooldownActive(twoDaysAgo, now), false);
});

test('isCooldownActive: 정확히 24시간 경계는 false(재실행 허용)', () => {
  const now = new Date('2026-07-05T12:00:00Z');
  const exactly24hAgo = new Date('2026-07-04T12:00:00Z').toISOString();
  assert.equal(isCooldownActive(exactly24hAgo, now), false);
});

test('isCooldownActive: null·빈값·파싱불가 입력은 false(graceful)', () => {
  assert.equal(isCooldownActive(null), false);
  assert.equal(isCooldownActive(undefined), false);
  assert.equal(isCooldownActive('not-a-date'), false);
});

test('cooldownEndsAt: 해제 시각 = run_at + 24h, 파싱불가는 null', () => {
  const runAt = '2026-07-05T00:00:00.000Z';
  const ends = cooldownEndsAt(runAt);
  assert.equal(ends, new Date(Date.parse(runAt) + AUDIT_COOLDOWN_HOURS * 3600_000).toISOString());
  assert.equal(cooldownEndsAt('broken'), null);
});

/* ─── buildExcerpt — 위험 표현 발췌 ─── */

test('buildExcerpt: 앞뒤 문맥 포함, 절단부에 … 표시', () => {
  const content = `${'가'.repeat(100)}완치${'나'.repeat(100)}`;
  const excerpt = buildExcerpt(content, 100, 2);
  assert.ok(excerpt.startsWith('…'));
  assert.ok(excerpt.endsWith('…'));
  assert.ok(excerpt.includes('완치'));
});

test('buildExcerpt: 문서 경계에서는 … 미표시, 빈 본문은 빈 문자열', () => {
  const excerpt = buildExcerpt('완치됩니다', 0, 2);
  assert.ok(!excerpt.startsWith('…'));
  assert.equal(buildExcerpt('', 0, 2), '');
});

/* ─── buildAuditPost / applyAiFindings — 진단 결과 조립 ─── */

test('buildAuditPost: A층 결과로 위험점수·등급·발췌를 조립', () => {
  const body = '저희 병원은 완치를 보장합니다';
  const post = buildAuditPost({
    title: '테스트 글',
    link: 'https://blog.naver.com/x/1',
    body,
    compliance: {
      violations: [{ word: '완치', index: 7, suggestion: '치료에 도움', rule: '치료 결과 보장 금지', severity: 'CRITICAL' }],
      warnings: [],
    },
  });
  assert.equal(post.grade, 'CRITICAL');
  assert.equal(post.riskScore, 8);
  assert.equal(post.aiReviewed, false);
  assert.ok(post.violations[0].excerpt.includes('완치'));
});

test('applyAiFindings: 불변 갱신 + B층 지적으로 등급 재산정', () => {
  const base = buildAuditPost({
    title: 't',
    link: 'l',
    body: '평범한 본문',
    compliance: { violations: [], warnings: [] },
  });
  const updated = applyAiFindings(base, [
    { category: '환자유인·알선', snippet: '이벤트', severity: 'HIGH', reason: '유인', needsReview: true },
  ]);
  // 원본 불변
  assert.equal(base.aiReviewed, false);
  assert.equal(base.grade, 'PASS');
  // 갱신본 반영
  assert.equal(updated.aiReviewed, true);
  assert.equal(updated.grade, 'HIGH');
  assert.equal(updated.aiFindings!.length, 1);
});

/* ─── buildAuditResults — 전체 결과 조립 ─── */

test('buildAuditResults: 위험점수 내림차순 정렬 + riskyPosts(MEDIUM 이상) 집계', () => {
  const safe = buildAuditPost({
    title: '안전 글', link: 'l1', body: 'b',
    compliance: { violations: [], warnings: [] },
  });
  const warned = buildAuditPost({
    title: '경고 글', link: 'l2', body: 'b',
    compliance: { violations: [], warnings: ['주의'] },
  });
  const risky = buildAuditPost({
    title: '위험 글', link: 'l3', body: '완치',
    compliance: { violations: [{ word: '완치', index: 0, suggestion: 's', rule: 'r', severity: 'CRITICAL' }], warnings: [] },
  });
  const results = buildAuditResults({ blogId: 'myclinic', posts: [safe, warned, risky] });
  assert.equal(results.totalPosts, 3);
  assert.equal(results.riskyPosts, 1); // CRITICAL 1편만 (LOW 경고 글은 위험 미집계)
  assert.equal(results.posts[0].title, '위험 글'); // 위험점수 내림차순
  assert.equal(results.engine, COMPLIANCE_ENGINE_VERSION);
});

test('isRiskyGrade: MEDIUM 이상만 위험', () => {
  assert.equal(isRiskyGrade('PASS'), false);
  assert.equal(isRiskyGrade('LOW'), false);
  assert.equal(isRiskyGrade('MEDIUM'), true);
  assert.equal(isRiskyGrade('HIGH'), true);
  assert.equal(isRiskyGrade('CRITICAL'), true);
});
