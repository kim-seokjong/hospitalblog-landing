/**
 * 회귀 고정 — "의료광고법 3중 검수가 실제로 작동한다"는 증거.
 *
 * 배경(2026-W30 실측): 운영 DB 의 compliance_report 6편이 전부 keyword.violations=[] 였다.
 * 원인은 A층 사전이 비어서가 아니라, generate-content 가 **autoFix(자동치환)를 먼저 돌린 뒤**
 * checkCompliance 를 호출해 위반이 이미 지워진 본문을 검사했기 때문이다.
 * 이 파일은 두 가지를 동시에 고정한다:
 *   1) A층이 위반 유형별로 실제로 검출한다(사전·정규식 회귀 방지).
 *   2) 파이프라인 순서가 다시 뒤집혀도 CI 가 잡는다(증빙 유실 방지).
 *
 * ⚠️ 검수 강도는 recall 최우선(회사 규칙)이다. 이 테스트를 통과시키려고
 *    검출을 느슨하게 만들지 말 것 — 기대값을 낮추는 수정은 회귀다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCompliance, autoFix } from '../medical-compliance.ts';
import {
  buildComplianceReport,
  computeComplianceGrade,
  diffAutoFixedViolations,
  validateComplianceReport,
} from '../compliance-report.ts';
import type { ComplianceGrade } from '../compliance-report.ts';

/** 등급 순위 — "최소 이 등급 이상"을 단언할 때 쓴다. */
const RANK: Record<ComplianceGrade, number> = {
  PASS: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};

/** A층 검사 결과의 등급을 산정한다(B층 미반영). */
function gradeOf(text: string): ComplianceGrade {
  const r = checkCompliance(text);
  return computeComplianceGrade({ violations: r.violations, warnings: r.warnings });
}

/* ────────────────────────────────────────────────────────────
 * 1. A층 — 명백한 위반은 반드시 검출된다
 * ──────────────────────────────────────────────────────────── */

const OBVIOUS_VIOLATIONS: ReadonlyArray<{ label: string; text: string; min: ComplianceGrade }> = [
  {
    label: '치료 전후 비교',
    text: '시술 전후 사진을 비교해보면 변화를 확인하실 수 있습니다.',
    min: 'HIGH',
  },
  {
    label: '비포애프터',
    text: '비포애프터 이미지를 통해 시술 결과를 보여드립니다.',
    min: 'HIGH',
  },
  {
    label: '환자 후기·경험담 인용',
    text: '실제 치료 후기입니다. 환자 후기 모음을 확인해보세요.',
    min: 'MEDIUM',
  },
  {
    label: '1인칭 치료경험담',
    text: '저는 이 시술을 받고 통증이 완전히 나았어요.',
    min: 'MEDIUM',
  },
  {
    label: '시술 가격 할인 광고',
    text: '이번 달 한정 보톡스 시술 할인 이벤트를 진행합니다. 선착순 특가입니다.',
    min: 'MEDIUM',
  },
  {
    label: '비급여 진료비 할인·면제',
    text: '비급여 검사비 면제 이벤트를 진행하고 있습니다.',
    min: 'MEDIUM',
  },
  {
    label: '비급여 가격 단정 노출',
    text: '보톡스 시술 150,000원에 진행하고 있습니다.',
    min: 'MEDIUM',
  },
  {
    label: '부작용 없음',
    text: '이 시술은 부작용 없음이 확인된 방법입니다.',
    min: 'CRITICAL',
  },
  {
    label: '100% 안전',
    text: '100% 안전하게 진행되는 시술입니다.',
    min: 'CRITICAL',
  },
  {
    label: '최고·최상급',
    text: '저희는 국내 최고의 의료기관입니다.',
    min: 'HIGH',
  },
  {
    label: '유일성 주장',
    text: '이 치료를 시행하는 유일한 곳입니다.',
    min: 'HIGH',
  },
  {
    label: '지역명 + 순위 단정',
    text: '수성구 1위 병원으로 자리잡았습니다.',
    min: 'HIGH',
  },
  {
    label: '전문병원 무단 표방',
    text: '저희는 척추 전문병원으로 운영되고 있습니다.',
    min: 'HIGH',
  },
  {
    label: '결과·환불 보장',
    text: '만족하지 못하시면 전액 환불 보장해드립니다.',
    min: 'HIGH',
  },
  {
    label: '완치 보장',
    text: '이 치료로 완치가 가능합니다.',
    min: 'CRITICAL',
  },
];

for (const { label, text, min } of OBVIOUS_VIOLATIONS) {
  test(`A층: 명백한 위반 검출 — ${label}`, () => {
    const result = checkCompliance(text);
    assert.ok(
      result.violations.length > 0 || result.warnings.length > 0,
      `"${label}" 이 전혀 검출되지 않았다 — A층 회귀`,
    );
    const grade = gradeOf(text);
    assert.ok(
      RANK[grade] >= RANK[min],
      `"${label}" 등급이 ${grade} — 최소 ${min} 이상이어야 한다`,
    );
  });
}

/* ────────────────────────────────────────────────────────────
 * 2. A층 — 정상 정보성 글은 통과한다(오탐 상한)
 * ──────────────────────────────────────────────────────────── */

const CLEAN_TEXTS: ReadonlyArray<{ label: string; text: string }> = [
  {
    label: '질환 설명 + 권장 마무리 문구',
    text: '허리 디스크는 척추뼈 사이의 쿠션이 제자리에서 밀려나 신경을 누르는 상태입니다. 개인마다 차이가 있을 수 있으니, 전문의와 상담 후 결정하시길 권해드립니다.',
  },
  {
    label: '증상 안내 + 일반화된 임상 관찰',
    text: '무릎 통증으로 오시는 분들 중에는 활동량이 갑자기 늘어난 경우가 많습니다. 며칠 쉬어도 통증이 이어지면 진료를 받아보시는 편이 좋습니다.',
  },
  {
    label: '무료 상담 안내(관행 표현 — 오탐 배제 대상)',
    text: '초진 시 무료 상담을 통해 증상을 확인합니다.',
  },
];

for (const { label, text } of CLEAN_TEXTS) {
  test(`A층: 정상 정보성 글은 통과 — ${label}`, () => {
    assert.equal(gradeOf(text), 'PASS', `정상 글이 걸렸다 — 오탐: ${label}`);
  });
}

/* ────────────────────────────────────────────────────────────
 * 3. 파이프라인 순서 회귀 — autoFix 가 검사를 삼키지 않는가
 * ──────────────────────────────────────────────────────────── */

test('파이프라인: autoFix 는 A층 위반을 실제로 지운다(결함의 근거)', () => {
  const raw = '이 시술은 부작용 없음이 확인된 100% 안전한 방법입니다.';
  const before = checkCompliance(raw);
  const { fixed } = autoFix(raw);
  const after = checkCompliance(fixed);

  assert.ok(before.violations.length > 0, '치환 전에는 위반이 검출돼야 한다');
  assert.equal(
    after.violations.length,
    0,
    'autoFix 후에는 위반이 사라진다 — 그래서 치환 후에만 검사하면 A층이 영구히 0건이 된다',
  );
});

test('파이프라인: diffAutoFixedViolations 가 자동교정된 위반을 증빙으로 남긴다', () => {
  const raw = '이 시술은 부작용 없음이 확인된 100% 안전한 방법입니다.';
  const before = checkCompliance(raw);
  const { fixed } = autoFix(raw);
  const after = checkCompliance(fixed);

  const autoFixed = diffAutoFixedViolations(before.violations, after.violations);
  assert.ok(autoFixed.length > 0, '자동교정된 위반이 증빙으로 남아야 한다');
  assert.ok(
    autoFixed.some((v) => v.severity === 'CRITICAL'),
    'CRITICAL 위반이 교정 기록에 보존돼야 한다',
  );
});

test('리포트: 자동교정 CRITICAL 이 있으면 검수 권고(needsManualReview)가 켜진다', () => {
  const raw = '이 시술은 부작용 없음이 확인된 방법입니다.';
  const before = checkCompliance(raw);
  const { fixed } = autoFix(raw);
  const after = checkCompliance(fixed);
  const autoFixed = diffAutoFixedViolations(before.violations, after.violations);

  const report = buildComplianceReport({
    compliance: { isCompliant: after.violations.length === 0, violations: after.violations, warnings: after.warnings },
    aiReview: null,
    autoFixed,
  });

  assert.equal(report.keyword.autoFixed.length, autoFixed.length, 'autoFixed 가 스냅샷에 보존돼야 한다');
  assert.equal(
    report.needsManualReview,
    true,
    '자동치환은 문맥을 보지 않으므로 CRITICAL 교정분은 사람이 확인해야 한다',
  );
});

test('리포트: 등급은 발행본(잔존) 기준 — 자동교정분이 등급을 밀어올리지 않는다', () => {
  const raw = '완치가 가능한 치료입니다.';
  const before = checkCompliance(raw);
  const { fixed } = autoFix(raw);
  const after = checkCompliance(fixed);
  const autoFixed = diffAutoFixedViolations(before.violations, after.violations);

  const report = buildComplianceReport({
    compliance: { isCompliant: true, violations: after.violations, warnings: after.warnings },
    aiReview: null,
    autoFixed,
  });

  assert.notEqual(report.grade, 'CRITICAL', '본문에 없는 표현으로 등급을 올리지 않는다');
  assert.ok(report.keyword.autoFixed.length > 0, '대신 교정 기록은 남는다');
});

/* ────────────────────────────────────────────────────────────
 * 4. 스냅샷 검증 — autoFixed 왕복·하위 호환
 * ──────────────────────────────────────────────────────────── */

test('validateComplianceReport: autoFixed 가 왕복 보존된다', () => {
  const report = buildComplianceReport({
    compliance: { isCompliant: true, violations: [], warnings: [] },
    aiReview: null,
    autoFixed: [
      { word: '완치', index: 3, suggestion: '치료에 도움', rule: '치료 결과 보장 금지', severity: 'CRITICAL' },
    ],
  });
  const parsed = validateComplianceReport(JSON.parse(JSON.stringify(report)));
  assert.ok(parsed, '검증을 통과해야 한다');
  assert.equal(parsed?.keyword.autoFixed.length, 1);
  assert.equal(parsed?.keyword.autoFixed[0].word, '완치');
  assert.equal(parsed?.keyword.autoFixed[0].severity, 'CRITICAL');
});

test('validateComplianceReport: autoFixed 없는 v1 리포트도 파싱된다(하위 호환)', () => {
  const legacy = {
    version: 1,
    engine: 'doctorpost-compliance v1',
    checkedAt: new Date().toISOString(),
    grade: 'LOW',
    needsManualReview: false,
    keyword: { isCompliant: true, violations: [], warnings: ['경고 1건'] },
    aiReview: null,
  };
  const parsed = validateComplianceReport(legacy);
  assert.ok(parsed, 'v1 리포트도 파싱돼야 한다');
  assert.deepEqual(parsed?.keyword.autoFixed, [], 'autoFixed 부재는 빈 배열로 정규화');
});
