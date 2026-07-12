import test from 'node:test';
import assert from 'node:assert/strict';
import { publishBlockReason } from '../publish-gate.ts';

test('publishBlockReason: 검사 스냅샷이 없으면 차단 (검사 먼저 안내)', () => {
  const reason = publishBlockReason(null);
  assert.ok(reason);
  assert.match(reason ?? '', /검사/);
  assert.equal(publishBlockReason(undefined) !== null, true);
});

test('publishBlockReason: HIGH·CRITICAL 등급은 차단', () => {
  for (const grade of ['HIGH', 'CRITICAL']) {
    const reason = publishBlockReason({ grade, needsManualReview: false });
    assert.ok(reason, grade);
    assert.match(reason ?? '', /검수/);
  }
});

test('publishBlockReason: needsManualReview=true 는 등급과 무관하게 차단', () => {
  const reason = publishBlockReason({ grade: 'PASS', needsManualReview: true });
  assert.ok(reason);
});

test('publishBlockReason: PASS·LOW·MEDIUM(검수 불필요)은 통과 — geo-export 와 동일 기준', () => {
  for (const grade of ['PASS', 'LOW', 'MEDIUM']) {
    assert.equal(publishBlockReason({ grade, needsManualReview: false }), null, grade);
  }
});
