import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkCompliance,
  detectProductNames,
  autoFix,
} from '../medical-compliance.ts';

// ── 상품명 + 광고성 어구 근접 → HIGH ──
test('detectProductNames: "위고비 처방" → HIGH 위반', () => {
  const { violations } = detectProductNames('위고비 처방은 전문의와 상담 후 결정합니다.');
  const wigobi = violations.find((v) => v.word === '위고비');
  assert.ok(wigobi, '위고비 위반이 있어야 함');
  assert.equal(wigobi?.severity, 'HIGH');
});

test('detectProductNames: "써마지 이벤트" → HIGH 위반', () => {
  const { violations } = detectProductNames('이번 달 써마지 이벤트를 진행합니다.');
  const thermage = violations.find((v) => v.word === '써마지');
  assert.ok(thermage);
  assert.equal(thermage?.severity, 'HIGH');
});

// ── 상품명 단독(교육/정보성) → MEDIUM(표면화만), HIGH 아님 ──
test('detectProductNames: "위고비란 무엇인가" → MEDIUM(HIGH 아님)', () => {
  const { violations } = detectProductNames('위고비란 무엇인가에 대해 알아보겠습니다.');
  const wigobi = violations.find((v) => v.word === '위고비');
  assert.ok(wigobi, '단독 등장도 MEDIUM 으로 표면화되어야 함');
  assert.equal(wigobi?.severity, 'MEDIUM');
  assert.ok(!violations.some((v) => v.severity === 'HIGH'), 'HIGH 는 없어야 함');
});

test('detectProductNames: "써마지란 초음파 리프팅" → MEDIUM(HIGH 아님)', () => {
  const { violations } = detectProductNames('써마지란 고주파를 이용한 리프팅 원리입니다.');
  const thermage = violations.find((v) => v.word === '써마지');
  assert.ok(thermage);
  assert.equal(thermage?.severity, 'MEDIUM');
  assert.ok(!violations.some((v) => v.severity === 'HIGH'));
});

// ── 부분문자열 중복 매칭 제거: 피코슈어 → 피코 재매칭 금지 ──
test('detectProductNames: "피코슈어"는 한 번만 검출(피코 중복 없음)', () => {
  const { violations } = detectProductNames('피코슈어 레이저에 대해 설명합니다.');
  const picoLike = violations.filter((v) => v.word.startsWith('피코'));
  assert.equal(picoLike.length, 1);
  assert.equal(picoLike[0].word, '피코슈어');
});

// ── checkCompliance 통합: 상품명은 filteredContent 에서 치환하지 않음 ──
test('checkCompliance: 상품명은 filteredContent 에서 치환되지 않음(검출만)', () => {
  const r = checkCompliance('위고비란 무엇인가에 대해 알아보겠습니다.');
  assert.ok(r.filteredContent.includes('위고비'), '상품명이 원문 그대로 남아야 함');
  assert.ok(r.violations.some((v) => v.word === '위고비'));
  assert.equal(r.isCompliant, false);
});

test('checkCompliance: "위고비 처방 이벤트" → HIGH 위반 포함', () => {
  const r = checkCompliance('위고비 처방 이벤트를 특가로 진행합니다.');
  assert.ok(r.violations.some((v) => v.word === '위고비' && v.severity === 'HIGH'));
  assert.equal(r.isCompliant, false);
});

// ── autoFix 는 상품명을 건드리지 않음 ──
test('autoFix: 상품명은 자동치환하지 않음', () => {
  const { fixed } = autoFix('써마지란 무엇인가');
  assert.ok(fixed.includes('써마지'), '상품명은 치환 대상이 아님');
});

// ── 기존 금지어 회귀: 치료결과보장/최상급 ──
test('checkCompliance: "완치" 는 여전히 CRITICAL 로 검출', () => {
  const r = checkCompliance('이 치료로 완치가 가능합니다.');
  assert.ok(r.violations.some((v) => v.word === '완치' && v.severity === 'CRITICAL'));
});

test('checkCompliance: "최고" 는 여전히 HIGH 로 검출·치환', () => {
  const r = checkCompliance('우리 병원은 최고입니다.');
  assert.ok(r.violations.some((v) => v.word === '최고'));
  assert.ok(!r.filteredContent.includes('최고'), '최고는 치환되어야 함');
});

// ── 오매칭 방지 회귀: "정기적인"·"장기적인" 안의 "기적" 미매칭 ──
test('checkCompliance: "정기적인 검진" 은 오매칭(기적) 없음', () => {
  const r = checkCompliance('정기적인 검진과 장기적인 관리를 권합니다.');
  assert.ok(!r.violations.some((v) => v.word === '기적'));
});

// ── 확대 커버리지: 국내최초·유일무이·평생보장 ──
test('checkCompliance: 확대 최상급/보장 표현 검출', () => {
  const r1 = checkCompliance('국내최초로 도입한 장비입니다.');
  assert.ok(r1.violations.some((v) => v.word === '국내최초'));
  const r2 = checkCompliance('결과를 평생보장 해드립니다.');
  assert.ok(r2.violations.some((v) => v.word === '평생보장'));
});

// ── 확대 커버리지: 유인·이벤트·지역+최상급 경고(패턴) ──
test('checkCompliance: 유인·지역최상급 표현은 warnings 로 표면화', () => {
  const r1 = checkCompliance('선착순 반값 이벤트를 진행합니다.');
  assert.ok(r1.warnings.length > 0);
  const r2 = checkCompliance('수성구 최고의 진료를 약속합니다.');
  assert.ok(r2.warnings.some((w) => w.includes('지역명') || w.includes('배타')));
});

// ── 빈 입력 ──
test('detectProductNames: 빈 문자열은 빈 결과', () => {
  const r = detectProductNames('');
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.warnings, []);
});
