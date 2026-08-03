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

// ── 확대 커버리지: 유인·이벤트·지역+최상급 (2026-W30 부터 violations 로 승격) ──
// 승격 이유: 등급이 LOW 에 머물러 "명백한 유인·배타 표현"이 검수 우선순위에서 밀렸다.
test('checkCompliance: 유인 표현은 MEDIUM 위반으로 승격된다', () => {
  const r = checkCompliance('선착순 반값 이벤트를 진행합니다.');
  assert.ok(
    r.violations.some((v) => v.severity === 'MEDIUM' && v.rule.includes('유인')),
    '유인 표현은 MEDIUM 위반이어야 한다',
  );
});

test('checkCompliance: 지역명+최상급은 HIGH 위반으로 승격된다', () => {
  const r = checkCompliance('수성구 최고의 진료를 약속합니다.');
  assert.ok(
    r.violations.some((v) => v.severity === 'HIGH'),
    '지역명+최상급은 HIGH 위반이어야 한다',
  );
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

// ── 1군: 2026-W32 신규 등록 장비 (대표 승인 2026-08-03) ──
const W32_NEW_DEVICES = ['엠페이스', '엑시온', '온다리프팅'];
for (const name of W32_NEW_DEVICES) {
  test(`detectProductNames(W32): "${name}" 단독 → MEDIUM 검출`, () => {
    const { violations } = detectProductNames(`${name}의 원리를 설명합니다.`);
    const hit = violations.find((v) => v.word === name);
    assert.ok(hit, `${name} 이 검출되어야 함`);
    assert.equal(hit?.severity, 'MEDIUM');
  });
}

test('detectProductNames(W32): "엠페이스 이벤트" → HIGH 격상', () => {
  const { violations } = detectProductNames('이번 달 엠페이스 이벤트를 진행합니다.');
  const hit = violations.find((v) => v.word === '엠페이스');
  assert.ok(hit);
  assert.equal(hit?.severity, 'HIGH');
});

/**
 * ⚠️ 오탐 방어의 핵심 — 맨 `온다` 는 절대 등록하지 않는다.
 *
 * '오다'의 활용형("환자가 온다", "다음 주에 온다")과 완전히 겹쳐서, 등록하면
 * 정상 글이 대량으로 막힌다. 복합어 `온다리프팅` 만 잡아야 한다.
 */
test('detectProductNames(W32): 동사 "온다"는 상품명으로 오탐되지 않는다', () => {
  for (const s of [
    '환자분이 내일 병원에 온다고 하셨습니다.',
    '겨울이 온다.',
    '연락이 온다면 안내해 드립니다.',
  ]) {
    const { violations } = detectProductNames(s);
    assert.equal(
      violations.some((v) => v.word.includes('온다')),
      false,
      `"${s}" 에서 상품명이 검출되면 안 된다`,
    );
  }
});

test('detectProductNames(W32): "온다리프팅"은 복합어로 검출된다', () => {
  const { violations } = detectProductNames('온다리프팅의 원리를 설명합니다.');
  assert.ok(violations.some((v) => v.word === '온다리프팅'));
});

/**
 * `엠페이스`와 기존 `튠페이스`는 접미사만 겹칠 뿐 부분문자열 관계가 아니다 —
 * 서로를 오탐하지 않아야 한다.
 */
test('detectProductNames(W32): 엠페이스 ↔ 튠페이스 상호 오탐 없음', () => {
  const a = detectProductNames('엠페이스 시술 안내입니다.').violations;
  assert.ok(a.some((v) => v.word === '엠페이스'));
  assert.ok(!a.some((v) => v.word === '튠페이스'));

  const b = detectProductNames('튠페이스 시술 안내입니다.').violations;
  assert.ok(b.some((v) => v.word === '튠페이스'));
  assert.ok(!b.some((v) => v.word === '엠페이스'));
});

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

// ── 2군: 유인 표현 → 2026-W30 부터 MEDIUM 위반으로 승격(검출·표시만, 치환 없음) ──
test('checkCompliance(W28): "선착순 이벤트" → 유인 위반 검출', () => {
  const r = checkCompliance('선착순 이벤트를 진행합니다.');
  assert.ok(r.violations.some((v) => v.rule.includes('유인')));
});

test('checkCompliance(W28): "한정 수량"·"동반 방문"·"지인 소개" → 유인 위반 검출', () => {
  for (const text of ['한정 수량으로 준비했습니다.', '동반 방문 시 안내해 드립니다.', '지인 소개로 오시는 분들이 많습니다.']) {
    const r = checkCompliance(text);
    assert.ok(r.violations.some((v) => v.rule.includes('유인')), `"${text}" 에서 유인 위반이 나와야 함`);
  }
});

test('checkCompliance(W28): "무료 검사"·"무료 시술" → 유인 위반 검출', () => {
  for (const text of ['무료 검사를 제공합니다.', '무료 시술 기회를 드립니다.']) {
    const r = checkCompliance(text);
    assert.ok(r.violations.some((v) => v.rule.includes('유인')), `"${text}" 에서 유인 위반이 나와야 함`);
  }
});

// ── 2군 오탐 배제: "무료 상담"은 기존 관행 — 유인 경고 미발생 ──
test('checkCompliance(W28): "무료 상담 가능" 은 유인 경고 오발 없음', () => {
  const r = checkCompliance('무료 상담 가능하니 편하게 문의하세요.');
  assert.ok(!r.warnings.some((w) => w.includes('유인')));
  assert.equal(r.violations.length, 0);
});

// ── 2군: 비급여 면제 → 경고, "책임 면제 조항"은 오탐 배제 ──
test('checkCompliance(W28): "비급여 검사비 면제" → 면제 위반 검출(MEDIUM 승격)', () => {
  const r = checkCompliance('비급여 검사비 면제 혜택을 드립니다.');
  assert.ok(r.violations.some((v) => v.rule.includes('면제') || v.rule.includes('유인')));
});

test('checkCompliance(W28): "책임 면제 조항" 은 면제 경고 오발 없음', () => {
  const r = checkCompliance('계약서의 책임 면제 조항을 확인하세요.');
  assert.ok(!r.warnings.some((w) => w.includes('면제')));
  assert.equal(r.violations.length, 0);
});

// ── 2군: 경험담 위장 표현 → warnings 검출 ──
test('checkCompliance(W28): "실제 후기입니다" → 후기 위반 검출(MEDIUM 승격)', () => {
  const r = checkCompliance('실제 후기입니다. 참고하세요.');
  assert.ok(r.violations.some((v) => v.rule.includes('후기') || v.rule.includes('경험담')));
});

test('checkCompliance(W28): "내돈내산"·"직접 받아보니" → 경험담 위장 위반 검출', () => {
  for (const text of ['내돈내산 솔직 리뷰를 남깁니다.', '직접 받아보니 어땠는지 공유합니다.']) {
    const r = checkCompliance(text);
    assert.ok(
      r.violations.some((v) => v.rule.includes('후기') || v.rule.includes('경험담')),
      `"${text}" 에서 경험담 위반이 나와야 함`,
    );
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

// ── 2군: 위반으로 승격되더라도 **자동치환은 하지 않는다**(검출·표시만) ──
// 이 단언이 핵심 — 패턴 승격이 본문을 건드리기 시작하면 문맥 파괴 회귀다.
test('checkCompliance(W28): 2군 유인 표현은 위반으로 잡히되 원문은 변형하지 않는다', () => {
  const src = '한정 수량, 동반 방문, 지인 소개 안내.';
  const r = checkCompliance(src);
  assert.ok(r.violations.length > 0, '유인 표현은 위반으로 표면화되어야 한다');
  assert.equal(r.filteredContent, src, '원문 무변형 — 패턴 승격분은 자동치환 금지');
});

// ── 보존 회귀: 기존 정상 문구들이 여전히 통과하는지 ──
test('checkCompliance(W28): 정상 문구 보존 — 경보·치환 오발 없음', () => {
  const r = checkCompliance('정기적인 검진과 전문의 상담 후 치료 방향을 결정합니다.');
  assert.equal(r.violations.length, 0);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.isCompliant, true);
});

// ═══════════════════════════════════════════════════════════════
// 2026-W29 주간 리서치 반영 — 실손·실비(WARNING)·GLP-1 신약 2종·후기 유인 표현(LOW)
// ═══════════════════════════════════════════════════════════════

// ── 1군: 신규 전문의약품(한글) 단독 등장 → MEDIUM 검출 ──
const W29_NEW_DRUGS = ['레타트루타이드', '레타트루티드', '에페글레나타이드'];
for (const name of W29_NEW_DRUGS) {
  test(`detectProductNames(W29): "${name}" 단독 → MEDIUM 검출`, () => {
    const { violations } = detectProductNames(`${name}에 대해 알아보겠습니다.`);
    const hit = violations.find((v) => v.word === name);
    assert.ok(hit, `${name} 이 검출되어야 함`);
    assert.equal(hit?.severity, 'MEDIUM');
  });
}

test('detectProductNames(W29): "레타트루타이드 처방" → 유인 근접으로 HIGH 격상', () => {
  const { violations } = detectProductNames('레타트루타이드 처방 상담을 받아보세요.');
  const hit = violations.find((v) => v.word === '레타트루타이드');
  assert.ok(hit);
  assert.equal(hit?.severity, 'HIGH');
});

// ── 1군: 영문 신규 상품명 단독 → MEDIUM 검출 ──
const W29_EN_DRUGS = ['Retatrutide', 'Efpeglenatide'];
for (const name of W29_EN_DRUGS) {
  test(`detectProductNames(W29): 영문 "${name}" 단독 → MEDIUM 검출`, () => {
    const { violations } = detectProductNames(`${name} 성분과 작용 원리를 설명합니다.`);
    const hit = violations.find((v) => v.word === name);
    assert.ok(hit, `${name} 이 검출되어야 함`);
    assert.equal(hit?.severity, 'MEDIUM');
  });
}

// ── 1군: 표기 2종은 서로 오탐 없이 독립 매칭(부분문자열 충돌 없음) ──
test('detectProductNames(W29): "레타트루티드"는 티드 표기 1건만 검출(타이드 오탐 없음)', () => {
  const { violations } = detectProductNames('레타트루티드 임상 결과를 소개합니다.');
  assert.ok(violations.some((v) => v.word === '레타트루티드'));
  assert.ok(!violations.some((v) => v.word === '레타트루타이드'));
});

// ── 1군: 신규 상품명도 자동치환 금지(검출만) 원칙 유지 ──
test('checkCompliance(W29): 신규 상품명은 filteredContent 에서 치환되지 않음', () => {
  const r = checkCompliance('레타트루타이드와 에페글레나타이드, Retatrutide 에 대해 알아봅니다.');
  assert.ok(r.filteredContent.includes('레타트루타이드'));
  assert.ok(r.filteredContent.includes('에페글레나타이드'));
  assert.ok(r.filteredContent.includes('Retatrutide'));
  assert.ok(r.violations.length >= 3);
});

// ── 실손·실비: WARNING(검출·표시만) — 4개 승인 표현 + 붙여쓰기 변형 ──
test('checkCompliance(W29): 실손·실비 표현 4종 → 실손 경고 검출', () => {
  for (const text of [
    '실손 적용 가능한 시술입니다.',
    '실비 처리 도와드립니다.',
    '실비 청구 방법을 안내합니다.',
    '실손 청구 가능 여부를 확인해 드립니다.',
  ]) {
    const r = checkCompliance(text);
    assert.ok(r.warnings.some((w) => w.includes('실손')), `"${text}" 에서 실손 경고가 나와야 함`);
  }
});

test('checkCompliance(W29): 붙여쓰기 변형(실손적용·실비청구)도 검출', () => {
  for (const text of ['실손적용 되는 항목입니다.', '실비청구 서류를 챙겨드립니다.']) {
    const r = checkCompliance(text);
    assert.ok(r.warnings.some((w) => w.includes('실손')), `"${text}" 에서 실손 경고가 나와야 함`);
  }
});

test('checkCompliance(W29): 실손·실비 표현은 warnings 로만 표면화(치환·violations 없음)', () => {
  const r = checkCompliance('실손 적용 안내입니다.');
  assert.equal(r.violations.length, 0);
  assert.equal(r.filteredContent, '실손 적용 안내입니다.', '원문 무변형');
  assert.ok(r.warnings.some((w) => w.includes('실손')));
});

// ── 실손·실비 오탐 배제: "실손보험 가입 여부" 류 정보성 문맥 미매칭 ──
test('checkCompliance(W29): "실손보험 가입 여부 확인" 은 실손 경고 오발 없음', () => {
  const r = checkCompliance('실손보험 가입 여부를 미리 확인하시기 바랍니다.');
  assert.ok(!r.warnings.some((w) => w.includes('실손')));
  assert.equal(r.violations.length, 0);
});

// ── 후기 유인 표현(LOW): 체험단 모집·후기 이벤트·후기 작성 시 → 검출·표시만 ──
test('checkCompliance(W29): "체험단 모집"·"후기 이벤트"·"후기 작성 시" → 후기 유인 위반 검출', () => {
  for (const text of ['체험단 모집 안내입니다.', '후기 이벤트에 참여하세요.', '후기 작성 시 안내해 드립니다.']) {
    const r = checkCompliance(text);
    assert.ok(
      r.violations.some((v) => v.rule.includes('후기') || v.rule.includes('유인')),
      `"${text}" 에서 대가성 후기 유인 위반이 나와야 함`
    );
  }
});

test('checkCompliance(W29): 후기 유인 표현은 위반이되 원문은 변형하지 않는다', () => {
  const src = '체험단 모집 안내.';
  const r = checkCompliance(src);
  assert.ok(r.violations.length > 0);
  assert.equal(r.filteredContent, src, '원문 무변형 — 자동치환 금지');
});

// ── autoFix 는 W29 신규 항목을 자동치환하지 않음 ──
test('autoFix(W29): 신규 상품명·실손·후기 유인 표현은 자동치환하지 않음', () => {
  const src = '레타트루타이드 안내와 실손 적용, 체험단 모집 안내';
  const { fixed } = autoFix(src);
  assert.equal(fixed, src);
});

// ── 보존 회귀: 정상 문구가 W29 패턴에 오발되지 않음 ──
test('checkCompliance(W29): 정상 문구 보존 — "정기적인" 등 오발 없음', () => {
  const r = checkCompliance('정기적인 검진과 전문의 상담 후 치료 방향을 결정합니다.');
  assert.equal(r.violations.length, 0);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.isCompliant, true);
});

/* ════════════════════════════════════════════════════════════════════════
 * 2026-07-28: 활용형 공백 회귀 고정.
 *
 * 실측 배경 — 이 블록을 넣기 전 A층 리콜은 **5/29** 였다. FORBIDDEN_WORDS 가
 * '부작용 없음' 같은 고정 명사형만 담고 있어, 한국어 용언 활용("없이·없는·
 * 않습니다")과 사이에 낀 수식어("부작용 걱정 없이")를 통째로 놓쳤다.
 * 의료광고법 준수가 닥터포스트의 USP 인데 가장 전형적인 위반 문구가 뚫려 있었다.
 *
 * 아래 두 축을 함께 고정한다. 한쪽만 지키면 의미가 없다:
 *   ① 리콜 — 잡아야 할 표현을 반드시 잡는다 (recall 우선)
 *   ② 정밀도 — 조건·확인 서술 같은 **정상 임상 문장**은 잡지 않는다
 *      ("통증이 없으면 방치하기 쉽습니다" 를 CRITICAL 로 막으면 발행이 멈춘다)
 * ════════════════════════════════════════════════════════════════════════ */

/** 반드시 검출되어야 하는 표현 — 놓치면 의료광고법 위반이 그대로 발행된다. */
const MUST_CATCH: ReadonlyArray<readonly [string, string]> = [
  ['부작용 없이', '부작용 없이 자연스럽게 개선됩니다.'],
  ['부작용 걱정 없이', '부작용 걱정 없이 받으실 수 있습니다.'],
  ['부작용이 전혀 없습니다', '부작용이 전혀 없습니다.'],
  ['부작용 제로', '부작용 제로를 자신합니다.'],
  ['통증 없이', '통증 없이 진행됩니다.'],
  ['흉터 없이', '흉터 없이 회복됩니다.'],
  ['흉터가 남지 않습니다', '흉터가 남지 않습니다.'],
  ['후유증 없이', '후유증 없이 일상 복귀가 가능합니다.'],
  ['재발 없이', '재발 없이 유지됩니다.'],
  ['재발하지 않습니다', '한 번 시술로 재발하지 않습니다.'],
  ['효과를 보장', '효과를 보장해 드립니다.'],
  ['확실히 개선', '확실히 개선됩니다.'],
  ['반드시 좋아집니다', '반드시 좋아집니다.'],
  ['누구나 효과', '누구나 효과를 볼 수 있습니다.'],
  ['누구나 안전하게', '누구나 안전하게 받으실 수 있습니다.'],
  ['최상의', '최상의 결과를 드립니다.'],
  ['압도적', '압도적인 수술 건수를 보유하고 있습니다.'],
  ['독보적', '독보적인 기술력입니다.'],
  ['타 병원보다', '타 병원보다 뛰어난 결과입니다.'],
  ['다른 곳보다', '다른 곳보다 저렴합니다.'],
];

for (const [label, text] of MUST_CATCH) {
  test(`checkCompliance(리콜): "${label}" 은 반드시 검출된다`, () => {
    const r = checkCompliance(text);
    const caught = r.violations.length > 0 || r.warnings.length > 0;
    assert.ok(caught, `놓침 — 검출되어야 하는 표현: « ${text} »`);
  });
}

/** 정상 임상 문장 — 잡히면 발행이 막히므로 반드시 통과해야 한다. */
const MUST_NOT_CATCH: ReadonlyArray<readonly [string, string]> = [
  ['통증이 없으면', '통증이 없으면 오히려 방치하기 쉽습니다.'],
  ['증상이 없어도', '증상이 없어도 정기 검진은 필요합니다.'],
  ['재발이 없는지', '재발이 없는지 정기적으로 확인합니다.'],
  ['부작용이 없을까', '부작용이 없을까 걱정하시는 분이 많습니다.'],
  ['염증이 없어도', '염증이 없어도 통증이 생길 수 있습니다.'],
  ['흉터가 남을 수', '흉터가 남을 수 있어 관리가 필요합니다.'],
  ['부작용 설명', '시술 전 부작용에 대해 충분히 설명드립니다.'],
  ['부작용 가능성', '드물게 부작용이 나타날 수 있습니다.'],
  ['무통분만', '무통분만을 원하시는 산모분께 안내드립니다.'],
  ['무통주사', '무통주사에 대해 설명드립니다.'],
  ['만족도 조사', '진료 후 만족도 조사를 진행하고 있습니다.'],
  ['재발 위험', '재발 위험을 낮추기 위한 관리법을 안내합니다.'],
  ['통증 관리', '시술 후 통증 관리를 도와드립니다.'],
];

for (const [label, text] of MUST_NOT_CATCH) {
  test(`checkCompliance(정밀도): "${label}" 은 오탐되지 않는다`, () => {
    const r = checkCompliance(text);
    assert.equal(
      r.violations.length,
      0,
      `오탐 — 정상 임상 문장이 위반으로 잡혔다: « ${text} » → ${r.violations.map((v) => v.word).join(', ')}`,
    );
    assert.equal(r.warnings.length, 0, `오탐(경고) — « ${text} »`);
  });
}

/** 무위해 단정은 발행 게이트가 걸리는 등급이어야 한다 — 표면화만으로는 부족하다. */
test('checkCompliance: "부작용 없이" 는 CRITICAL 로 승격된다', () => {
  const r = checkCompliance('부작용 없이 자연스럽게 개선됩니다.');
  const v = r.violations.find((x) => x.severity === 'CRITICAL');
  assert.ok(v, `CRITICAL 위반이 있어야 함 — 실제: ${JSON.stringify(r.violations)}`);
});

/** 자동치환 금지 원칙 — 새로 넣은 패턴도 본문을 건드리지 않는다. */
test('checkCompliance: 신규 패턴도 본문을 자동치환하지 않는다', () => {
  const src = '부작용 없이 통증 없이 흉터 없이 진행됩니다.';
  const { fixed } = autoFix(src);
  assert.equal(fixed, src);
});

/* ════════════════════════════════════════════════════════════════════════
 * 2026-07-28 교차검증(Codex) 반영 — 오탐 3종·우회 4종 고정.
 *
 * 1차 보강 직후 검토에서 나온 실제 결함이다. 리콜만 올리고 끝냈으면
 * **안전 절차 문장과 보험 안내가 발행 차단**될 뻔했다.
 * ════════════════════════════════════════════════════════════════════════ */

/** 정상 문장인데 CRITICAL 로 막히던 사례 — 발행 게이트 회귀 방지. */
const CODEX_FALSE_POSITIVES: ReadonlyArray<readonly [string, string]> = [
  // 안전 절차 서술 — 오히려 권장되는 문장이다.
  ['부작용 안내 없이', '부작용 안내 없이 시술하지 않습니다.'],
  ['부작용 설명 없이', '부작용 설명 없이 진행하지 않습니다.'],
  // 환자군·조건 설명
  ['통증이 없는 경우', '통증이 없는 경우에도 검사가 필요합니다.'],
  ['흉터가 없는 환자', '흉터가 없는 환자도 정기적으로 관찰합니다.'],
  ['재발이 없는 분', '재발이 없는 분도 추적 관찰이 필요합니다.'],
  // 보험 안내 어휘 — '보장성/보장 범위/보장 내용'
  ['치료 보장성 보험', '치료 보장성 보험의 가입 조건을 확인하세요.'],
  ['치료 보장 범위', '치료 보장 범위는 보험사마다 다릅니다.'],
  ['치료 보장 내용', '치료 보장 내용을 보험사에 문의하세요.'],
];

for (const [label, text] of CODEX_FALSE_POSITIVES) {
  test(`checkCompliance(정밀도·교차검증): "${label}" 은 오탐되지 않는다`, () => {
    const r = checkCompliance(text);
    assert.equal(
      r.violations.length,
      0,
      `오탐 — 정상 문장이 위반으로 잡혔다: « ${text} » → ${r.violations.map((v) => `${v.word}(${v.severity})`).join(', ')}`,
    );
  });
}

/** 같은 주장인데 표기만 비틀어 빠져나가던 우회 변형. */
const CODEX_BYPASSES: ReadonlyArray<readonly [string, string]> = [
  ['남지는 않습니다', '흉터가 남지는 않습니다.'],
  ['재발하지는 않습니다', '재발하지는 않습니다.'],
  ['확실하게 개선', '확실하게 개선됩니다.'],
  ['반드시 더 좋아집니다', '반드시 더 좋아집니다.'],
  ['통증 발생 제로', '통증 발생 제로를 목표로 합니다.'],
  ['최상 수준', '최상 수준의 진료를 제공합니다.'],
  ['타의  추종(이중 공백)', '타의  추종을 불허합니다.'],
  ['국내  유일(이중 공백)', '국내  유일한 장비를 갖췄습니다.'],
];

for (const [label, text] of CODEX_BYPASSES) {
  test(`checkCompliance(리콜·교차검증): 우회 변형 "${label}" 도 검출된다`, () => {
    const r = checkCompliance(text);
    assert.ok(
      r.violations.length > 0 || r.warnings.length > 0,
      `놓침 — 우회 변형: « ${text} »`,
    );
  });
}

/**
 * ★ 최상급 확장은 **패턴**이어야 한다 — FORBIDDEN_WORDS 에 넣으면 autoFix 치환
 *   목록에 자동 편입되어 본문이 바뀐다. 실제로 '타의 추종을 불허합니다' 가
 *   '차별화된을 불허합니다' 로 문법까지 깨졌다(2026-07-28 교차검증).
 *   generate-content 는 autoFix 를 실제로 호출하므로 생성 본문에 그대로 반영된다.
 */
test('autoFix: 2026-07-28 신규 최상급·무위해 표현은 자동치환하지 않는다', () => {
  for (const src of [
    '타의 추종을 불허합니다.',
    '최상의 결과를 드립니다.',
    '압도적인 수술 건수를 보유하고 있습니다.',
    '독보적인 기술력입니다.',
    // ⚠️ '국내 유일한' 은 쓰지 않는다 — 기존 금지어 '유일한'(→'차별화된')이 이미
    //    치환하는 표현이라 신규 패턴 검증 표본으로 부적절하다(문법은 정상).
    '국내 유일 시술법입니다.',
    '부작용 없이 통증 없이 흉터 없이 진행됩니다.',
    '효과를 보장해 드립니다.',
  ]) {
    const { fixed } = autoFix(src);
    assert.equal(fixed, src, `자동치환되면 안 됨: « ${src} » → « ${fixed} »`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * 2026-07-28 교차검증 2라운드 — **회피 경로** 차단 고정.
 *
 * 1라운드에서 오탐을 없애려고 넣은 예외가 우회구가 됐다. recall 우선 정책에서
 * 회피구는 오탐보다 나쁘다 — 위반이 그대로 발행되기 때문이다.
 *   ① 8자 창에 '상담·안내' 가 **존재하기만 해도** 매칭을 포기 →
 *      "부작용 상담 걱정 없이" 가 통과했다. 배제를 바로 앞 어절로 한정했다.
 *   ② '보장' 뒤 명사(기간·금액·대상)를 무조건 배제 →
 *      "효과 보장 기간은 평생입니다" 가 통과했다. 같은 문장의 보험 문맥으로 바꿨다.
 * ════════════════════════════════════════════════════════════════════════ */

const ROUND2_BYPASS: ReadonlyArray<readonly [string, string]> = [
  ['부작용 상담 걱정 없이', '부작용 상담 걱정 없이 시술받으세요.'],
  ['부작용 설명 없이도 걱정 없이', '부작용 설명 없이도 걱정 없이 받으실 수 있습니다.'],
  ['통증 고지 걱정 없이', '통증 고지 걱정 없이 편안하게 받으세요.'],
  ['효과 보장 기간', '효과 보장 기간은 평생입니다.'],
  ['결과 보장 대상', '결과 보장 대상은 모든 환자입니다.'],
  ['만족 보장 금액', '만족 보장 금액을 전액 환불해 드립니다.'],
  ['치료 보장 내용에 완치', '치료 보장 내용에는 완치까지 포함됩니다.'],
];

for (const [label, text] of ROUND2_BYPASS) {
  test(`checkCompliance(회피차단): "${label}" 은 예외를 끼워 넣어도 검출된다`, () => {
    const r = checkCompliance(text);
    assert.ok(
      r.violations.length > 0 || r.warnings.length > 0,
      `회피 성공 — 예외 어휘로 검출을 우회했다: « ${text} »`,
    );
  });
}

/** 회피를 막느라 정상 문장을 다시 잡으면 안 된다 — 양쪽을 함께 고정한다. */
const ROUND2_STILL_NORMAL: ReadonlyArray<readonly [string, string]> = [
  ['부작용 안내 없이', '부작용 안내 없이 시술하지 않습니다.'],
  ['부작용 설명 없이', '부작용 설명 없이 진행하지 않습니다.'],
  ['치료 보장성 보험', '치료 보장성 보험의 가입 조건을 확인하세요.'],
  ['치료 보장 범위', '치료 보장 범위는 보험사마다 다릅니다.'],
  ['치료 보장 내용 문의', '치료 보장 내용을 보험사에 문의하세요.'],
];

for (const [label, text] of ROUND2_STILL_NORMAL) {
  test(`checkCompliance(회피차단 후에도 정상): "${label}" 은 여전히 통과한다`, () => {
    const r = checkCompliance(text);
    assert.equal(
      r.violations.length,
      0,
      `오탐 재발 — « ${text} » → ${r.violations.map((v) => `${v.word}(${v.severity})`).join(', ')}`,
    );
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * 2026-07-28 교차검증 3라운드 — 예외 방식 자체를 바꿨다.
 *
 * 2라운드까지는 "정규식 안에 문맥 예외를 넣는" 방식이었는데, 넣을 때마다
 * 회피구 아니면 비대칭 오탐이 생겼다:
 *   · 보험 문맥 배제 → 광고에 '가입/약관/비급여' 를 심으면 통과
 *   · 그 배제가 '보장' 뒤만 봐서, 보험 문맥이 앞에 오면 반대로 오탐
 *   · '걱정 없이' 를 무조건 CRITICAL → "걱정 없이 문의주세요" 안내가 차단
 *   · 범용 `하지 않` → "시술하지 않습니다" 같은 안전 서술이 차단
 * → 예외를 걷어내고 **머리 명사·후행 동사로 구분**하는 방식으로 바꿨다.
 * ════════════════════════════════════════════════════════════════════════ */

const ROUND3_MUST_CATCH: ReadonlyArray<readonly [string, string]> = [
  ['효과 보장, 지금 가입하세요', '효과 보장, 지금 가입하세요.'],
  ['결과를 보장합니다 + 약관', '결과를 보장합니다, 자세한 약관은 문의하세요.'],
  ['만족 보장 + 비급여', '만족 보장, 비급여 시술에도 적용됩니다.'],
  ['치료 효과를 보장 + 보험 무관', '치료 효과를 보장하며 보험과는 무관합니다.'],
  ['효과 보장 기간', '효과 보장 기간은 평생입니다.'],
  ['걱정 없이 시술받으세요', '부작용 상담 걱정 없이 시술받으세요.'],
  ['걱정 없이 편안하게 받으세요', '통증 고지 걱정 없이 편안하게 받으세요.'],
  ['재발하지 않습니다', '재발하지 않습니다.'],
  ['흉터가 남지는 않습니다', '흉터가 남지는 않습니다.'],
];

for (const [label, text] of ROUND3_MUST_CATCH) {
  test(`checkCompliance(3R 회피차단): "${label}" 검출`, () => {
    const r = checkCompliance(text);
    assert.ok(r.violations.length > 0 || r.warnings.length > 0, `놓침 — « ${text} »`);
  });
}

const ROUND3_MUST_NOT_CATCH: ReadonlyArray<readonly [string, string]> = [
  // 보험 안내 — 보험 문맥이 '보장' 앞에 와도 통과해야 한다(방향 비대칭 제거)
  ['보험 약관상 치료 보장 범위', '보험 약관상 치료 보장 범위가 제한됩니다.'],
  ['가입한 보험의 치료 보장 한도', '가입한 보험의 치료 보장 한도를 확인하세요.'],
  ['보험사별 치료 보장 내용', '보험사별 치료 보장 내용이 다릅니다.'],
  // ⚠️ '걱정 없이 + 문의/결정' 은 7라운드에서 **발행 차단 대상에서 표면화 대상으로**
  //    옮겼다. 아래 ROUND7 블록이 "검출은 되되 게이트는 막지 않는다"로 고정한다.
  // 주어가 병원인 안전 서술 — '하지 않습니다' 를 범용으로 잡으면 안 된다
  ['시술하지 않습니다', '부작용 설명 없이 시술하지 않습니다.'],
  ['진행하지 않습니다', '부작용 안내없이 진행하지 않습니다.'],
  // 연속 공백에도 예외가 유지되어야 한다(공백 수 비대칭 제거)
  ['안내   없이(공백3)', '부작용 안내   없이 진행하지 않습니다.'],
];

for (const [label, text] of ROUND3_MUST_NOT_CATCH) {
  test(`checkCompliance(3R 정밀도): "${label}" 은 통과한다`, () => {
    const r = checkCompliance(text);
    assert.equal(
      r.violations.length,
      0,
      `오탐 — « ${text} » → ${r.violations.map((v) => `${v.word}(${v.severity})`).join(', ')}`,
    );
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * 2026-07-28 교차검증 4라운드 — 좁히면서 생긴 리콜 손실 복구.
 *
 * 3라운드에서 오탐을 없애려고 범위를 좁혔더니 실제 위반이 빠졌다:
 *   · 발생 동사 목록에 '발생하지' 누락 → "부작용이 발생하지 않습니다" 통과
 *   · 보장 머리 명사를 3개로 축소 → "치료를 보장합니다", "호전을 보장" 통과
 *   · '걱정 없이' 후행 동사 허용목록 → "걱정 없이 오세요" 통과
 * 허용목록은 광고 문구를 다 셀 수 없어 구조적으로 뚫린다. 제외목록으로 뒤집었다.
 * ════════════════════════════════════════════════════════════════════════ */

const ROUND4_MUST_CATCH: ReadonlyArray<readonly [string, string]> = [
  ['부작용이 발생하지 않습니다', '부작용이 발생하지 않습니다.'],
  ['감염은 발생하지 않습니다', '감염은 발생하지 않습니다.'],
  ['합병증도 발생하지 않습니다', '합병증도 발생하지 않습니다.'],
  ['치료 성과를 보장', '치료 성과를 보장합니다.'],
  ['치료 효험을 보장', '치료 효험을 보장합니다.'],
  ['증상 개선을 보장', '증상 개선을 보장합니다.'],
  ['호전을 보장', '호전을 보장합니다.'],
  ['성공을 보장', '성공을 보장합니다.'],
  ['걱정 없이 오세요', '부작용에 대해서는 아무런 걱정 없이 오세요.'],
  ['걱정 없이 편안하게 지내세요', '부작용 가능성은 전혀 걱정 없이 편안하게 지내세요.'],
  ['걱정 없이 회복하세요', '통증이나 후유증은 조금도 걱정 없이 회복하세요.'],
];

for (const [label, text] of ROUND4_MUST_CATCH) {
  test(`checkCompliance(4R 리콜): "${label}" 검출`, () => {
    const r = checkCompliance(text);
    assert.ok(r.violations.length > 0 || r.warnings.length > 0, `놓침 — « ${text} »`);
  });
}

/**
 * 리콜을 되살리면서 보험 안내를 다시 잡으면 안 된다.
 * 보험 어휘는 조사가 없고("치료 보장 범위"), 광고는 조사가 붙는다("치료를 보장").
 */
const ROUND4_MUST_NOT_CATCH: ReadonlyArray<readonly [string, string]> = [
  ['보험 약관상 치료 보장 범위', '보험 약관상 치료 보장 범위가 제한됩니다.'],
  ['가입한 보험의 치료 보장 한도', '가입한 보험의 치료 보장 한도를 확인하세요.'],
  ['보험사별 치료 보장 내용', '보험사별 치료 보장 내용이 다릅니다.'],
  ['치료 보장성 보험', '치료 보장성 보험의 가입 조건을 확인하세요.'],
  // '걱정 없이 + 문의/결정' 은 ROUND7 블록으로 이관(표면화하되 게이트는 통과).
  ['시술하지 않습니다', '부작용 설명 없이 시술하지 않습니다.'],
  ['진행하지 않습니다', '부작용 안내없이 진행하지 않습니다.'],
];

for (const [label, text] of ROUND4_MUST_NOT_CATCH) {
  test(`checkCompliance(4R 정밀도): "${label}" 은 통과한다`, () => {
    const r = checkCompliance(text);
    assert.equal(
      r.violations.length,
      0,
      `오탐 — « ${text} » → ${r.violations.map((v) => `${v.word}(${v.severity})`).join(', ')}`,
    );
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * 2026-07-28 교차검증 5라운드.
 *   · 보험 안내의 서술형 "치료를 보장하는 상품" 이 CRITICAL 로 막혔다
 *     → 조사 유무로 가르려던 시도를 철회하고 성과 명사를 요구하도록 되돌렸다
 *   · "걱정 없이 상담 후 시술받으세요" 가 제외어 삽입으로 빠져나갔다
 *     → 제외 조건에 "뒤에 시술·치료 권유가 없을 것" 을 덧붙였다
 * ════════════════════════════════════════════════════════════════════════ */

const ROUND5_MUST_CATCH: ReadonlyArray<readonly [string, string]> = [
  ['걱정 없이 상담 후 시술받으세요', '부작용 걱정 없이 상담 후 시술받으세요.'],
  ['걱정 없이 문의 후 치료 시작', '후유증 걱정 없이 문의 후 치료를 시작하세요.'],
  ['걱정 없이 방문 상담 후 수술', '흉터 걱정 없이 방문 상담 후 수술받으세요.'],
];

for (const [label, text] of ROUND5_MUST_CATCH) {
  test(`checkCompliance(5R 회피차단): "${label}" 검출`, () => {
    const r = checkCompliance(text);
    assert.ok(r.violations.length > 0 || r.warnings.length > 0, `놓침 — « ${text} »`);
  });
}

const ROUND5_MUST_NOT_CATCH: ReadonlyArray<readonly [string, string]> = [
  // 보험 안내 서술형 — 조사가 붙어도 정상이다
  ['보험은 암 치료를 보장하는 상품', '보험은 암 치료를 보장하는 상품입니다.'],
  ['특약은 입원 치료를 보장', '해당 특약은 입원 치료를 보장합니다.'],
  ['질병 치료를 보장받을 수', '이 보험으로 질병 치료를 보장받을 수 있습니다.'],
  ['보장 내용 개선', '보험 보장 내용이 개선되었습니다.'],
];

for (const [label, text] of ROUND5_MUST_NOT_CATCH) {
  test(`checkCompliance(5R 정밀도): "${label}" 은 통과한다`, () => {
    const r = checkCompliance(text);
    assert.equal(
      r.violations.length,
      0,
      `오탐 — « ${text} » → ${r.violations.map((v) => `${v.word}(${v.severity})`).join(', ')}`,
    );
  });
}

/**
 * ★ 알려진 A층 공백 — **의도적으로 남긴 것**이다. 지우거나 슬쩍 메우지 말 것.
 *
 * 성과 명사 없는 "치료를 보장합니다" 단독은 A층에서 잡지 않는다.
 * 4라운드에서 `치료\s*(를|을)\s*보장` 을 넣었다가 5라운드에서 철회했다 —
 * 보험 안내에서 "보험은 암 치료를 보장하는 상품입니다",
 * "질병 치료를 보장받을 수 있습니다" 처럼 **같은 표기가 정상적으로** 쓰인다.
 * 어휘만으로는 광고와 보험 안내를 가를 수 없고, 이걸 CRITICAL 로 잡으면
 * 실손·보험 안내 글이 발행 게이트에 막힌다. 문맥 판단이 필요한 층위라
 * **B층 LLM 심의**에 맡긴다(3층 구조의 존재 이유가 이것이다).
 *
 * 이 테스트는 공백을 승인하는 것이 아니라 **공백의 위치를 못 박아** 두는 것이다.
 * 나중에 A층에서 잡도록 바꾼다면, 위 보험 문장들이 여전히 통과하는지 함께 확인해라.
 */
test('checkCompliance(알려진 공백): 성과 명사 없는 "치료를 보장" 은 A층이 아니라 B층 몫', () => {
  const adClaim = checkCompliance('치료를 보장합니다.');
  const insurance = checkCompliance('보험은 암 치료를 보장하는 상품입니다.');
  // 현재 A층은 둘을 구분하지 못하므로 **둘 다** 통과시킨다(오탐 회피 우선).
  assert.equal(adClaim.violations.length, 0, '현재 A층 동작 — 바뀌면 위 주석을 갱신하라');
  assert.equal(insurance.violations.length, 0, '보험 안내는 반드시 통과해야 한다');
  // 성과 명사가 붙으면 A층이 잡는다 — 공백의 경계를 함께 고정한다.
  assert.ok(checkCompliance('치료 성과를 보장합니다.').violations.length > 0);
  assert.ok(checkCompliance('치료 효과를 보장합니다.').violations.length > 0);
});

/* ════════════════════════════════════════════════════════════════════════
 * 2026-07-28 교차검증 6라운드.
 *   · "걱정 없이 상담받으세요" 가 CRITICAL 이 됐다 — 제외어(상담) 자신의
 *     활용형에 든 '받으' 를 시술 권유로 오인했다.
 *   · 무제한 후방 탐색 `[^.!?\n]*` 이 O(n²) 스캔을 되살렸다.
 *   → 광고 문형의 실제 신호인 '후'(상담 후 시술)로 좁히고 창을 고정했다.
 * ════════════════════════════════════════════════════════════════════════ */

// 6R 의 '걱정 없이 상담받으세요' 류는 ROUND7 블록으로 이관했다
// (표면화는 하되 발행 게이트는 통과 — 아래 참조).

/**
 * ★ 의도된 동작 — 오탐이 아니다.
 *
 * "부작용 걱정 없이" 처럼 위해 명사에 **바로 붙는** 형태는 8자 창의 주 패턴이
 * 잡는다. 뒤에 무엇이 오든(문의·상담이어도) 그 어구 자체가 무위해 단정이다.
 * 반면 "부작용에 대해 설명드리니 걱정 없이 문의주세요" 는 위해 명사와 거리가 멀어
 * 주 패턴이 닿지 않고, 전용 규칙이 '문의' 로 끝나는 안내를 빼 준다.
 * 이 거리 차이가 의도적이라는 것을 못 박아 둔다.
 */
test('checkCompliance(6R 의도): "부작용 걱정 없이"는 뒤 서술과 무관하게 CRITICAL 이다', () => {
  const near = checkCompliance('부작용 걱정 없이 문의하시면 진료 진행 여부를 안내합니다.');
  assert.ok(
    near.violations.some((v) => v.severity === 'CRITICAL'),
    '위해 명사에 바로 붙은 형태는 CRITICAL 이어야 한다',
  );
});

/**
 * ReDoS·이차 스캔 회귀 방지. 6라운드에서 무제한 후방 탐색으로 O(n²) 가 생겼었다.
 * 후보가 수백 개인 긴 문장도 즉시 끝나야 한다.
 */
test('checkCompliance(6R 성능): 반복 후보가 많은 긴 문장도 선형 시간에 끝난다', () => {
  const long = '부작용 걱정 없이 상담 '.repeat(400) + '입니다.';
  const started = process.hrtime.bigint();
  checkCompliance(long);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 500, `이차 스캔 의심 — ${long.length}자에 ${elapsedMs.toFixed(1)}ms`);
});

/* ════════════════════════════════════════════════════════════════════════
 * 2026-07-28 교차검증 7라운드 — 접근을 바꿨다.
 *
 * 3~6라운드 내내 같은 일이 반복됐다. '걱정 없이' 규칙의 예외를 좁히면 정상
 * 안내가 발행 차단되고, 넓히면 광고가 빠져나갔다. 6라운드에서 '후' 를 필수
 * 신호로 본 가정도 "상담하고 시술받으세요", "상담 및 시술 진행" 앞에서 무너졌다.
 *
 * 어떤 어휘 조합으로도 "환자의 걱정을 덜어주는 안내"와 "무위해 광고"를 가를 수
 * 없다. 그건 문맥 판단이고 A층(키워드)의 일이 아니다.
 *
 * → 예외를 전부 걷어내고 **거리로 확신도를 나눈다**:
 *     · 위해 명사에 바로 붙은 형태(8자 창) → CRITICAL. 어구 자체가 무위해 단정이다.
 *     · 멀리 떨어진 형태(20자 창)       → MEDIUM. 표면화만 하고 게이트는 통과.
 *
 * 이 변경으로 **리콜이 올라간다** — 제외어가 없으니 회피구가 원리적으로 없다.
 * 동시에 정상 안내가 발행 차단되지 않는다. 확정 판단은 B층 LLM 몫이다.
 * (기대값을 낮춘 것이 아니라, 검출과 차단을 분리한 것이다.)
 * ════════════════════════════════════════════════════════════════════════ */

/** 발행 게이트 등급 — server-publish-gate 와 같은 기준. */
const BLOCKING: ReadonlySet<string> = new Set(['HIGH', 'CRITICAL']);

/** 7라운드 이전에는 회피하던 광고 문장들 — 이제 전부 검출된다. */
const ROUND7_NO_BYPASS: ReadonlyArray<readonly [string, string]> = [
  ['상담하고 시술받으세요', '부작용에 대해 설명드리니 걱정 없이 상담하고 시술받으세요.'],
  ['상담 및 시술 진행', '부작용 가능성을 안내드리니 걱정 없이 상담 및 시술 진행하세요.'],
  ['긴 수식어 후 시술', '부작용에 대해 설명드리니 걱정 없이 상담 후 자세한 문진과 계획을 검토하고 시술받으세요.'],
  ['상담 후 시술받으세요', '부작용 걱정 없이 상담 후 시술받으세요.'],
  ['걱정 없이 오세요', '부작용에 대해서는 아무런 걱정 없이 오세요.'],
];

for (const [label, text] of ROUND7_NO_BYPASS) {
  test(`checkCompliance(7R 회피불가): "${label}" 은 어떤 연결형이어도 검출된다`, () => {
    const r = checkCompliance(text);
    assert.ok(r.violations.length > 0, `회피 성공 — « ${text} »`);
  });
}

/**
 * 정상 안내 문장 — **검출은 되되 발행을 막지 않아야** 한다.
 * 이 두 가지를 함께 단언하는 것이 이번 설계의 핵심이다.
 * 한쪽만 보면 "오탐이 늘었다" 거나 "검출이 느슨해졌다" 로 잘못 읽힌다.
 */
const ROUND7_SURFACED_NOT_BLOCKED: ReadonlyArray<readonly [string, string]> = [
  ['걱정 없이 문의주세요', '부작용에 대해 설명드리니 걱정 없이 문의주세요.'],
  ['걱정 없이 결정하세요', '부작용 가능성을 충분히 안내받고 걱정 없이 결정하세요.'],
  ['걱정 없이 문의해 주세요', '통증이 지속될까 걱정 없이 문의해 주세요.'],
  ['걱정 없이 상담받으세요', '부작용에 대해 설명드리니 걱정 없이 상담받으세요.'],
  ['걱정 없이 상담을 진행하세요', '부작용 가능성을 안내드리니 걱정 없이 상담을 진행하세요.'],
];

for (const [label, text] of ROUND7_SURFACED_NOT_BLOCKED) {
  test(`checkCompliance(7R 표면화): "${label}" 은 검출되되 발행을 막지 않는다`, () => {
    const r = checkCompliance(text);
    assert.ok(r.violations.length > 0, `표면화되지 않았다 — « ${text} »`);
    const blocking = r.violations.filter((v) => BLOCKING.has(v.severity));
    assert.deepEqual(
      blocking.map((v) => `${v.word}(${v.severity})`),
      [],
      `정상 안내가 발행 차단됐다 — « ${text} »`,
    );
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * 2026-07-28 교차검증 8라운드 — 시술 권유를 '예외'가 아니라 '승격 신호'로.
 *
 * 7라운드의 "거리로 확신도를 나눈다"에 두 구멍이 있었다:
 *   ① 거리가 멀어도 명백한 광고가 있다 — "부작용에 대해 안심하세요, 걱정 없이
 *      시술받으세요" 가 MEDIUM 이라 발행 게이트를 그냥 통과했다.
 *   ② "제외어가 없으니 회피구가 없다"는 주장이 틀렸다. **창 자체가 회피구**였다.
 *      20자를 넘기면 표면화조차 안 돼, 안내 문구를 길게 끼우면 완전 회피됐다.
 *
 * → 뒤따르는 시술 권유를 예외 조건이 아니라 **승격 신호**로 쓴다. 예외로 쓰면
 *   제외어를 심어 회피할 수 있지만, 승격은 추가 규칙이라 회피가 성립하지 않는다.
 *   기본 창도 45자로 넓혀 긴 수식어 끼우기를 막았다.
 *
 * 아래 세 묶음은 **함께** 봐야 한다. 하나만 보면 설계를 잘못 읽는다.
 * ════════════════════════════════════════════════════════════════════════ */

const GATE_BLOCKING: ReadonlySet<string> = new Set(['HIGH', 'CRITICAL']);

/** ① 발행이 막혀야 하는 명백한 광고. */
const ROUND8_MUST_BLOCK: ReadonlyArray<readonly [string, string]> = [
  ['안심하세요 + 시술받으세요', '부작용에 대해 안심하세요, 걱정 없이 시술받으세요.'],
  [
    '긴 안내 후 시술받으세요(20자 초과)',
    '부작용에 대해서는 충분한 설명과 상담 및 개인별 진료 계획을 안내드리니 걱정 없이 시술받으세요.',
  ],
  ['상담하고 시술받으세요', '부작용에 대해 설명드리니 걱정 없이 상담하고 시술받으세요.'],
  ['상담 및 시술 진행', '부작용 가능성을 안내드리니 걱정 없이 상담 및 시술 진행하세요.'],
  ['문의 후 치료 시작', '후유증 걱정 없이 문의 후 치료를 시작하세요.'],
  ['방문 상담 후 수술', '흉터 걱정 없이 방문 상담 후 수술받으세요.'],
];

for (const [label, text] of ROUND8_MUST_BLOCK) {
  test(`checkCompliance(8R 차단): "${label}" 은 발행이 막힌다`, () => {
    const r = checkCompliance(text);
    assert.ok(
      r.violations.some((v) => GATE_BLOCKING.has(v.severity)),
      `게이트를 통과했다 — « ${text} » → ${r.violations.map((v) => `${v.word}(${v.severity})`).join(', ') || '검출 없음'}`,
    );
  });
}

/** ② 표면화는 되되 발행은 막지 않아야 하는 정상 안내. */
const ROUND8_SURFACE_ONLY: ReadonlyArray<readonly [string, string]> = [
  ['걱정 없이 문의주세요', '부작용에 대해 설명드리니 걱정 없이 문의주세요.'],
  ['걱정 없이 상담받으세요', '부작용에 대해 설명드리니 걱정 없이 상담받으세요.'],
  ['걱정 없이 상담을 진행하세요', '부작용 가능성을 안내드리니 걱정 없이 상담을 진행하세요.'],
  ['걱정 없이 오세요', '부작용에 대해서는 아무런 걱정 없이 오세요.'],
];

for (const [label, text] of ROUND8_SURFACE_ONLY) {
  test(`checkCompliance(8R 표면화): "${label}" 은 검출되되 발행은 통과한다`, () => {
    const r = checkCompliance(text);
    assert.ok(r.violations.length > 0, `표면화되지 않았다 — « ${text} »`);
    assert.deepEqual(
      r.violations.filter((v) => GATE_BLOCKING.has(v.severity)).map((v) => v.word),
      [],
      `정상 안내가 발행 차단됐다 — « ${text} »`,
    );
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * 2026-07-28 교차검증 9라운드 (마지막).
 *
 * 승격 규칙이 시술·치료 **명사의 등장**만 보고 CRITICAL 을 매겼다. 명사가 있다고
 * 권유인 것은 아니다 — "걱정 없이 상담받으시고 **치료 여부를 결정하세요**",
 * "치료의 장단점을 확인하세요", "치료하지 않을 수도 있습니다" 가 전부 막혔다.
 * 오히려 권장되는 안내다. → 명사 뒤에 **권유 어미**가 붙을 때만 승격한다.
 *
 * ★ 여기서 라운드를 멈춘다. 3~9라운드가 확인해 준 것은 하나다 —
 *   "환자를 안심시키는 안내"와 "무위해 광고"의 경계는 어휘 규칙으로 그을 수 없다.
 *   창을 늘리면 O(n²) 로 가고, 예외를 늘리면 회피구가 생긴다. 남은 경계 판단은
 *   B층 LLM 심의의 몫이고, A층은 여기까지가 정직한 한계다.
 * ════════════════════════════════════════════════════════════════════════ */

const ROUND9_SURFACE_ONLY: ReadonlyArray<readonly [string, string]> = [
  ['치료 여부를 결정하세요', '부작용에 대해 설명드리니 걱정 없이 상담받으시고 치료 여부를 결정하세요.'],
  ['치료하지 않을 수도 있습니다', '부작용에 대해 설명드리니 걱정 없이 상담받으시고 치료하지 않을 수도 있습니다.'],
  ['치료의 장단점을 확인하세요', '부작용에 대해 설명드리니 걱정 없이 상담받으시고 치료의 장단점을 확인하세요.'],
];

for (const [label, text] of ROUND9_SURFACE_ONLY) {
  test(`checkCompliance(9R): "${label}" 은 치료 명사가 있어도 발행을 막지 않는다`, () => {
    const r = checkCompliance(text);
    assert.ok(r.violations.length > 0, `표면화되지 않았다 — « ${text} »`);
    assert.deepEqual(
      r.violations.filter((v) => GATE_BLOCKING.has(v.severity)).map((v) => `${v.word}(${v.severity})`),
      [],
      `명사 등장만으로 차단됐다 — « ${text} »`,
    );
  });
}

test('checkCompliance(9R): 권유 어미가 붙으면 여전히 차단된다', () => {
  for (const text of [
    '부작용에 대해 안심하세요, 걱정 없이 시술받으세요.',
    '후유증 걱정 없이 문의 후 치료를 시작하세요.',
    '흉터 걱정 없이 방문 상담 후 수술받으세요.',
  ]) {
    const r = checkCompliance(text);
    assert.ok(
      r.violations.some((v) => GATE_BLOCKING.has(v.severity)),
      `권유 문장이 게이트를 통과했다 — « ${text} »`,
    );
  }
});
