import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCTORPOST_SCOPE,
  FALLBACK_CTA_HEADLINE,
  buildConversionCta,
  buildDiagnosisLeadSummary,
  countDoctorpostScope,
  doctorpostLine,
} from '../conversion.ts';
import { EMPTY_SITE_AXIS } from '../site-audit.ts';
import { EMPTY_AI_AXIS } from '../ai-citation.ts';
import { EMPTY_COMPLIANCE_AXIS } from '../compliance-scan.ts';
import type {
  AiAxis,
  BlogAxis,
  ClinicCandidate,
  ComplianceAxis,
  DiagnosisReport,
  Finding,
} from '../types.ts';

/* ── 픽스처 ──────────────────────────────────────────────── */

const CLINIC: ClinicCandidate = {
  mngNo: 'MNG-1',
  name: '테스트의원',
  roadAddress: '대구광역시 수성구 청호로 422',
  lotAddress: '',
  region: '수성구',
  province: '대구광역시',
  subjects: ['피부과'],
  specialty: '피부과',
  institutionType: '의원',
  phone: '053-000-0000',
  active: true,
  statusLabel: '영업/정상',
  openedOn: '2020-01-01',
  closedOn: '',
};

const EMPTY_BLOG: BlogAxis = {
  checked: true,
  source: 'auto',
  resolution: { kind: 'none' },
  blogId: null,
  blogTitle: null,
  postCount: null,
  latestPostAt: null,
  daysSinceLatest: null,
  postsPerWeek: null,
  keywords: [],
  rankChecked: false,
  postSeo: null,
};

function finding(over: Partial<Finding> & Pick<Finding, 'id'>): Finding {
  return {
    axis: 'blog',
    label: '항목',
    tone: 'warn',
    state: '상태',
    why: '이유',
    action: '행동',
    ourScope: true,
    ...over,
  } as Finding;
}

function report(over: Partial<DiagnosisReport> = {}): DiagnosisReport {
  return {
    version: 1,
    runAt: '2026-07-27T00:00:00.000Z',
    clinic: CLINIC,
    blog: EMPTY_BLOG,
    site: EMPTY_SITE_AXIS,
    ai: EMPTY_AI_AXIS,
    compliance: EMPTY_COMPLIANCE_AXIS,
    findings: [],
    unchecked: [],
    ...over,
  };
}

/* ── 항목별 "닥터포스트가 이걸 한다" 한 줄 ─────────────── */

test('doctorpostLine: 경고 + ourScope + 등재 항목에만 붙는다', () => {
  assert.equal(
    doctorpostLine(finding({ id: 'blog.freshness', tone: 'warn', ourScope: true })),
    DOCTORPOST_SCOPE['blog.freshness'],
  );
});

test('doctorpostLine: 잘하고 있는 항목·확인 못 한 항목에는 붙지 않는다', () => {
  assert.equal(doctorpostLine(finding({ id: 'blog.freshness', tone: 'good' })), null);
  assert.equal(doctorpostLine(finding({ id: 'blog.freshness', tone: 'unknown' })), null);
});

test('doctorpostLine: ourScope=false 면 표에 있어도 붙지 않는다', () => {
  // blog.cadence 는 발행량이 충분하면 ourScope=false 로 나온다 — 그때 광고 줄이 붙으면 안 된다.
  assert.equal(doctorpostLine(finding({ id: 'blog.cadence', tone: 'warn', ourScope: false })), null);
});

test('doctorpostLine: 우리가 하지 않는 항목(홈페이지)에는 아무 줄도 없다', () => {
  for (const id of ['site.https', 'site.readable', 'site.exists']) {
    assert.equal(DOCTORPOST_SCOPE[id], undefined, `${id} 는 표에 있으면 안 된다`);
    // ourScope 를 억지로 true 로 줘도 표에 없으므로 붙지 않는다.
    assert.equal(doctorpostLine(finding({ id, axis: 'site', tone: 'warn', ourScope: true })), null);
  }
});

test('countDoctorpostScope: 게이트를 통과한 항목만 센다', () => {
  const findings = [
    finding({ id: 'blog.freshness', tone: 'warn', ourScope: true }),
    finding({ id: 'compliance.prohibited', axis: 'compliance', tone: 'warn', ourScope: true }),
    finding({ id: 'site.https', axis: 'site', tone: 'warn', ourScope: false }),
    finding({ id: 'blog.rank', tone: 'good', ourScope: false }),
  ];
  assert.equal(countDoctorpostScope(findings), 2);
});

/* ── 전환 문구 ───────────────────────────────────────────── */

test('buildConversionCta: 발행 정체는 실제 경과일을 문구에 넣는다', () => {
  const cta = buildConversionCta(
    report({
      blog: { ...EMPTY_BLOG, daysSinceLatest: 208 },
      findings: [finding({ id: 'blog.freshness', tone: 'warn', ourScope: true })],
    }),
  );
  assert.equal(cta.headline, '208일 밀린 글, 이번 주부터 채우기');
  assert.equal(cta.basis, 'blog.freshness');
});

test('buildConversionCta: 위험 표현은 실제 검출 건수를 문구에 넣는다', () => {
  const compliance: ComplianceAxis = {
    ...EMPTY_COMPLIANCE_AXIS,
    checked: true,
    postsScanned: 20,
    hits: [],
    postsWithHits: 4,
    prohibitedCount: 11,
    cautionCount: 3,
    postsWithProhibited: 4,
  };
  const cta = buildConversionCta(
    report({
      compliance,
      findings: [finding({ id: 'compliance.prohibited', axis: 'compliance', tone: 'warn', ourScope: true })],
    }),
  );
  assert.equal(cta.headline, '위험 표현 11건, 발행 전에 자동으로 걸러내기');
});

test('buildConversionCta: 한 줄 요약의 M 은 실제로 닥포가 하는 건수만 센다', () => {
  const cta = buildConversionCta(
    report({
      blog: { ...EMPTY_BLOG, daysSinceLatest: 30 },
      findings: [
        finding({ id: 'blog.freshness', tone: 'warn', ourScope: true }), // bad + 우리 범위
        finding({ id: 'site.https', axis: 'site', tone: 'warn', ourScope: false }), // bad, 우리 범위 아님
        finding({ id: 'ai.known', axis: 'ai', tone: 'warn', ourScope: true }), // bad + 우리 범위
      ],
    }),
  );
  assert.equal(cta.badCount, 3);
  assert.equal(cta.badScopeCount, 2);
  assert.equal(cta.sub, '지금 고쳐야 할 것 3건 중 2건은 닥터포스트가 대신합니다.');
});

test('buildConversionCta: 값이 없으면 무난한 기본 문구로 폴백한다', () => {
  // 경과일이 없는데 blog.freshness 만 있는 상태 → 숫자를 못 넣으므로 기본 문구.
  const cta = buildConversionCta(
    report({ findings: [finding({ id: 'blog.freshness', tone: 'warn', ourScope: true })] }),
  );
  assert.equal(cta.headline, FALLBACK_CTA_HEADLINE);
  assert.equal(cta.basis, null);
});

test('buildConversionCta: 문제가 없으면 기본 문구 + 기본 요약', () => {
  const cta = buildConversionCta(report({ findings: [] }));
  assert.equal(cta.headline, FALLBACK_CTA_HEADLINE);
  assert.equal(cta.badCount, 0);
  assert.match(cta.sub, /무료/);
});

test('buildConversionCta: 우리 범위가 아닌 경고만 있으면 광고 문구를 만들지 않는다', () => {
  const cta = buildConversionCta(
    report({ findings: [finding({ id: 'site.https', axis: 'site', tone: 'warn', ourScope: false })] }),
  );
  assert.equal(cta.headline, FALLBACK_CTA_HEADLINE);
  assert.equal(cta.badScopeCount, 0);
  assert.equal(cta.sub, '지금 고쳐야 할 것 1건 중 0건은 닥터포스트가 대신합니다.');
});

test('buildConversionCta: 화면 순서가 앞선 항목(지금 고쳐야 할 것)이 문구 근거가 된다', () => {
  const cta = buildConversionCta(
    report({
      blog: { ...EMPTY_BLOG, daysSinceLatest: 100, postsPerWeek: 0.4 },
      findings: [
        finding({ id: 'blog.cadence', tone: 'warn', ourScope: true }), // improve
        finding({ id: 'blog.freshness', tone: 'warn', ourScope: true }), // bad
      ],
    }),
  );
  assert.equal(cta.basis, 'blog.freshness');
});

/* ── 영업이 쓸 요약 ──────────────────────────────────────── */

test('buildDiagnosisLeadSummary: 확인하지 못한 값은 null 로 남긴다(추정 금지)', () => {
  const summary = buildDiagnosisLeadSummary(report());
  assert.equal(summary.daysSinceLatestPost, null);
  assert.equal(summary.prohibitedCount, null);
  assert.equal(summary.keywordsChecked, null);
  assert.equal(summary.keywordsTop10, null);
  assert.equal(summary.aiRecommendTotal, null);
});

test('buildDiagnosisLeadSummary: 통화 첫 문장 재료(문제 항목·숫자)를 담는다', () => {
  const ai: AiAxis = { ...EMPTY_AI_AXIS, checked: true, recommendQuestionTotal: 3, recommendQuestionMentioned: 1 };
  const summary = buildDiagnosisLeadSummary(
    report({
      ai,
      blog: {
        ...EMPTY_BLOG,
        daysSinceLatest: 208,
        rankChecked: true,
        keywords: [
          { keyword: 'a', apiRank: 3, docCount: 100 },
          { keyword: 'b', apiRank: 42, docCount: 100 },
          { keyword: 'c', apiRank: null, docCount: 100 },
        ],
      },
      findings: [
        finding({ id: 'blog.freshness', label: '최근 발행', tone: 'warn', ourScope: true }),
        finding({ id: 'site.https', axis: 'site', label: '홈페이지 접속(보안 연결)', tone: 'warn', ourScope: false }),
      ],
    }),
  );
  assert.equal(summary.daysSinceLatestPost, 208);
  assert.equal(summary.keywordsChecked, 3);
  assert.equal(summary.keywordsTop10, 1);
  assert.equal(summary.aiRecommendTotal, 3);
  assert.equal(summary.aiRecommendMentioned, 1);
  assert.equal(summary.badCount, 2);
  assert.equal(summary.ourScopeCount, 1);
  assert.deepEqual([...summary.topIssues].sort(), ['최근 발행', '홈페이지 접속(보안 연결)']);
});
