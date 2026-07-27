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
  shouldRecordOnceEvent,
  shouldRecordFirstPostEvent,
  EVENT_META_KEYS,
  MAX_META_STRING,
  MAX_META_NUMBER,
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
test('isPublicFunnelEvent: 방문·진단·가입시작(저신뢰 의도) 만 true', () => {
  assert.deepEqual(
    [...PUBLIC_FUNNEL_EVENTS],
    [
      'landing_view',
      'diagnosis_input_start',
      'diagnosis_submit',
      'diagnosis_run',
      'diagnosis_report_view',
      'diagnosis_cta_click',
      'signup_start',
    ],
  );
  assert.equal(isPublicFunnelEvent('landing_view'), true);
  assert.equal(isPublicFunnelEvent('diagnosis_input_start'), true);
  assert.equal(isPublicFunnelEvent('diagnosis_submit'), true);
  assert.equal(isPublicFunnelEvent('diagnosis_run'), true);
  assert.equal(isPublicFunnelEvent('diagnosis_report_view'), true);
  assert.equal(isPublicFunnelEvent('diagnosis_cta_click'), true);
  assert.equal(isPublicFunnelEvent('signup_start'), true);
  // 전환 확정 이벤트는 공개에서 거부 (서버 전용)
  // diagnosis_email_submitted 포함 — 이메일 확보율이 핵심 지표라 분자를 위조당하면 안 된다.
  assert.equal(isPublicFunnelEvent('diagnosis_email_submitted'), false);
  assert.equal(isPublicFunnelEvent('signup_complete'), false);
  assert.equal(isPublicFunnelEvent('first_post_generated'), false);
  assert.equal(isPublicFunnelEvent('payment_success'), false);
});

// ── 퍼널 단계 순서 (FUNNEL_EVENTS 순서 = /admin 퍼널 카드 순서) ──
test('FUNNEL_EVENTS: 진단 단계가 방문과 가입 시작 사이에 온다', () => {
  assert.deepEqual(
    [...FUNNEL_EVENTS],
    [
      'landing_view',
      'diagnosis_input_start',
      'diagnosis_submit',
      'diagnosis_run',
      'diagnosis_report_view',
      'diagnosis_email_submitted',
      'diagnosis_cta_click',
      'signup_start',
      'signup_complete',
      'first_post_generated',
      'payment_success',
    ],
  );
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

// ── sanitizeMeta (이벤트별 허용 키 + 값 형식 검증) ──
test('sanitizeMeta: 이벤트별 허용 키만 유지, 그 외 드롭', () => {
  assert.deepEqual(sanitizeMeta({ plan: 'standard', value: 199000 }, 'payment_success'), {
    plan: 'standard',
    value: 199000,
  });
  assert.deepEqual(
    sanitizeMeta({ free_credit: true, target_site: 'naver' }, 'first_post_generated'),
    { free_credit: true, target_site: 'naver' },
  );
  // 허용 목록에 없는 키(PII 가능)는 전부 드롭
  assert.equal(
    sanitizeMeta({ email: 'a@b.com', phone: '010', name: '홍길동' }, 'landing_view'),
    null,
  );
  assert.deepEqual(sanitizeMeta({ plan: 'pro', secret: 'x' }, 'payment_success'), { plan: 'pro' });
});

test('sanitizeMeta: 교차 이벤트 키 주입 차단 — landing_view 에 plan·value 불가', () => {
  assert.equal(sanitizeMeta({ plan: 'pro', value: 199000, free_credit: true }, 'landing_view'), null);
  assert.deepEqual(
    sanitizeMeta({ path: '/pricing', plan: 'pro', hospital_type: '치과' }, 'landing_view'),
    { path: '/pricing' },
  );
  // signup_start 에 결제 속성 주입 불가
  assert.deepEqual(sanitizeMeta({ hospital_type: '치과', value: 1 }, 'signup_start'), {
    hospital_type: '치과',
  });
});

test('sanitizeMeta: 진단 이벤트는 path·source 만 — 병원명 등 자유 문자열 드롭', () => {
  for (const ev of [
    'diagnosis_input_start',
    'diagnosis_submit',
    'diagnosis_run',
    'diagnosis_report_view',
  ] as const) {
    assert.deepEqual([...EVENT_META_KEYS[ev]], ['path', 'source']);
    // 병원명(PII 성 자유 문자열)은 허용 키가 아니므로 통째로 드롭된다
    assert.deepEqual(
      sanitizeMeta({ path: '/clinic-check', clinic: '브이비성형외과의원' }, ev),
      { path: '/clinic-check' },
    );
    assert.equal(sanitizeMeta({ clinic: '브이비성형외과의원' }, ev), null);
  }
});

test('sanitizeMeta: EVENT_META_KEYS 노출 — 이벤트별 최소 키 + PII 키 미포함', () => {
  assert.deepEqual([...EVENT_META_KEYS.landing_view], ['path', 'source', 'referrer_host']);
  assert.ok(EVENT_META_KEYS.payment_success.includes('plan'));
  assert.ok(!EVENT_META_KEYS.landing_view.includes('plan'));
  assert.ok(!EVENT_META_KEYS.landing_view.includes('value'));
  for (const keys of Object.values(EVENT_META_KEYS)) {
    assert.ok(!keys.includes('email'));
    assert.ok(!keys.includes('phone'));
  }
});

test('sanitizeMeta: enum성 값 형식 검증 — 자유 문자열 거부', () => {
  // plan·source·target_site = 소문자 토큰만 (문장·연락처류 값 주입 차단)
  assert.equal(sanitizeMeta({ plan: '연락처 010-1234-5678' }, 'payment_success'), null);
  assert.equal(sanitizeMeta({ plan: 'PRO!' }, 'payment_success'), null);
  assert.equal(sanitizeMeta({ source: 'a@b.com' }, 'landing_view'), null);
  assert.deepEqual(sanitizeMeta({ source: 'insta_bio' }, 'landing_view'), { source: 'insta_bio' });
  // hospital_type = 짧은 분류값만 (긴 문장 거부)
  assert.deepEqual(sanitizeMeta({ hospital_type: '정신건강의학과' }, 'signup_start'), {
    hospital_type: '정신건강의학과',
  });
  assert.equal(sanitizeMeta({ hospital_type: 'x'.repeat(40) }, 'signup_start'), null);
  assert.equal(sanitizeMeta({ hospital_type: '연락주세요 a@b.com' }, 'signup_start'), null);
});

test('sanitizeMeta: path 는 쿼리·해시 제거 + 경로 문자만', () => {
  assert.deepEqual(sanitizeMeta({ path: '/pricing?email=a@b.com#x' }, 'landing_view'), {
    path: '/pricing',
  });
  assert.equal(sanitizeMeta({ path: 'not-a-path' }, 'landing_view'), null);
  const long = '/' + 'a'.repeat(500);
  const out = sanitizeMeta({ path: long }, 'landing_view') as Record<string, string>;
  assert.equal(out.path.length, MAX_META_STRING);
});

test('sanitizeMeta: referrer_host 는 호스트 문자만 + 소문자 정규화', () => {
  assert.deepEqual(sanitizeMeta({ referrer_host: 'Search.Naver.com' }, 'landing_view'), {
    referrer_host: 'search.naver.com',
  });
  assert.equal(sanitizeMeta({ referrer_host: 'evil.com/path?x=1' }, 'landing_view'), null);
});

test('sanitizeMeta: 타입 불일치 값은 드롭', () => {
  // value 는 숫자만, free_credit 은 boolean 만
  assert.equal(sanitizeMeta({ value: 'not-number' }, 'payment_success'), null);
  assert.deepEqual(sanitizeMeta({ free_credit: 'yes', target_site: 'naver' }, 'first_post_generated'), {
    target_site: 'naver',
  });
});

test('sanitizeMeta: 비객체·배열은 null', () => {
  assert.equal(sanitizeMeta(null, 'landing_view'), null);
  assert.equal(sanitizeMeta('str', 'landing_view'), null);
  assert.equal(sanitizeMeta(123, 'landing_view'), null);
  assert.equal(sanitizeMeta([1, 2, 3], 'landing_view'), null);
  assert.equal(sanitizeMeta(undefined, 'landing_view'), null);
});

test('sanitizeMeta: 무한/NaN/음수/상한 초과 숫자 드롭', () => {
  assert.equal(sanitizeMeta({ value: Infinity }, 'payment_success'), null);
  assert.equal(sanitizeMeta({ value: NaN }, 'payment_success'), null);
  assert.equal(sanitizeMeta({ value: -1 }, 'payment_success'), null);
  assert.equal(sanitizeMeta({ value: MAX_META_NUMBER + 1 }, 'payment_success'), null);
  assert.deepEqual(sanitizeMeta({ value: 0 }, 'payment_success'), { value: 0 });
});

// ── shouldRecordOnceEvent (계정 통산 1회 이벤트 — first_post_generated) ──
test('shouldRecordOnceEvent: 기존 0건일 때만 기록', () => {
  assert.equal(shouldRecordOnceEvent(0), true); // 첫 기록
  assert.equal(shouldRecordOnceEvent(1), false); // 이미 있음 — 월초 리셋/유료 전환 재발화 차단
  assert.equal(shouldRecordOnceEvent(5), false);
  // 조회 실패(확인 불가) = 기록 안 함 — 중복 기록(전환율 부풀림)이 미기록보다 해롭다
  assert.equal(shouldRecordOnceEvent(null), false);
});

test('shouldRecordFirstPostEvent: 진짜 신규 계정만 기록 (레거시 폴백)', () => {
  // 진짜 신규: 이벤트도 없고 기존 글도 없음 → 기록
  assert.equal(shouldRecordFirstPostEvent(0, 0), true);
  // 마이그 046 이전 기존 계정(예: 체험 중 14글): 이벤트는 없지만 saved_posts 존재 → 기록 안 함
  assert.equal(shouldRecordFirstPostEvent(0, 14), false);
  assert.equal(shouldRecordFirstPostEvent(0, 1), false);
  // 이벤트가 이미 있으면 당연히 기록 안 함
  assert.equal(shouldRecordFirstPostEvent(1, 0), false);
  // 어느 쪽이든 확인 불가(null) = 기록 안 함 (허위 기록 방지 우선)
  assert.equal(shouldRecordFirstPostEvent(null, 0), false);
  assert.equal(shouldRecordFirstPostEvent(0, null), false);
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
