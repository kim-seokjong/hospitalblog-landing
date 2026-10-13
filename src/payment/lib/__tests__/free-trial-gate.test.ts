import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE_TRIAL_ACCESSORY_PER_POST,
  freeTrialAccessoryVerdict,
  freeTrialPreBodyAllowed,
  freeTrialPreBodyVerdict,
} from '../free-trial-gate.ts';

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

// ── 본문 뒤 부속 기능(이미지·태그 등) — 10/13 대표 결정 ② ──
const acc = (freeCredits: unknown, recentBodies: number, recentAccessories: number) =>
  freeTrialAccessoryVerdict({ freeCredits, recentBodies, recentAccessories });

test('한 편 쓴 직후 — 이미지·태그가 열린다', () => {
  assert.equal(acc(1, 1, 0), 'ok');
  assert.equal(acc(0, 2, FREE_TRIAL_ACCESSORY_PER_POST), 'ok'); // 두 편이면 두 배
});
test('⛔다 쓴 계정이 최근 본문 없이 — 닫힌다 (예전엔 free_credits 0 이 무제한 통과)', () => {
  assert.equal(acc(0, 0, 0), 'no_body');
});
test('⛔재가입 회수 계정(가입 즉시 0, 본문 로그 0) — 닫힌다', () => {
  assert.equal(acc(0, 0, 5), 'no_body');
});
test('크레딧을 안 쓴 계정 — 본문 로그가 있어도 닫힌다(무료 본문이 아니다)', () => {
  assert.equal(acc(2, 3, 0), 'no_body');
});
test('본문 수는 쓴 크레딧을 넘지 못한다 — 상한이 부풀지 않는다', () => {
  assert.equal(acc(1, 5, FREE_TRIAL_ACCESSORY_PER_POST), 'capped');
});
test('본문당 상한에 닿으면 닫힌다', () => {
  assert.equal(acc(1, 1, FREE_TRIAL_ACCESSORY_PER_POST - 1), 'ok');
  assert.equal(acc(1, 1, FREE_TRIAL_ACCESSORY_PER_POST), 'capped');
});
test('값이 이상하면 닫힌다', () => {
  assert.equal(acc(null, 1, 0), 'invalid');
  assert.equal(acc(Number.NaN, 1, 0), 'invalid');
  assert.equal(acc(1, Number.NaN, 0), 'invalid');
});
