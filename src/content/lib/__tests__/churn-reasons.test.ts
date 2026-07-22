import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHURN_REASON_CODES,
  isValidChurnReason,
  normalizeChurnDetail,
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
