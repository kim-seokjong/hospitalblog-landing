import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLikelyBotUserAgent,
  parseAiReferralBeacon,
  parseAiReferralBeaconText,
  kstDateKey,
  buildAiReferralRecord,
  isBeaconExpValid,
  AI_REFERRAL_RECORD_KEYS,
  MAX_BEACON_BODY_BYTES,
  BEACON_TOKEN_TTL_MS,
  BEACON_CLOCK_SKEW_MS,
  BEACON_SIGNATURE_LENGTH,
  isMissingSchemaErrorCode,
  MISSING_SCHEMA_ERROR_CODES,
  consumeAiReferralQuota,
  readAiReferralLimits,
  DEFAULT_AI_REFERRAL_IP_DAILY_LIMIT,
  DEFAULT_AI_REFERRAL_IP_CLINIC_DAILY_LIMIT,
  type AiReferralVisit,
} from '../request.ts';

const VALID_POST_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const SIG = 'a'.repeat(BEACON_SIGNATURE_LENGTH);
const NOW = Date.UTC(2026, 6, 26, 3, 0, 0);

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { slug: 'my-clinic', source: 'chatgpt', exp: NOW + 60_000, token: SIG, ...over };
}

// ---------------------------------------------------------------------------
// 봇 제외 — 크롤러 수집은 "사람의 방문"이 아니다
// ---------------------------------------------------------------------------

test('isLikelyBotUserAgent: 일반 브라우저 UA 는 봇이 아니다', () => {
  const humans = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  ];
  for (const ua of humans) {
    assert.equal(isLikelyBotUserAgent(ua), false, ua.slice(0, 40));
  }
});

test('isLikelyBotUserAgent: 크롤러·AI 수집 봇·스크립트는 제외한다', () => {
  const bots = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
    'Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)',
    'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    'Mozilla/5.0 (compatible; PerplexityBot/1.0)',
    'Mozilla/5.0 (compatible; bingbot/2.0)',
    'curl/8.4.0',
    'python-requests/2.31.0',
    'node-fetch/1.0',
    'Mozilla/5.0 HeadlessChrome/120.0.0.0',
    'facebookexternalhit/1.1',
  ];
  for (const ua of bots) {
    assert.equal(isLikelyBotUserAgent(ua), true, ua.slice(0, 40));
  }
});

test('isLikelyBotUserAgent: UA 가 없으면 봇으로 본다', () => {
  for (const ua of [null, undefined, '', '   ']) {
    assert.equal(isLikelyBotUserAgent(ua), true, String(ua));
  }
});

// ---------------------------------------------------------------------------
// 서명 토큰 — 위조 방어의 핵심
// ---------------------------------------------------------------------------

test('isBeaconExpValid: 만료된 토큰과 지나치게 먼 미래 토큰을 거부한다', () => {
  assert.equal(isBeaconExpValid(NOW + 60_000, NOW), true);
  assert.equal(isBeaconExpValid(NOW, NOW), true);
  // 시계 오차 허용 범위 안의 과거는 통과
  assert.equal(isBeaconExpValid(NOW - BEACON_CLOCK_SKEW_MS + 1_000, NOW), true);
  // 그보다 오래된 토큰은 거부 (재사용 창 제한)
  assert.equal(isBeaconExpValid(NOW - BEACON_CLOCK_SKEW_MS - 1_000, NOW), false);
  // 발급 가능 범위를 넘는 미래값 거부 (장수명 토큰 위조 시도)
  assert.equal(
    isBeaconExpValid(NOW + BEACON_TOKEN_TTL_MS + BEACON_CLOCK_SKEW_MS + 1_000, NOW),
    false,
  );
  // 정수가 아닌 값 거부
  assert.equal(isBeaconExpValid(Number.NaN, NOW), false);
  assert.equal(isBeaconExpValid(1.5, NOW), false);
});

// ---------------------------------------------------------------------------
// 비콘 본문 검증
// ---------------------------------------------------------------------------

test('parseAiReferralBeacon: 정상 본문(홈/글)을 통과시키고 정규화한다', () => {
  const home = parseAiReferralBeacon(body({ slug: 'My-Clinic' }));
  assert.equal(home.ok, true);
  assert.equal(home.ok && home.value.slug, 'my-clinic');
  assert.equal(home.ok && home.value.postId, null);

  const post = parseAiReferralBeacon(
    body({ source: 'perplexity', postId: VALID_POST_ID.toUpperCase() }),
  );
  assert.equal(post.ok, true);
  assert.equal(post.ok && post.value.postId, VALID_POST_ID);
});

test('parseAiReferralBeacon: 형태가 아닌 본문은 거부한다', () => {
  for (const bad of [null, undefined, 'x', 42, [], [{ slug: 'a' }]]) {
    assert.equal(parseAiReferralBeacon(bad).ok, false, String(bad));
  }
});

test('parseAiReferralBeacon: 잘못된 slug 는 거부한다 (예약어·형식·타입)', () => {
  for (const slug of ['', 'ab', 'www', 'api', 'has space', '-lead', 'UPPER!', 'a'.repeat(40), 123]) {
    const result = parseAiReferralBeacon(body({ slug }));
    assert.equal(result.ok, false, `거부해야 함: ${String(slug)}`);
    assert.equal(result.ok === false && result.reason, 'invalid_slug');
  }
});

test('parseAiReferralBeacon: 화이트리스트 밖 출처는 거부한다', () => {
  for (const source of ['google', 'naver', '', 'CHATGPT', null, 7]) {
    const result = parseAiReferralBeacon(body({ source }));
    assert.equal(result.ok, false, String(source));
    assert.equal(result.ok === false && result.reason, 'invalid_source');
  }
});

test('parseAiReferralBeacon: 잘못된 postId 는 홈으로 뭉개지 않고 거부한다', () => {
  // null 로 강등하면 글별 지표가 조용히 오염되므로 기록 자체를 포기한다.
  for (const postId of ['not-a-uuid', '', 123, '3f2504e0-4f89-11d3-9a0c']) {
    const result = parseAiReferralBeacon(body({ postId }));
    assert.equal(result.ok, false, String(postId));
    assert.equal(result.ok === false && result.reason, 'invalid_post');
  }
  assert.equal(parseAiReferralBeacon(body({ postId: null })).ok, true);
});

test('parseAiReferralBeacon: 서명·만료가 없거나 형식이 어긋나면 거부한다', () => {
  const bads: Array<Record<string, unknown>> = [
    { token: undefined },
    { exp: undefined },
    { token: '' },
    { token: 'z'.repeat(BEACON_SIGNATURE_LENGTH) }, // hex 아님
    { token: 'a'.repeat(BEACON_SIGNATURE_LENGTH - 1) }, // 길이 불일치
    { token: 123 },
    { exp: 'soon' },
    { exp: 1.5 },
    { exp: Number.NaN },
  ];
  for (const over of bads) {
    const result = parseAiReferralBeacon(body(over));
    assert.equal(result.ok, false, JSON.stringify(over));
    assert.equal(result.ok === false && result.reason, 'invalid_token');
  }
});

test('parseAiReferralBeaconText: 크기 상한을 넘거나 JSON 이 아니면 거부한다', () => {
  assert.equal(parseAiReferralBeaconText('').ok, false);
  assert.equal(parseAiReferralBeaconText('{bad json').ok, false);
  assert.equal(parseAiReferralBeaconText('x'.repeat(MAX_BEACON_BODY_BYTES + 1)).ok, false);
  assert.equal(parseAiReferralBeaconText(JSON.stringify(body())).ok, true);
});

// ---------------------------------------------------------------------------
// ★ 개인정보 — 저장되는 필드를 고정한다
// ---------------------------------------------------------------------------

test('buildAiReferralRecord: 저장되는 필드는 병원·출처·글·일자 4개뿐이다', () => {
  const visit: AiReferralVisit = {
    slug: 'my-clinic',
    source: 'chatgpt',
    postId: VALID_POST_ID,
  };
  const record = buildAiReferralRecord(visit, NOW);

  assert.deepEqual(Object.keys(record).sort(), [...AI_REFERRAL_RECORD_KEYS].sort());
  assert.deepEqual(record, {
    p_slug: 'my-clinic',
    p_source: 'chatgpt',
    p_post_id: VALID_POST_ID,
    p_visit_date: '2026-07-26',
  });
});

test('buildAiReferralRecord: 개인 식별 가능 필드·타임스탬프가 결과에 절대 없다', () => {
  const record = buildAiReferralRecord({ slug: 'my-clinic', source: 'gemini', postId: null });
  const forbiddenKeys = [
    'ip', 'ip_address', 'client_ip', 'remote_addr',
    'user_agent', 'useragent', 'ua',
    'cookie', 'session', 'session_id', 'anon_id', 'visitor_id', 'device_id',
    'referrer', 'referer', 'fingerprint', 'email', 'phone',
    // 타임스탬프류 — 소수 셀에서는 그 값이 곧 개인의 방문 시각이 된다
    'created_at', 'updated_at', 'visited_at', 'occurred_at', 'timestamp', 'p_now',
  ];
  for (const key of forbiddenKeys) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(record, key),
      false,
      `금지 필드가 있다: ${key}`,
    );
  }
  // 값 자리에도 리퍼러 원문·시각이 실리지 않는다 (일자 문자열만)
  const serialized = JSON.stringify(record).toLowerCase();
  assert.equal(serialized.includes('http'), false);
  assert.equal(/\d{2}:\d{2}/.test(serialized), false);
  assert.match(record.p_visit_date, /^\d{4}-\d{2}-\d{2}$/);
});

// ---------------------------------------------------------------------------
// KST 일자
// ---------------------------------------------------------------------------

test('kstDateKey: 한국 날짜 경계를 기준으로 일자를 만든다', () => {
  assert.equal(kstDateKey(Date.UTC(2026, 6, 26, 0, 30)), '2026-07-26');
  // 2026-07-25 15:30 UTC = 2026-07-26 00:30 KST → 한국 기준 26일
  assert.equal(kstDateKey(Date.UTC(2026, 6, 25, 15, 30)), '2026-07-26');
  // 2026-07-25 14:30 UTC = 2026-07-25 23:30 KST → 한국 기준 25일
  assert.equal(kstDateKey(Date.UTC(2026, 6, 25, 14, 30)), '2026-07-25');
});

// ---------------------------------------------------------------------------
// 마이그레이션 미적용 폴백
// ---------------------------------------------------------------------------

test('isMissingSchemaErrorCode: 테이블·함수 부재 코드를 정상 상태로 취급한다', () => {
  for (const code of MISSING_SCHEMA_ERROR_CODES) {
    assert.equal(isMissingSchemaErrorCode(code), true, code);
  }
  assert.equal(isMissingSchemaErrorCode('42P01'), true);
  assert.equal(isMissingSchemaErrorCode('42883'), true);
  assert.equal(isMissingSchemaErrorCode('PGRST202'), true);
  for (const code of ['23505', '42501', 'PGRST301', '', null, undefined]) {
    assert.equal(isMissingSchemaErrorCode(code), false, String(code));
  }
});

// ---------------------------------------------------------------------------
// 레이트리밋 — 완충재. 남에게 피해가 번지지 않아야 한다
// ---------------------------------------------------------------------------

test('readAiReferralLimits: 비정상 env 는 기본값으로 폴백한다', () => {
  assert.deepEqual(readAiReferralLimits({} as NodeJS.ProcessEnv), {
    ipDaily: DEFAULT_AI_REFERRAL_IP_DAILY_LIMIT,
    ipClinicDaily: DEFAULT_AI_REFERRAL_IP_CLINIC_DAILY_LIMIT,
  });
  assert.deepEqual(
    readAiReferralLimits({
      AI_REFERRAL_IP_DAILY_LIMIT: 'x',
      AI_REFERRAL_IP_CLINIC_DAILY_LIMIT: '-3',
    } as NodeJS.ProcessEnv),
    { ipDaily: DEFAULT_AI_REFERRAL_IP_DAILY_LIMIT, ipClinicDaily: DEFAULT_AI_REFERRAL_IP_CLINIC_DAILY_LIMIT },
  );
  assert.deepEqual(
    readAiReferralLimits({
      AI_REFERRAL_IP_DAILY_LIMIT: '5',
      AI_REFERRAL_IP_CLINIC_DAILY_LIMIT: '2',
    } as NodeJS.ProcessEnv),
    { ipDaily: 5, ipClinicDaily: 2 },
  );
});

test('consumeAiReferralQuota: 발신원별 일일 캡을 넘으면 차단한다', () => {
  const store = new Map<string, number>();
  const limits = { ipDaily: 2, ipClinicDaily: 99 };
  assert.equal(consumeAiReferralQuota(store, { ipKey: 'h1', slug: 'a-clinic', now: NOW, limits }).allowed, true);
  assert.equal(consumeAiReferralQuota(store, { ipKey: 'h1', slug: 'b-clinic', now: NOW, limits }).allowed, true);
  const blocked = consumeAiReferralQuota(store, { ipKey: 'h1', slug: 'c-clinic', now: NOW, limits });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.allowed === false && blocked.reason, 'ip_limit');
});

test('consumeAiReferralQuota: 같은 발신원이 한 병원을 두드리는 것을 따로 막는다', () => {
  const store = new Map<string, number>();
  const limits = { ipDaily: 99, ipClinicDaily: 2 };
  assert.equal(consumeAiReferralQuota(store, { ipKey: 'h1', slug: 'a-clinic', now: NOW, limits }).allowed, true);
  assert.equal(consumeAiReferralQuota(store, { ipKey: 'h1', slug: 'a-clinic', now: NOW, limits }).allowed, true);
  const blocked = consumeAiReferralQuota(store, { ipKey: 'h1', slug: 'a-clinic', now: NOW, limits });
  assert.equal(blocked.allowed === false && blocked.reason, 'ip_clinic_limit');
  // 같은 발신원이라도 다른 병원은 아직 여유가 있다
  assert.equal(consumeAiReferralQuota(store, { ipKey: 'h1', slug: 'b-clinic', now: NOW, limits }).allowed, true);
});

test('consumeAiReferralQuota: 한 발신원의 소진이 다른 발신원·병원을 막지 않는다 (DoS 방지)', () => {
  // 전역 상한을 두지 않는 이유를 고정하는 테스트 — 공격자가 카운터를 소진시켜
  // 정상 방문자의 집계를 막을 수 있으면 안 된다.
  const store = new Map<string, number>();
  const limits = { ipDaily: 1, ipClinicDaily: 1 };
  assert.equal(consumeAiReferralQuota(store, { ipKey: 'attacker', slug: 'victim-clinic', now: NOW, limits }).allowed, true);
  assert.equal(consumeAiReferralQuota(store, { ipKey: 'attacker', slug: 'victim-clinic', now: NOW, limits }).allowed, false);
  // 정상 방문자(다른 발신원)는 같은 병원에 대해 여전히 기록된다
  assert.equal(consumeAiReferralQuota(store, { ipKey: 'visitor', slug: 'victim-clinic', now: NOW, limits }).allowed, true);
});

test('consumeAiReferralQuota: 날짜가 바뀌면 지난 키를 정리한다', () => {
  const store = new Map<string, number>();
  const limits = { ipDaily: 1, ipClinicDaily: 1 };
  consumeAiReferralQuota(store, { ipKey: 'h1', slug: 'a-clinic', now: NOW, limits });
  const nextDay = NOW + 24 * 60 * 60 * 1000;
  assert.equal(consumeAiReferralQuota(store, { ipKey: 'h1', slug: 'a-clinic', now: nextDay, limits }).allowed, true);
  for (const key of store.keys()) {
    assert.match(key, /2026-07-27/);
  }
});
