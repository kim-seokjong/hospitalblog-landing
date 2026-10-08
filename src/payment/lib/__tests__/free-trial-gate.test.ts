import test from 'node:test';
import assert from 'node:assert/strict';
import { freeTrialPreBodyAllowed, freeTrialPreBodyVerdict } from '../free-trial-gate.ts';

const NOW = new Date('2026-10-08T12:00:00Z');

test('갓 가입(2회 남음·기한 안) — 제목 단계가 열린다 (10/8 버그 재현)', () => {
  assert.equal(freeTrialPreBodyAllowed({ free_credits: 2, free_credits_expires_at: '2026-10-12T14:34:55Z' }, NOW), true);
});
test('갓 가입이지만 기한이 지났다 — 닫힌다', () => {
  assert.equal(freeTrialPreBodyAllowed({ free_credits: 2, free_credits_expires_at: '2026-09-23T15:29:48Z' }, NOW), false);
});
test('062 이전 가입(기한 NULL) — 열린다', () => {
  assert.equal(freeTrialPreBodyAllowed({ free_credits: 2, free_credits_expires_at: null }, NOW), true);
});
test('한 편 쓴 계정(1회 남음·기한 안) — 열린다', () => {
  assert.equal(freeTrialPreBodyAllowed({ free_credits: 1, free_credits_expires_at: '2026-10-12T00:00:00Z' }, NOW), true);
});
test('한 편 쓰고 기한이 지났다 — 닫힌다(본문을 못 쓴다)', () => {
  assert.equal(freeTrialPreBodyAllowed({ free_credits: 1, free_credits_expires_at: '2026-01-01T00:00:00Z' }, NOW), false);
});
test('다 쓴 계정·재가입 회수(0회) — 닫힌다', () => {
  assert.equal(freeTrialPreBodyAllowed({ free_credits: 0 }, NOW), false);
  assert.equal(freeTrialPreBodyVerdict({ free_credits: 0 }, NOW), 'exhausted');
  assert.equal(freeTrialPreBodyVerdict({ free_credits: 2, free_credits_expires_at: '2026-09-23T15:29:48Z' }, NOW), 'expired');
});
test('값이 없거나 이상하면 닫힌다', () => {
  assert.equal(freeTrialPreBodyAllowed({}, NOW), false);
  assert.equal(freeTrialPreBodyAllowed({ free_credits: null }, NOW), false);
  assert.equal(freeTrialPreBodyAllowed({ free_credits: Number.NaN }, NOW), false);
  assert.equal(freeTrialPreBodyAllowed({ free_credits: 2, free_credits_expires_at: 'not-a-date' }, NOW), false);
});
