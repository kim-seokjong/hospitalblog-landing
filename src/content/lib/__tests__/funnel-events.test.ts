import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FUNNEL_EVENTS,
  isFunnelEvent,
  isValidAnonId,
  generateAnonId,
  sanitizeMeta,
  validateFunnelBody,
  readFunnelLimits,
  consumeFunnelQuota,
  funnelKstDayKey,
  MAX_META_BYTES,
  DEFAULT_FUNNEL_IP_DAILY_LIMIT,
  DEFAULT_FUNNEL_GLOBAL_DAILY_LIMIT,
} from '../funnel-events.ts';

// ── isFunnelEvent ──
test('isFunnelEvent: 화이트리스트만 통과', () => {
  for (const e of FUNNEL_EVENTS) assert.equal(isFunnelEvent(e), true);
  assert.equal(isFunnelEvent('landing_view'), true);
  assert.equal(isFunnelEvent('signup_complete'), true);
  assert.equal(isFunnelEvent('arbitrary'), false);
  assert.equal(isFunnelEvent(''), false);
  assert.equal(isFunnelEvent(null), false);
  assert.equal(isFunnelEvent(123), false);
});

// ── anon_id ──
test('isValidAnonId: 32자리 소문자 hex 만 허용', () => {
  assert.equal(isValidAnonId('0123456789abcdef0123456789abcdef'), true);
  assert.equal(isValidAnonId('0123456789ABCDEF0123456789ABCDEF'), false); // 대문자 거부
  assert.equal(isValidAnonId('short'), false);
  assert.equal(isValidAnonId('0123456789abcdef0123456789abcde'), false); // 31자
  assert.equal(isValidAnonId('0123456789abcdef0123456789abcdefg'), false); // 33자·비hex
  assert.equal(isValidAnonId(null), false);
  assert.equal(isValidAnonId(42), false);
});

test('generateAnonId: 항상 유효한 32 hex 를 만든다', () => {
  const id = generateAnonId();
  assert.equal(isValidAnonId(id), true);
  // 주입 난수로 결정성 확인 (전부 0.0 → 모두 '0')
  assert.equal(generateAnonId(() => 0), '00000000000000000000000000000000');
  // 0.9999 → floor(15.99)=15 → 'f'
  assert.equal(generateAnonId(() => 0.9999), 'f'.repeat(32));
});

test('generateAnonId: 서로 다른 값 (충돌 낮음)', () => {
  const set = new Set<string>();
  for (let i = 0; i < 50; i += 1) set.add(generateAnonId());
  assert.equal(set.size, 50);
});

// ── sanitizeMeta ──
test('sanitizeMeta: 1단 원시값 맵만 허용', () => {
  assert.deepEqual(sanitizeMeta({ a: 'x', n: 3, b: true, z: null }), {
    a: 'x',
    n: 3,
    b: true,
    z: null,
  });
});

test('sanitizeMeta: 비객체·배열은 null', () => {
  assert.equal(sanitizeMeta(null), null);
  assert.equal(sanitizeMeta('str'), null);
  assert.equal(sanitizeMeta(123), null);
  assert.equal(sanitizeMeta([1, 2, 3]), null);
  assert.equal(sanitizeMeta(undefined), null);
});

test('sanitizeMeta: 중첩·함수·배열 값은 제거', () => {
  assert.deepEqual(sanitizeMeta({ ok: 'v', nested: { a: 1 }, arr: [1], fn: () => 1 }), {
    ok: 'v',
  });
});

test('sanitizeMeta: 빈 맵/전부 제거되면 null', () => {
  assert.equal(sanitizeMeta({}), null);
  assert.equal(sanitizeMeta({ nested: { a: 1 } }), null);
});

test('sanitizeMeta: 문자열 200자 절단', () => {
  const long = 'a'.repeat(500);
  const out = sanitizeMeta({ s: long }) as Record<string, string>;
  assert.equal(out.s.length, 200);
});

test('sanitizeMeta: 무한/NaN 숫자 제거', () => {
  assert.equal(sanitizeMeta({ x: Infinity }), null);
  assert.equal(sanitizeMeta({ x: NaN }), null);
});

test('sanitizeMeta: MAX_META_BYTES 초과면 null', () => {
  const big = 'b'.repeat(190);
  const meta: Record<string, string> = {};
  for (let i = 0; i < 40; i += 1) meta[`k${i}`] = big; // 40 * ~190 > 2048
  const bytes = Buffer.byteLength(JSON.stringify(meta), 'utf8');
  assert.ok(bytes > MAX_META_BYTES);
  assert.equal(sanitizeMeta(meta), null);
});

// ── validateFunnelBody ──
test('validateFunnelBody: 정상 이벤트 + meta', () => {
  const r = validateFunnelBody({ event: 'signup_complete', meta: { plan: 'free' } });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.event, 'signup_complete');
    assert.deepEqual(r.value.meta, { plan: 'free' });
  }
});

test('validateFunnelBody: meta 없으면 null', () => {
  const r = validateFunnelBody({ event: 'landing_view' });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.meta, null);
});

test('validateFunnelBody: 미허용 이벤트 거부', () => {
  const r = validateFunnelBody({ event: 'hack_event' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'invalid_event');
});

test('validateFunnelBody: 비객체 본문 거부', () => {
  assert.equal(validateFunnelBody(null).ok, false);
  assert.equal(validateFunnelBody('x').ok, false);
  assert.equal(validateFunnelBody([]).ok, false);
});

// ── readFunnelLimits ──
test('readFunnelLimits: env 조절, 비정상은 기본값', () => {
  assert.deepEqual(readFunnelLimits({} as NodeJS.ProcessEnv), {
    ipDaily: DEFAULT_FUNNEL_IP_DAILY_LIMIT,
    globalDaily: DEFAULT_FUNNEL_GLOBAL_DAILY_LIMIT,
  });
  assert.deepEqual(
    readFunnelLimits({ FUNNEL_IP_DAILY_LIMIT: '10', FUNNEL_GLOBAL_DAILY_LIMIT: '100' } as NodeJS.ProcessEnv),
    { ipDaily: 10, globalDaily: 100 },
  );
  assert.deepEqual(
    readFunnelLimits({ FUNNEL_IP_DAILY_LIMIT: '-5', FUNNEL_GLOBAL_DAILY_LIMIT: 'x' } as NodeJS.ProcessEnv),
    { ipDaily: DEFAULT_FUNNEL_IP_DAILY_LIMIT, globalDaily: DEFAULT_FUNNEL_GLOBAL_DAILY_LIMIT },
  );
});

// ── consumeFunnelQuota ──
test('consumeFunnelQuota: IP 캡 도달 시 ip_limit', () => {
  const store = new Map<string, number>();
  const limits = { ipDaily: 2, globalDaily: 100 };
  const now = Date.parse('2026-07-22T02:00:00+09:00');
  assert.deepEqual(consumeFunnelQuota(store, { ip: '1.1.1.1', now, limits }), { allowed: true });
  assert.deepEqual(consumeFunnelQuota(store, { ip: '1.1.1.1', now, limits }), { allowed: true });
  assert.deepEqual(consumeFunnelQuota(store, { ip: '1.1.1.1', now, limits }), {
    allowed: false,
    reason: 'ip_limit',
  });
});

test('consumeFunnelQuota: 전체 캡 도달 시 global_limit (IP 무관)', () => {
  const store = new Map<string, number>();
  const limits = { ipDaily: 100, globalDaily: 2 };
  const now = Date.parse('2026-07-22T02:00:00+09:00');
  assert.equal(consumeFunnelQuota(store, { ip: 'a', now, limits }).allowed, true);
  assert.equal(consumeFunnelQuota(store, { ip: 'b', now, limits }).allowed, true);
  assert.deepEqual(consumeFunnelQuota(store, { ip: 'c', now, limits }), {
    allowed: false,
    reason: 'global_limit',
  });
});

test('consumeFunnelQuota: 날짜 경계 넘으면 카운터 초기화', () => {
  const store = new Map<string, number>();
  const limits = { ipDaily: 1, globalDaily: 100 };
  const day1 = Date.parse('2026-07-22T02:00:00+09:00');
  const day2 = Date.parse('2026-07-23T02:00:00+09:00');
  assert.equal(consumeFunnelQuota(store, { ip: 'x', now: day1, limits }).allowed, true);
  assert.equal(consumeFunnelQuota(store, { ip: 'x', now: day1, limits }).allowed, false);
  // 다음날 → 다시 허용 + 지난 키 정리
  assert.equal(consumeFunnelQuota(store, { ip: 'x', now: day2, limits }).allowed, true);
});

test('funnelKstDayKey: KST 경계', () => {
  // UTC 2026-07-21T15:00Z == KST 2026-07-22T00:00 → '2026-07-22'
  assert.equal(funnelKstDayKey(Date.parse('2026-07-21T15:00:00Z')), '2026-07-22');
  assert.equal(funnelKstDayKey(Date.parse('2026-07-21T14:59:00Z')), '2026-07-21');
});
