import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCompliance } from '../../medical-compliance.ts';
import {
  EXCERPT_AFTER_MAX,
  EXCERPT_BEFORE_MAX,
  buildComplianceAxis,
  buildExcerpt,
  classifyComplianceRisk,
  demotionReasonFor,
  riskOf,
  type ComplianceSource,
} from '../compliance-scan.ts';

/**
 * 진단 화면의 "위험" 판정 회귀 테스트.
 *
 * ★ 왜 이 파일이 있나 (실측 사고).
 *   프라이브성형외과(blog.naver.com/newprive) 진단에서 "위험 — 환자 후기·치료경험담"
 *   9편이 떴는데, 실제 문장은 전부 후기를 믿지 말라는 정보성 서술이었다. 원장이 글을
 *   열어보면 즉시 오탐임을 알게 되고 진단 전체의 신뢰가 무너진다.
 *
 * ⚠️ 반대 방향도 같은 무게로 고정한다 — **진짜 환자 경험담은 계속 위험이어야 한다.**
 *    아래 두 묶음을 함께 통과해야만 이 변경이 유효하다.
 * ⚠️ 이 테스트는 **진단 화면의 표시 등급**만 검증한다. 고객 글 발행을 막는
 *    medical-compliance 의 검수 게이트는 이 변경의 대상이 아니다.
 */

/** 실제 글 1편을 흉내 낸 검사 표본. */
function sourceOf(title: string, body: string, bodyKind: 'full' | 'summary' = 'full'): ComplianceSource {
  return {
    title,
    link: `https://blog.naver.com/newprive/${title.length}`,
    text: `${title}\n${body}`,
    hasBody: bodyKind === 'full',
    bodyKind,
  };
}

function scan(title: string, body: string, bodyKind: 'full' | 'summary' = 'full') {
  return buildComplianceAxis([sourceOf(title, body, bodyKind)], checkCompliance);
}

/* ── ① 실측 오탐: 위험에서 내려와야 한다 ────────────────── */

/** 프라이브성형외과 RSS 50편에서 실제로 "위험"이 붙었던 문장들. */
const FALSE_POSITIVES: readonly (readonly [string, string])[] = [
  ['정보성 서술', '그런데 실제 후기를 찾아보시면, 같은 온다리프팅인데도 만족도가 제각각입니다.'],
  ['믿지 말라는 서술', "가장 조심하셔야 할 것은, 눈에 보이는 '추천'과 '후기'를 그대로 믿고 병원을 고르시는 일입니다."],
  ['의문형', '"가격이 비싸면 잘하는 걸까?" "후기가 많으면 믿을 만한 걸까?"'],
  ['의문형 나열', '성형외과를 찾으실 때 어떤 기준으로 고르시나요? "후기가 많은 곳?" "가격이 합리적인 곳?"'],
  ['일반론', '블로그나 SNS에서 접하는 시술 후기들을 보다 보면 자연스럽게 관심이 가실 수밖에 없죠.'],
  ['제3자 언급', '가격 차이도 크고, 후기도 많은데 뭘 믿어야 할지 모르겠다고들 하십니다.'],
  ['부정문 안의 무조건', "울써마지는 '함께 받으면 무조건 좋은 시술'이 아니라, 내 얼굴의 원인에 맞을 때 의미가 있는 조합입니다."],
  ['인용된 통념', "그래서 '지방이 많은 얼굴에는 무조건 효과가 좋다'고 생각하시는 분들이 많은데요."],
  ['의문형 무조건', '그렇다고 비싸다고 무조건 좋은 건가? 리뷰만으론 믿기 어렵고...'],
  ['효과와 무관한 100%', '저희가 100% 예약제로 하루 인원을 제한하고, 한 분 한 분 직접 진단해 드립니다.'],
];

for (const [name, body] of FALSE_POSITIVES) {
  test(`오탐(${name})은 위험이 아니라 주의로 내려간다`, () => {
    const axis = scan('대구리프팅, 알아두면 좋은 이야기', body);
    assert.equal(
      axis.prohibitedCount,
      0,
      `위험으로 잡힌 표현: ${axis.hits.filter((h) => riskOf(h) === 'prohibited').map((h) => h.phrase).join(', ')}`,
    );
  });
}

test('위험에서 내려도 목록에서 지우지는 않는다 — 원장이 문장을 읽고 판단해야 한다', () => {
  const axis = scan('대구리프팅 안내', '"후기가 많으면 믿을 만한 걸까?" 하는 고민을 많이 하십니다.');
  const hit = axis.hits.find((h) => h.phrase === '후기');
  assert.ok(hit, '후기 검출 자체는 남아 있어야 한다');
  assert.equal(riskOf(hit), 'caution');
  assert.match(hit.note, /위험.*올리지 않았어요/, '왜 위험이 아닌지 한 줄로 밝혀야 한다');
});

/* ── ② 진짜 경험담: 계속 위험이어야 한다 (recall 방어) ──── */

const TRUE_POSITIVES: readonly (readonly [string, string, string])[] = [
  ['직접 받아본 후기', '대구울쎄라 이야기', '직접 받아본 후기입니다. 시술 당일부터 얼굴선이 정리되는 느낌이었어요.'],
  ['3개월 지난 제 경험담', '대구울쎄라 이야기', '3개월 지난 제 경험담 후기입니다.'],
  ['1인칭 서사', '대구울쎄라 이야기', '저는 이 시술을 받고 나서 턱선이 좋아졌습니다.'],
  ['제목에 후기', '대구울쎄라피프라임, 키닥터가 말하는 후기', '오늘은 이 시술을 자세히 짚어보겠습니다.'],
  ['환자 후기 인용', '대구울쎄라 이야기', '실제 환자 후기를 그대로 옮겨 적어 드립니다.'],
  ['내돈내산', '대구울쎄라 이야기', '내돈내산으로 받아봤습니다.'],
];

for (const [name, title, body] of TRUE_POSITIVES) {
  test(`진짜 경험담(${name})은 그대로 위험으로 남는다`, () => {
    const axis = scan(title, body);
    assert.ok((axis.prohibitedCount ?? 0) > 0, '경험담이 위험에서 빠지면 안 된다');
    assert.ok(axis.hits.some((h) => riskOf(h) === 'prohibited' && h.riskLabel === '환자 후기·치료경험담'));
  });
}

/**
 * 문맥 완화 계층 단독 검증.
 *
 * ⚠️ 위 표본 중 "3개월 지난 제 경험담"·"…달라졌습니다" 처럼 **검출 규칙
 *    (medical-compliance)이 애초에 잡지 않는 문장**이 있다. 그건 이 변경의 범위가
 *    아니다(검수 게이트는 건드리지 않는다). 다만 우리 완화 계층이 그런 문장을
 *    "위험 아님"으로 판단하지는 않는다는 것까지는 여기서 고정한다.
 */
for (const sentence of [
  '3개월 지난 제 경험담입니다.',
  '직접 받아본 후기입니다.',
  '저는 이 시술로 턱선이 좋아졌습니다.',
  '내돈내산 후기 남깁니다.',
]) {
  test(`완화 계층은 진짜 경험담을 내리지 않는다: ${sentence}`, () => {
    assert.equal(demotionReasonFor('환자 후기·치료경험담', sentence), null);
  });
}

test('전후 비교·효과 보장 유형은 문맥 완화 대상이 아니다', () => {
  const before = scan('시술 안내', '시술 전후 사진을 함께 올려드립니다.');
  assert.ok((before.prohibitedCount ?? 0) > 0);

  const guarantee = scan('시술 안내', '이 시술은 부작용 없음이 확인된 치료라 결과를 보장해 드립니다.');
  assert.ok((guarantee.prohibitedCount ?? 0) > 0);
});

test('같은 단어가 여러 번 나오면 하나라도 진짜면 위험이다 (첫 매칭에 속지 않는다)', () => {
  const axis = scan(
    '대구울쎄라 이야기',
    '후기가 많으면 믿을 만한 걸까요? 저도 궁금했습니다. 그래서 직접 받아본 후기를 남깁니다.',
  );
  const hit = axis.hits.find((h) => h.phrase === '후기');
  assert.ok(hit);
  assert.equal(riskOf(hit), 'prohibited');
  assert.match(hit.excerpt?.match ?? '', /후기/);
  assert.match(hit.excerpt?.before ?? '', /직접 받아본/, '진짜 경험담 쪽 문장을 보여줘야 한다');
});

/* ── ③ 문맥 발췌 ───────────────────────────────────────── */

test('검출 단어의 앞뒤 문맥을 담고, 어디서 걸렸는지 표시한다', () => {
  const axis = scan('대구울쎄라피프라임, 키닥터가 말하는 후기', '오늘은 이 시술을 자세히 짚어보겠습니다.');
  const hit = axis.hits.find((h) => h.phrase === '후기');
  assert.ok(hit?.excerpt, '문맥이 있어야 한다');
  assert.equal(hit.excerpt.where, 'title', '제목에서 걸렸으면 제목이라고 말해야 한다');
  assert.equal(hit.excerpt.match, '후기');
  assert.match(hit.excerpt.before, /키닥터가 말하는/);
});

test('본문에서 걸리면 본문으로, 글 앞부분(RSS 요약)에서 걸리면 그렇게 표시한다', () => {
  const body = scan('평범한 제목', '상담을 하다 보면 후기 이야기를 자주 듣습니다.', 'full');
  assert.equal(body.hits.find((h) => h.phrase === '후기')?.excerpt?.where, 'body');

  const lead = scan('평범한 제목', '상담을 하다 보면 후기 이야기를 자주 듣습니다.', 'summary');
  assert.equal(lead.hits.find((h) => h.phrase === '후기')?.excerpt?.where, 'lead');
});

test('발췌 길이는 상한으로 묶는다 — 본문이 통째로 새지 않는다', () => {
  const filler = '가'.repeat(500);
  const axis = scan('평범한 제목', `${filler} 직접 받아본 후기입니다 ${filler}`);
  const excerpt = axis.hits.find((h) => h.phrase === '후기')?.excerpt;
  assert.ok(excerpt);
  assert.ok(excerpt.before.length <= EXCERPT_BEFORE_MAX, `before=${excerpt.before.length}`);
  assert.ok(excerpt.after.length <= EXCERPT_AFTER_MAX, `after=${excerpt.after.length}`);
  assert.equal(excerpt.clippedBefore, true);
  assert.equal(excerpt.clippedAfter, true);
});

test('발췌에서 전화번호·이메일은 가린다', () => {
  const source: ComplianceSource = {
    title: '안내',
    link: 'l',
    text: '안내\n예약 문의는 053-123-4567 또는 test.user@example.co.kr 로 주세요. 후기 부탁드립니다.',
    hasBody: true,
    bodyKind: 'full',
  };
  const excerpt = buildExcerpt(source, '후기', source.text.indexOf('후기'));
  assert.ok(excerpt);
  assert.ok(!excerpt.before.includes('053-123-4567'), '전화번호가 그대로 노출되면 안 된다');
  assert.ok(!excerpt.before.includes('test.user@example.co.kr'), '메일주소가 그대로 노출되면 안 된다');
});

test('본문에 남은 HTML 엔티티는 사람이 읽는 글자로 되돌린다', () => {
  const source: ComplianceSource = {
    title: '안내',
    link: 'l',
    text: '안내\n&#x27;함께 받으면 무조건 좋은 시술&#x27;이 아니라고 말씀드립니다.',
    hasBody: true,
    bodyKind: 'full',
  };
  const excerpt = buildExcerpt(source, '무조건', source.text.indexOf('무조건'));
  assert.ok(excerpt);
  assert.ok(!excerpt.before.includes('&#x27;'));
  assert.ok(excerpt.before.includes("'"));
});

test('발췌를 만들 수 없어도 항목은 남는다 (제목만 보여주는 폴백)', () => {
  const axis = buildComplianceAxis(
    [{ title: '제목', link: 'l', text: '제목', hasBody: false }],
    () => ({ violations: [], warnings: ['즉각적 효과 표현은 과장 광고로 해석될 수 있습니다.'] }),
  );
  assert.equal(axis.hits.length, 1);
  assert.equal(axis.hits[0].excerpt, undefined);
  assert.equal(axis.hits[0].risk, 'caution');
});

/* ── ④ 순수 판정 함수 ──────────────────────────────────── */

test('문맥을 주지 않으면 예전처럼 단어만으로 판단한다 (저장된 리포트 호환)', () => {
  assert.equal(classifyComplianceRisk('후기 환자 후기·경험담 광고 금지').risk, 'prohibited');
});

test('demotionReasonFor 는 완화 사유를 구분해 돌려준다', () => {
  assert.equal(demotionReasonFor('환자 후기·치료경험담', '후기가 많으면 믿을 만한 걸까?'), 'question');
  assert.equal(demotionReasonFor('환자 후기·치료경험담', '무조건 좋은 시술이 아니라고 말씀드립니다.'), 'refutation');
  assert.equal(demotionReasonFor('환자 후기·치료경험담', '블로그나 SNS에서 접하는 시술 후기들'), 'third_party');
  assert.equal(
    demotionReasonFor('치료효과 보장·부작용 없음 단정', '저희는 100% 예약제로 하루 인원을 제한합니다'),
    'no_outcome',
  );
  assert.equal(demotionReasonFor('환자 후기·치료경험담', '직접 받아본 후기입니다'), null);
});
