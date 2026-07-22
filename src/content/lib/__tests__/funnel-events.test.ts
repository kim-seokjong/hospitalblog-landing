import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FUNNEL_EVENTS,
  PUBLIC_FUNNEL_EVENTS,
  isFunnelEvent,
  isPublicFunnelEvent,
  isValidAnonId,
  generateAnonId,
  sanitizeMeta,
  validateFunnelBody,
  readFunnelLimits,
  consumeFunnelQuota,
  funnelKstDayKey,
  ALLOWED_META_KEYS,
  MAX_META_STRING,
  DEFAULT_FUNNEL_IP_DAILY_LIMIT,
  DEFAULT_FUNNEL_GLOBAL_DAILY_LIMIT,
} from '../funnel-events.ts';

// ── isFunnelEvent (전체) ──
test('isFunnelEvent: 전체 화이트리스트만 통과', () => {
  for (const e of FUNNEL_EVENTS) assert.equal(isFunnelEvent(e), true);
  assert.equal(isFunnelEvent('landing_view'), true);
  assert.equal(isFunnelEvent('payment_success'), true);
  assert.equal(isFunnelEvent('arbitrary'), false);
  assert.equal(isFunnelEvent(''), false);
  assert.equal(isFunnelEvent(null), false);
  assert.equal(isFunnelEvent(123), false);
});

// ── isPublicFunnelEvent (공개 엔드포인트 = 저신뢰 이벤트만) ──
test('isPublicFunnelEvent: landing_view·signup_start 만 true', () => {
  assert.deepEqual([...PUBLIC_FUNNEL_EVENTS], ['landing_view', 'signup_start']);
  assert.equal(isPublicFunnelEvent('landing_view'), true);
  assert.equal(isPublicFunnelEvent('signup_start'), true);
  // 전환 확정 이벤트는 공개에서 거부 (서버 전용)
  assert.equal(isPublicFunnelEvent('signup_complete'), false);
  assert.equal(isPublicFunnelEvent('first_post_generated'), false);
  assert.equal(isPublicFunnelEvent('payment_success'), false);
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
  assert.equal(generateAnonId(() => 0), '00000000000000000000000000000000');
  assert.equal(generateAnonId(() => 0.9999), 'f'.repeat(32));
});

test('generateAnonId: 서로 다른 값 (충돌 낮음)', () => {
  const set = new Set<string>();
  for (let i = 0; i < 50; i += 1) set.add(generateAnonId());
  assert.equal(set.size, 50);
});

// ── sanitizeMeta (허용 키 화이트리스트) ──
test('sanitizeMeta: 허용 키만 유지, 그 외 드롭', () => {
  assert.deepEqual(
    sanitizeMeta({ plan: 'standard', value: 199000, free_credit: true, path: '/pricing' }),
    { plan: 'standard', value: 199000, free_credit: true, path: '/pricing' },
  );
  // 허용 목록에 없는 키(PII 가능)는 전부 드롭
  assert.equal(sanitizeMeta({ email: 'a@b.com', phone: '010', name: '홍길동' }), null);
  assert.deepEqual(sanitizeMeta({ plan: 'pro', secret: 'x' }), { plan: 'pro' });
});

test('sanitizeMeta: ALLOWED_META_KEYS 노출 + PII 키 미포함', () => {
  assert.ok(ALLOWED_META_KEYS.includes('plan'));
  assert.ok(ALLOWED_META_KEYS.includes('hospital_type'));
  assert.ok(!ALLOWED_META_KEYS.includes('email'));
  assert.ok(!ALLOWED_META_KEYS.includes('phone'));
});

test('sanitizeMeta: 타입 불일치 값은 드롭', () => {
  // value 는 숫자만, free_credit 은 boolean 만
  assert.equal(sanitizeMeta({ value: 'not-number', free_credit: 'yes' }), null);
  assert.deepEqual(sanitizeMeta({ value: 100, free_credit: 'yes' }), { value: 100 });
});

test('sanitizeMeta: 비객체·배열은 null', () => {
  assert.equal(sanitizeMeta(null), null);
  assert.equal(sanitizeMeta('str'), null);
  assert.equal(sanitizeMeta(123), null);
  assert.equal(sanitizeMeta([1, 2, 3]), null);
  assert.equal(sanitizeMeta(undefined), null);
});

test('sanitizeMeta: 문자열 값 길이 절단', () => {
  const long = 'a'.repeat(500);
  const out = sanitizeMeta({ source: long }) as Record<string, string>;
  assert.equal(out.source.length, MAX_META_STRING);
});

test('sanitizeMeta: 무한/NaN 숫자 드롭', () => {
  assert.equal(sanitizeMeta({ value: Infinity }), null);
  assert.equal(sanitizeMeta({ value: NaN }), null);
});

// ── validateFunnelBody (기본 = 공개 허용목록) ──
test('validateFunnelBody: 기본은 공개 이벤트만 통과', () => {
  const r = validateFunnelBody({ event: 'signup_start', meta: { hospital_type: '치과' } });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.event, 'signup_start');
    assert.deepEqual(r.value.meta, { hospital_type: '치과' });
  }
});

test('validateFunnelBody: 전환 확정 이벤트는 공개에서 거부', () => {
  for (const ev of ['signup_complete', 'first_post_generated', 'payment_success']) {
    const r = validateFunnelBody({ event: ev });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'invalid_event');
  }
});

test('validateFunnelBody: allowed 주입 시 전체 이벤트 허용(서버용)', () => {
  const r = validateFunnelBody({ event: 'payment_success', meta: { plan: 'pro' } }, FUNNEL_EVENTS);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.event, 'payment_success');
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
  assert.equal(consumeFunnelQuota(store, { ip: 'x', now: day2, limits }).allowed, true);
});

test('funnelKstDayKey: KST 경계', () => {
  assert.equal(funnelKstDayKey(Date.parse('2026-07-21T15:00:00Z')), '2026-07-22');
  assert.equal(funnelKstDayKey(Date.parse('2026-07-21T14:59:00Z')), '2026-07-21');
});
