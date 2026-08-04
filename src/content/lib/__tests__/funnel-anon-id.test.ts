import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANON_ID_STORAGE_KEY,
  isValidAnonId,
  readOrCreateAnonId,
  resolveAnonId,
  validateFunnelBody,
} from '../funnel-events.ts';

/**
 * 회귀 고정 — 2026-08-04.
 *
 * anon_id 를 서버 쿠키로만 발급했더니 **한 사람이 둘로 세어졌다.**
 * `/clinic-check` 는 마운트 시 `landing_view` 를 쏘고, 콜드메일 링크의 `?name=` 이 있으면
 * 같은 틱에 자동 조회가 시작돼 `diagnosis_run` 도 쏜다. 두 요청이 **동시에** 나가
 * 둘 다 쿠키를 못 받은 상태라 서버가 각각 새 ID 를 줬다.
 * 실측: `02:20:29.740406` / `02:20:29.741029` — 0.0006초 차이, 서로 다른 anon_id.
 * 그 패턴을 메일 스캐너로 오독하기까지 했다. 그래서 클라가 먼저 정한 ID 를 받는다.
 */

const VALID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

test('클라가 보낸 anon_id 를 받는다', () => {
  const r = validateFunnelBody({ event: 'landing_view', anonId: VALID });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value.anonId, VALID);
});

/** ⚠️ 형식이 어긋나면 **조용히 버린다** — 그 값 때문에 이벤트를 통째로 잃으면 안 된다. */
test('형식이 틀린 anon_id 는 버리되 이벤트는 살린다', () => {
  for (const bad of ['', 'ZZZ', 'A1B2C3D4E5F60718293A4B5C6D7E8F90', VALID + 'a', 123, null, {}]) {
    const r = validateFunnelBody({ event: 'landing_view', anonId: bad });
    assert.equal(r.ok, true, `${String(bad)} 에서도 이벤트는 통과해야 한다`);
    assert.equal(r.ok && r.value.anonId, undefined);
  }
});

test('anon_id 가 없어도 기존대로 동작한다', () => {
  const r = validateFunnelBody({ event: 'landing_view' });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value.anonId, undefined);
});

/** 클라가 만드는 값과 서버 검증 형식이 같아야 한다(32자리 소문자 hex). */
test('형식 규칙 — 32자리 소문자 hex', () => {
  assert.equal(isValidAnonId(VALID), true);
  assert.equal(isValidAnonId(VALID.toUpperCase()), false);
  assert.equal(isValidAnonId(VALID.slice(0, 31)), false);
});

/** 잘못된 anonId 가 meta 검증을 망가뜨리지 않는지. */
test('anonId 가 섞여도 meta 는 그대로 새니타이즈된다', () => {
  const r = validateFunnelBody({
    event: 'landing_view',
    anonId: 'bad',
    meta: { path: '/clinic-check', source: 'mail0804s2' },
  });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value.meta?.path, '/clinic-check');
  assert.equal(r.ok && r.value.meta?.source, 'mail0804s2');
});

/* ── 서버: 어느 ID 를 쓸 것인가 ─────────────────────────── */

const OTHER = 'ffffffff00000000ffffffff00000000';
const gen = () => '0'.repeat(32);

/**
 * ⚠️ **클라 제공값이 쿠키보다 우선한다** (2026-08-04 교차검증으로 뒤집음).
 *    쿠키를 우선하면 기존 방문자의 쿠키와 새로 생긴 localStorage 가 영구히 어긋난다 —
 *    평소엔 쿠키로 기록되다가 쿠키가 지워지는 순간 localStorage 값이 살아나
 *    같은 사람이 다른 방문자로 바뀐다. 클라 우선이면 쿠키가 따라와 한 번에 수렴한다.
 */
test('클라 제공값이 쿠키보다 우선한다 — 그래야 둘이 수렴한다', () => {
  const r = resolveAnonId(OTHER, VALID, gen);
  assert.equal(r.anonId, VALID);
  assert.equal(r.source, 'client');
});

test('클라 값이 없거나 형식이 틀리면 쿠키를 쓴다', () => {
  assert.equal(resolveAnonId(OTHER, undefined, gen).anonId, OTHER);
  assert.equal(resolveAnonId(OTHER, 'bad', gen).anonId, OTHER);
  assert.equal(resolveAnonId(OTHER, 'bad', gen).source, 'cookie');
});

test('둘 다 없으면 새로 발급한다', () => {
  const r = resolveAnonId(undefined, undefined, gen);
  assert.equal(r.source, 'generated');
  assert.equal(isValidAnonId(r.anonId), true);
});

/* ── 클라이언트: 한 번 정하면 계속 같은 값 ───────────────── */

function memoryStorage(seed?: string) {
  const map = new Map<string, string>();
  if (seed) map.set(ANON_ID_STORAGE_KEY, seed);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

/**
 * ★ 이 테스트가 원래 사고를 고정한다 — 같은 페이지가 동시에 두 이벤트를 쏴도
 *   **같은 ID** 여야 한다. 예전엔 서버가 각각 새로 발급해 한 사람이 둘로 세어졌다.
 */
test('동시에 여러 번 불러도 같은 ID 를 돌려준다', () => {
  const store = memoryStorage();
  let n = 0;
  const rnd = () => String(n++).padStart(32, 'a');
  const first = readOrCreateAnonId(store, rnd);
  const second = readOrCreateAnonId(store, rnd);
  const third = readOrCreateAnonId(store, rnd);
  assert.equal(first, second);
  assert.equal(second, third);
});

test('이미 저장된 값이 있으면 그대로 쓴다', () => {
  const store = memoryStorage(VALID);
  assert.equal(readOrCreateAnonId(store, () => OTHER), VALID);
});

test('저장된 값이 깨져 있으면 새로 만들어 덮어쓴다', () => {
  const store = memoryStorage('깨진값');
  assert.equal(readOrCreateAnonId(store, () => OTHER), OTHER);
  assert.equal(store._map.get(ANON_ID_STORAGE_KEY), OTHER);
});

/**
 * ⚠️ 시크릿 모드·저장소 차단에서는 접근 자체가 던진다. 그때 **매 요청 새 값**을
 *    돌려주면 지금 고치려는 문제(한 사람이 여럿)가 그대로 재현된다 — 그래서 포기한다.
 *    서버가 기존대로 쿠키로 발급하므로 예전 동작으로 떨어질 뿐이다.
 */
test('저장소가 막히면 값을 만들지 않고 서버에 맡긴다', () => {
  const blocked = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  };
  assert.equal(readOrCreateAnonId(blocked, () => OTHER), undefined);
  assert.equal(readOrCreateAnonId(null, () => OTHER), undefined);
  assert.equal(readOrCreateAnonId(undefined, () => OTHER), undefined);
});

test('난수 생성기가 형식을 어기면 값을 쓰지 않는다', () => {
  const store = memoryStorage();
  assert.equal(readOrCreateAnonId(store, () => 'nope'), undefined);
  assert.equal(store._map.size, 0, '깨진 값을 저장소에 남기지 않는다');
});
