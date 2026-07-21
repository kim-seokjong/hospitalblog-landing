import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reserveDetailSlot,
  type ReservationStore,
} from '../blog-check-reservation.ts';

/**
 * DB 원자 예약 흐름 검증 — 저장소는 라우트가 service-role 클라이언트로 구현해
 * 주입한다(anon 경로에는 쓰기 RLS 정책이 없음). 여기서는 가짜 저장소로
 * insert-then-count 순서·실패 전이·인메모리 폴백을 검증한다.
 */

interface CallLog {
  inserts: Array<{ userId: string; blogId: string }>;
  counts: Array<{ startIso: string; endIso: string }>;
  marks: Array<{ id: string; status: string }>;
}

function fakeStore(behavior: {
  insertId?: string | null;
  count?: number | null;
}): { store: ReservationStore; log: CallLog } {
  const log: CallLog = { inserts: [], counts: [], marks: [] };
  const store: ReservationStore = {
    async insertPending(userId, blogId) {
      log.inserts.push({ userId, blogId });
      return behavior.insertId === undefined ? 'res-1' : behavior.insertId;
    },
    async countToday(_userId, startIso, endIso) {
      log.counts.push({ startIso, endIso });
      return behavior.count === undefined ? 1 : behavior.count;
    },
    async mark(id, status) {
      log.marks.push({ id, status });
      return true;
    },
  };
  return { store, log };
}

const NOW = Date.parse('2026-07-22T03:00:00Z'); // KST 2026-07-22 12:00

test('reserveDetailSlot: 예약 성공 — INSERT 가 COUNT 보다 먼저(원자 예약), KST 범위로 카운트', async () => {
  const { store, log } = fakeStore({ insertId: 'res-1', count: 3 });
  const out = await reserveDetailSlot({
    store,
    memoryStore: new Map(),
    userId: 'u1',
    blogId: 'clinic1',
    limit: 5,
    now: NOW,
  });
  assert.deepEqual(out, { mode: 'db', id: 'res-1' });
  assert.equal(log.inserts.length, 1); // insert-then-count 순서
  assert.equal(log.counts.length, 1);
  assert.equal(log.counts[0].startIso, '2026-07-21T15:00:00.000Z'); // KST 오늘 경계
  assert.equal(log.marks.length, 0);
});

test('reserveDetailSlot: 한도 초과 — 자기 예약 행을 failed 로 전이 후 denied', async () => {
  const { store, log } = fakeStore({ insertId: 'res-9', count: 6 }); // 자기 행 포함 6 > limit 5
  const out = await reserveDetailSlot({
    store,
    memoryStore: new Map(),
    userId: 'u1',
    blogId: 'clinic1',
    limit: 5,
    now: NOW,
  });
  assert.deepEqual(out, { mode: 'denied', limit: 5 });
  assert.deepEqual(log.marks, [{ id: 'res-9', status: 'failed' }]);
});

test('reserveDetailSlot: COUNT 실패(null)는 진행 — 예약 행이 영속 하한 유지(그레이스풀)', async () => {
  const { store, log } = fakeStore({ insertId: 'res-2', count: null });
  const out = await reserveDetailSlot({
    store,
    memoryStore: new Map(),
    userId: 'u1',
    blogId: 'clinic1',
    limit: 5,
    now: NOW,
  });
  assert.deepEqual(out, { mode: 'db', id: 'res-2' });
  assert.equal(log.marks.length, 0);
});

test('reserveDetailSlot: INSERT 실패(테이블 미적용) → 인메모리 폴백 소비', async () => {
  const { store } = fakeStore({ insertId: null });
  const memoryStore = new Map<string, number>();

  for (let i = 0; i < 2; i++) {
    const out = await reserveDetailSlot({
      store,
      memoryStore,
      userId: 'u1',
      blogId: 'clinic1',
      limit: 2,
      now: NOW,
    });
    assert.deepEqual(out, { mode: 'memory' });
  }
  // 폴백도 원자 소비 — 한도 도달 시 denied
  const denied = await reserveDetailSlot({
    store,
    memoryStore,
    userId: 'u1',
    blogId: 'clinic1',
    limit: 2,
    now: NOW,
  });
  assert.deepEqual(denied, { mode: 'denied', limit: 2 });
});

test('reserveDetailSlot: store 자체가 없으면(service key 미설정) 즉시 인메모리 폴백', async () => {
  const memoryStore = new Map<string, number>();
  const out = await reserveDetailSlot({
    store: null,
    memoryStore,
    userId: 'u1',
    blogId: 'clinic1',
    limit: 5,
    now: NOW,
  });
  assert.deepEqual(out, { mode: 'memory' });
  assert.equal(memoryStore.size > 0, true); // 소비 흔적
});
