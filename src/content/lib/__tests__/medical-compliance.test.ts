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

// ═══════════════════════════════════════════════════════════════
// 2026-W28 주간 리서치 반영 — 1군(상품명)·2군(LOW 유인/경험담/전문가 프레임)
// ═══════════════════════════════════════════════════════════════

// ── 1군: 신규 전문의약품(한글) 단독 등장 → MEDIUM 검출 ──
const W28_NEW_DRUGS = ['젭바운드', '파운다요', '오포글리프론', '카그리세마', '캐그리세마', '리벨서스'];
for (const name of W28_NEW_DRUGS) {
  test(`detectProductNames(W28): "${name}" 단독 → MEDIUM 검출`, () => {
    const { violations } = detectProductNames(`${name}에 대해 알아보겠습니다.`);
    const hit = violations.find((v) => v.word === name);
    assert.ok(hit, `${name} 이 검출되어야 함`);
    assert.equal(hit?.severity, 'MEDIUM');
  });
}

// ── 1군: 신규 의료기기·시술 장비 단독 등장 → MEDIUM 검출 ──
const W28_NEW_DEVICES = ['덴서티', '볼뉴머', '올리지오', '소프웨이브', '텐써마', '리쥬란', '쥬베룩', '스컬트라'];
for (const name of W28_NEW_DEVICES) {
  test(`detectProductNames(W28): "${name}" 단독 → MEDIUM 검출`, () => {
    const { violations } = detectProductNames(`${name}의 원리를 설명합니다.`);
    const hit = violations.find((v) => v.word === name);
    assert.ok(hit, `${name} 이 검출되어야 함`);
    assert.equal(hit?.severity, 'MEDIUM');
  });
}

test('detectProductNames(W28): "리쥬란 이벤트" → HIGH 격상', () => {
  const { violations } = detectProductNames('이번 달 리쥬란 이벤트를 진행합니다.');
  const hit = violations.find((v) => v.word === '리쥬란');
  assert.ok(hit);
  assert.equal(hit?.severity, 'HIGH');
});

// ── 1군: 영문 상품명 — 대소문자 변형 모두 검출 ──
const W28_EN_DRUGS = ['Wegovy', 'Mounjaro', 'Ozempic', 'Zepbound', 'Saxenda', 'Qsymia', 'Phentermine', 'Rybelsus', 'CagriSema', 'Orforglipron'];
for (const name of W28_EN_DRUGS) {
  test(`detectProductNames(W28): 영문 "${name}" 단독 → MEDIUM 검출`, () => {
    const { violations } = detectProductNames(`${name} 성분과 작용 원리를 설명합니다.`);
    const hit = violations.find((v) => v.word === name);
    assert.ok(hit, `${name} 이 검출되어야 함`);
    assert.equal(hit?.severity, 'MEDIUM');
  });
}

test('detectProductNames(W28): 영문 대소문자 변형(WEGOVY/wegovy/WeGoVy) 모두 검출', () => {
  for (const variant of ['WEGOVY', 'wegovy', 'WeGoVy']) {
    const { violations } = detectProductNames(`${variant} 관련 안내입니다.`);
    assert.ok(violations.some((v) => v.word === 'Wegovy'), `${variant} 가 Wegovy 로 검출되어야 함`);
  }
});

test('detectProductNames(W28): "Zepbound 처방" → 한글 유인 어구 근접으로 HIGH 격상', () => {
  const { violations } = detectProductNames('Zepbound 처방 상담을 받아보세요.');
  const hit = violations.find((v) => v.word === 'Zepbound');
  assert.ok(hit);
  assert.equal(hit?.severity, 'HIGH');
});

// ── 오탐: 영문 단어 경계 — 다른 영단어 안의 부분문자열 미검출 ──
test('detectProductNames(W28): "awegovy"·"wegovys" 는 오탐 없음(영문 단어 경계)', () => {
  const r1 = detectProductNames('awegovy 라는 임의 문자열입니다.');
  assert.ok(!r1.violations.some((v) => v.word === 'Wegovy'));
  const r2 = detectProductNames('wegovys 라는 임의 문자열입니다.');
  assert.ok(!r2.violations.some((v) => v.word === 'Wegovy'));
});

// ── "먹는 위고비" 모방 표현 — 기존 "위고비" 부분매칭으로 이미 검출(별도 등록 불필요 근거) ──
test('detectProductNames(W28): "먹는 위고비" → 위고비 부분매칭으로 검출됨', () => {
  const { violations } = detectProductNames('먹는 위고비로 불리는 약이 화제입니다.');
  assert.ok(violations.some((v) => v.word === '위고비'));
});

// ── 부분문자열 충돌: 텐써마 vs 써마지 (독립 매칭, 중복 없음) ──
test('detectProductNames(W28): "텐써마"는 텐써마 1건만 검출(써마지 오탐 없음)', () => {
  const { violations } = detectProductNames('텐써마 리프팅의 원리를 설명합니다.');
  assert.ok(violations.some((v) => v.word === '텐써마'));
  assert.ok(!violations.some((v) => v.word === '써마지'));
});

test('detectProductNames(W28): "써마지"는 텐써마로 오탐되지 않음', () => {
  const { violations } = detectProductNames('써마지 시술 원리를 설명합니다.');
  assert.ok(violations.some((v) => v.word === '써마지'));
  assert.ok(!violations.some((v) => v.word === '텐써마'));
});

// ── 부분문자열 오탐: 한글 좌측 경계 — 다른 단어 안의 "리쥬란" 미검출 ──
test('detectProductNames(W28): 한글 단어 중간의 "리쥬란"은 오탐 없음(좌측 경계)', () => {
  const { violations } = detectProductNames('그리쥬란다 라는 임의 단어입니다.');
  assert.ok(!violations.some((v) => v.word === '리쥬란'));
});

// ── 1군: 신규 상품명도 자동치환 금지(검출만) 원칙 유지 ──
test('checkCompliance(W28): 신규 상품명은 filteredContent 에서 치환되지 않음', () => {
  const r = checkCompliance('젭바운드와 리쥬란, Wegovy 에 대해 알아봅니다.');
  assert.ok(r.filteredContent.includes('젭바운드'));
  assert.ok(r.filteredContent.includes('리쥬란'));
  assert.ok(r.filteredContent.includes('Wegovy'));
  assert.ok(r.violations.length >= 3);
});

test('autoFix(W28): 신규 상품명·유인 표현은 자동치환하지 않음', () => {
  const { fixed } = autoFix('젭바운드 안내와 선착순 한정 수량 무료 검사 안내');
  assert.equal(fixed, '젭바운드 안내와 선착순 한정 수량 무료 검사 안내');
});

// ── 2군: 유인 표현 → warnings(LOW 경로)로 검출·표시만 ──
test('checkCompliance(W28): "선착순 이벤트" → 유인 경고 검출', () => {
  const r = checkCompliance('선착순 이벤트를 진행합니다.');
  assert.ok(r.warnings.some((w) => w.includes('유인')));
});

test('checkCompliance(W28): "한정 수량"·"동반 방문"·"지인 소개" → 유인 경고 검출', () => {
  for (const text of ['한정 수량으로 준비했습니다.', '동반 방문 시 안내해 드립니다.', '지인 소개로 오시는 분들이 많습니다.']) {
    const r = checkCompliance(text);
    assert.ok(r.warnings.some((w) => w.includes('유인')), `"${text}" 에서 유인 경고가 나와야 함`);
  }
});

test('checkCompliance(W28): "무료 검사"·"무료 시술" → 유인 경고 검출', () => {
  for (const text of ['무료 검사를 제공합니다.', '무료 시술 기회를 드립니다.']) {
    const r = checkCompliance(text);
    assert.ok(r.warnings.some((w) => w.includes('유인')), `"${text}" 에서 유인 경고가 나와야 함`);
  }
});

// ── 2군 오탐 배제: "무료 상담"은 기존 관행 — 유인 경고 미발생 ──
test('checkCompliance(W28): "무료 상담 가능" 은 유인 경고 오발 없음', () => {
  const r = checkCompliance('무료 상담 가능하니 편하게 문의하세요.');
  assert.ok(!r.warnings.some((w) => w.includes('유인')));
  assert.equal(r.violations.length, 0);
});

// ── 2군: 비급여 면제 → 경고, "책임 면제 조항"은 오탐 배제 ──
test('checkCompliance(W28): "비급여 검사비 면제" → 면제 경고 검출', () => {
  const r = checkCompliance('비급여 검사비 면제 혜택을 드립니다.');
  assert.ok(r.warnings.some((w) => w.includes('면제')));
});

test('checkCompliance(W28): "책임 면제 조항" 은 면제 경고 오발 없음', () => {
  const r = checkCompliance('계약서의 책임 면제 조항을 확인하세요.');
  assert.ok(!r.warnings.some((w) => w.includes('면제')));
  assert.equal(r.violations.length, 0);
});

// ── 2군: 경험담 위장 표현 → warnings 검출 ──
test('checkCompliance(W28): "실제 후기입니다" → 후기 경고 검출', () => {
  const r = checkCompliance('실제 후기입니다. 참고하세요.');
  assert.ok(r.warnings.some((w) => w.includes('후기') || w.includes('체험담')));
});

test('checkCompliance(W28): "내돈내산"·"직접 받아보니" → 경험담 위장 경고 검출', () => {
  for (const text of ['내돈내산 솔직 리뷰를 남깁니다.', '직접 받아보니 어땠는지 공유합니다.']) {
    const r = checkCompliance(text);
    assert.ok(r.warnings.some((w) => w.includes('후기') || w.includes('체험담')), `"${text}" 에서 경험담 경고가 나와야 함`);
  }
});

// ── 2군: 전문가 프레임 → 경고, 정상 인용 서술은 오탐 배제 ──
test('checkCompliance(W28): "전문가 추천"·"의사가 추천하는" → 전문가 프레임 경고 검출', () => {
  for (const text of ['전문가 추천 병원으로 알려져 있습니다.', '의사가 추천하는 관리법입니다.']) {
    const r = checkCompliance(text);
    assert.ok(r.warnings.some((w) => w.includes('전문가')), `"${text}" 에서 전문가 프레임 경고가 나와야 함`);
  }
});

test('checkCompliance(W28): "전문가의 의견을 인용하면" 은 오탐 없음', () => {
  const r = checkCompliance('전문가의 의견을 인용하면 신뢰도가 높아집니다.');
  assert.ok(!r.warnings.some((w) => w.includes('전문가')));
  assert.equal(r.violations.length, 0);
});

// ── 2군: LOW 경로는 하드블록·치환에 관여하지 않음(warnings 만) ──
test('checkCompliance(W28): 2군 유인 표현은 violations 가 아닌 warnings 로만 표면화', () => {
  const r = checkCompliance('한정 수량, 동반 방문, 지인 소개 안내.');
  assert.equal(r.violations.length, 0, '2군은 violations(치환·게이트 경로)에 넣지 않는다');
  assert.ok(r.warnings.length > 0);
  assert.equal(r.filteredContent, '한정 수량, 동반 방문, 지인 소개 안내.', '원문 무변형');
});

// ── 보존 회귀: 기존 정상 문구들이 여전히 통과하는지 ──
test('checkCompliance(W28): 정상 문구 보존 — 경보·치환 오발 없음', () => {
  const r = checkCompliance('정기적인 검진과 전문의 상담 후 치료 방향을 결정합니다.');
  assert.equal(r.violations.length, 0);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.isCompliant, true);
});
