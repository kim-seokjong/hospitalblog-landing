import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isUndefinedColumn,
  isUndefinedTable,
  runWithOptionalColumns,
} from '../optional-columns.ts';

/**
 * 회귀 고정 — 2026-08-03.
 *
 * 이 저장소의 마이그레이션은 대표가 SQL Editor 에서 **수동 적용**하는데 배포는
 * 자동이다. 즉 코드가 컬럼보다 먼저 도착하는 구간이 반드시 생긴다. 그 구간에서
 * 새 컬럼에 쓰면 기능이 통째로 죽는다 — 그래서 "있으면 쓰고 없으면 뺀다".
 */

test('컬럼 없음 오류를 코드·메시지 양쪽으로 알아본다', () => {
  assert.equal(isUndefinedColumn({ code: '42703' }), true);
  assert.equal(isUndefinedColumn({ code: 'PGRST204' }), true);
  assert.equal(isUndefinedColumn({ message: 'column "key_version" does not exist' }), true);
  assert.equal(
    isUndefinedColumn({ message: "Could not find the 'billing_key_id' column of 'care_onboarding'" }),
    true,
  );
});

test('다른 오류를 컬럼 없음으로 오인하지 않는다', () => {
  assert.equal(isUndefinedColumn({ code: '23505', message: 'duplicate key' }), false);
  assert.equal(isUndefinedColumn({ code: '42P01', message: 'relation does not exist' }), false);
  assert.equal(isUndefinedColumn(null), false);
  assert.equal(isUndefinedColumn(undefined), false);
});

test('테이블 없음은 별도로 구분한다', () => {
  assert.equal(isUndefinedTable({ code: '42P01' }), true);
  assert.equal(isUndefinedTable({ code: '42703' }), false);
});

test('컬럼이 있으면 새 컬럼까지 함께 쓴다', async () => {
  const seen: Record<string, unknown>[] = [];
  const result = await runWithOptionalColumns(
    { id: 'a' },
    { key_version: 2 },
    async (row) => {
      seen.push(row);
      return { error: null };
    },
  );
  assert.equal(result.error, null);
  assert.equal(result.extraApplied, true);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { id: 'a', key_version: 2 });
});

test('컬럼이 없으면 빼고 한 번만 더 시도한다', async () => {
  const seen: Record<string, unknown>[] = [];
  const result = await runWithOptionalColumns({ id: 'a' }, { key_version: 2 }, async (row) => {
    seen.push(row);
    return 'key_version' in row
      ? { error: { code: '42703', message: 'column "key_version" does not exist' } }
      : { error: null };
  });
  assert.equal(result.error, null);
  assert.equal(result.extraApplied, false);
  assert.equal(seen.length, 2, '두 번째 시도는 새 컬럼 없이 가야 한다');
  assert.deepEqual(seen[1], { id: 'a' });
});

/**
 * ⚠️ 컬럼 문제가 아닌 오류를 재시도로 삼키면, 진짜 실패가 조용히 성공처럼 보인다.
 */
test('다른 오류는 재시도하지 않고 그대로 돌려준다', async () => {
  let calls = 0;
  const result = await runWithOptionalColumns({ id: 'a' }, { key_version: 2 }, async () => {
    calls += 1;
    return { error: { code: '23505', message: 'duplicate key' } };
  });
  assert.equal(calls, 1);
  assert.equal(result.error?.code, '23505');
  assert.equal(result.extraApplied, false);
});
