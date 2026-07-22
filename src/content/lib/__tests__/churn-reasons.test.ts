import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHURN_REASON_CODES,
  isValidChurnReason,
  normalizeChurnDetail,
  maskChurnPii,
  validateChurnBody,
  CHURN_DETAIL_MAX,
} from '../churn-reasons.ts';

test('isValidChurnReason: 화이트리스트만 통과', () => {
  for (const c of CHURN_REASON_CODES) assert.equal(isValidChurnReason(c), true);
  assert.equal(isValidChurnReason('too_expensive'), true);
  assert.equal(isValidChurnReason('hacked'), false);
  assert.equal(isValidChurnReason(''), false);
  assert.equal(isValidChurnReason(null), false);
});

test('normalizeChurnDetail: 제어문자 제거·공백 접기·길이 절단', () => {
  assert.equal(normalizeChurnDetail('  너무   비싸요\n\t 정말 '), '너무 비싸요 정말');
  assert.equal(normalizeChurnDetail('a\u0007b'), 'a b'); // 제어문자 to 공백
  assert.equal(normalizeChurnDetail(''), null);
  assert.equal(normalizeChurnDetail('   '), null);
  assert.equal(normalizeChurnDetail(123), null);
});

test('normalizeChurnDetail: 최대 길이 절단', () => {
  const long = '가'.repeat(CHURN_DETAIL_MAX + 100);
  assert.equal(normalizeChurnDetail(long)?.length, CHURN_DETAIL_MAX);
});

// ── PII 마스킹 (이메일·전화번호 저장 금지) ──
test('maskChurnPii: 이메일 마스킹', () => {
  assert.equal(maskChurnPii('연락은 abc.def+1@clinic.co.kr 로 주세요'), '연락은 [이메일 마스킹] 로 주세요');
  assert.ok(!maskChurnPii('a@b.com b@c.net').includes('@'));
});

test('maskChurnPii: 전화번호 마스킹 (하이픈·공백·국가번호)', () => {
  assert.equal(maskChurnPii('010-1234-5678 로 전화주세요'), '[전화번호 마스킹] 로 전화주세요');
  assert.ok(!maskChurnPii('01012345678').includes('0101234'));
  assert.ok(!maskChurnPii('+82 10 1234 5678').includes('1234'));
  assert.ok(!maskChurnPii('02-123-4567').includes('4567'));
});

test('maskChurnPii: 금액·짧은 숫자는 보존', () => {
  assert.equal(maskChurnPii('월 199000원은 부담돼요'), '월 199000원은 부담돼요');
  assert.equal(maskChurnPii('글 14개 만들었어요'), '글 14개 만들었어요');
});

test('normalizeChurnDetail: 정규화 파이프라인에 PII 마스킹 포함', () => {
  const out = normalizeChurnDetail('  비싸요. 연락처: 010-1234-5678,  메일 a@b.com  ');
  assert.ok(out !== null);
  assert.ok(!out.includes('010'));
  assert.ok(!out.includes('a@b.com'));
  assert.ok(out.includes('[전화번호 마스킹]'));
  assert.ok(out.includes('[이메일 마스킹]'));
});

test('validateChurnBody: 정상/비정상', () => {
  const ok = validateChurnBody({ reason: 'quality', detail: '결과가 아쉬웠어요' });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.reason, 'quality');
    assert.equal(ok.detail, '결과가 아쉬웠어요');
  }
  assert.equal(validateChurnBody({ reason: 'quality' }).ok, true); // detail 선택
  assert.equal(validateChurnBody({ reason: 'nope' }).ok, false);
  assert.equal(validateChurnBody(null).ok, false);
  assert.equal(validateChurnBody([]).ok, false);
});
