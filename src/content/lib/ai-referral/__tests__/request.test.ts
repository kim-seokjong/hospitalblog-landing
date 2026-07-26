import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLikelyBotUserAgent,
  parseAiReferralBeacon,
  parseAiReferralBeaconText,
  kstDateKey,
  buildAiReferralRecord,
  AI_REFERRAL_RECORD_KEYS,
  MAX_BEACON_BODY_BYTES,
  isMissingSchemaErrorCode,
  MISSING_SCHEMA_ERROR_CODES,
  consumeAiReferralQuota,
  readAiReferralLimits,
  DEFAULT_AI_REFERRAL_IP_DAILY_LIMIT,
  DEFAULT_AI_REFERRAL_GLOBAL_DAILY_LIMIT,
  type AiReferralBeacon,
} from '../request.ts';

const VALID_POST_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

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
    'Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)Bot',
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
  assert.equal(isLikelyBotUserAgent(null), true);
  assert.equal(isLikelyBotUserAgent(undefined), true);
  assert.equal(isLikelyBotUserAgent(''), true);
  assert.equal(isLikelyBotUserAgent('   '), true);
});

// ---------------------------------------------------------------------------
// 비콘 본문 검증
// ---------------------------------------------------------------------------

test('parseAiReferralBeacon: 정상 본문(홈/글)을 통과시키고 정규화한다', () => {
  const home = parseAiReferralBeacon({ slug: 'My-Clinic', source: 'chatgpt' });
  assert.equal(home.ok, true);
  assert.deepEqual(home.ok && home.value, {
    slug: 'my-clinic',
    source: 'chatgpt',
    postId: null,
  });

  const post = parseAiReferralBeacon({
    slug: 'my-clinic',
    source: 'perplexity',
    postId: VALID_POST_ID.toUpperCase(),
  });
  assert.equal(post.ok, true);
  assert.equal(post.ok && post.value.postId, VALID_POST_ID);
});

test('parseAiReferralBeacon: 형태가 아닌 본문은 거부한다', () => {
  for (const bad of [null, undefined, 'x', 42, [], [{ slug: 'a' }]]) {
    const result = parseAiReferralBeacon(bad);
    assert.equal(result.ok, false, String(bad));
  }
});

test('parseAiReferralBeacon: 잘못된 slug 는 거부한다 (예약어·형식·타입)', () => {
  const bads = ['', 'ab', 'www', 'api', 'has space', '-lead', 'UPPER!', 'a'.repeat(40)];
  for (const slug of bads) {
    const result = parseAiReferralBeacon({ slug, source: 'chatgpt' });
    assert.equal(result.ok, false, `거부해야 함: ${slug}`);
    assert.equal(result.ok === false && result.reason, 'invalid_slug');
  }
  assert.equal(parseAiReferralBeacon({ slug: 123, source: 'chatgpt' }).ok, false);
});

test('parseAiReferralBeacon: 화이트리스트 밖 출처는 거부한다', () => {
  for (const source of ['google', 'naver', '', 'CHATGPT', null, 7]) {
    const result = parseAiReferralBeacon({ slug: 'my-clinic', source });
    assert.equal(result.ok, false, String(source));
    assert.equal(result.ok === false && result.reason, 'invalid_source');
  }
});

test('parseAiReferralBeacon: 잘못된 postId 는 홈으로 뭉개지 않고 거부한다', () => {
  // null 로 강등하면 글별 지표가 조용히 오염되므로 기록 자체를 포기한다.
  for (const postId of ['not-a-uuid', '', 123, '3f2504e0-4f89-11d3-9a0c']) {
    const result = parseAiReferralBeacon({ slug: 'my-clinic', source: 'chatgpt', postId });
    assert.equal(result.ok, false, String(postId));
    assert.equal(result.ok === false && result.reason, 'invalid_post');
  }
  // null/undefined 는 "홈 방문"이라는 정상 값
  assert.equal(parseAiReferralBeacon({ slug: 'my-clinic', source: 'chatgpt', postId: null }).ok, true);
});

test('parseAiReferralBeaconText: 크기 상한을 넘거나 JSON 이 아니면 거부한다', () => {
  assert.equal(parseAiReferralBeaconText('').ok, false);
  assert.equal(parseAiReferralBeaconText('{bad json').ok, false);
  assert.equal(parseAiReferralBeaconText('x'.repeat(MAX_BEACON_BODY_BYTES + 1)).ok, false);

  const ok = parseAiReferralBeaconText(JSON.stringify({ slug: 'my-clinic', source: 'claude' }));
  assert.equal(ok.ok, true);
});

// ---------------------------------------------------------------------------
// ★ 개인정보 — 저장되는 필드를 고정한다
// ---------------------------------------------------------------------------

test('buildAiReferralRecord: 저장되는 필드는 병원·출처·글·일자 4개뿐이다', () => {
  const beacon: AiReferralBeacon = {
    slug: 'my-clinic',
    source: 'chatgpt',
    postId: VALID_POST_ID,
  };
  const record = buildAiReferralRecord(beacon, Date.UTC(2026, 6, 26, 3, 0, 0));

  assert.deepEqual(Object.keys(record).sort(), [...AI_REFERRAL_RECORD_KEYS].sort());
  assert.deepEqual(record, {
    p_slug: 'my-clinic',
    p_source: 'chatgpt',
    p_post_id: VALID_POST_ID,
    p_visit_date: '2026-07-26',
  });
});

test('buildAiReferralRecord: 개인 식별 가능 필드가 결과에 절대 없다', () => {
  const record = buildAiReferralRecord({ slug: 'my-clinic', source: 'gemini', postId: null });
  const serialized = JSON.stringify(record).toLowerCase();
  const forbiddenKeys = [
    'ip', 'ip_address', 'client_ip', 'remote_addr',
    'user_agent', 'useragent', 'ua',
    'cookie', 'session', 'session_id', 'anon_id', 'visitor_id', 'device_id',
    'referrer', 'referer', 'fingerprint', 'email', 'phone',
  ];
  for (const key of forbiddenKeys) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(record, key),
      false,
      `금지 필드가 있다: ${key}`,
    );
  }
  // 값 자리에도 리퍼러 원문 같은 URL 이 실리지 않는다
  assert.equal(serialized.includes('http'), false);
});

// ---------------------------------------------------------------------------
// KST 일자
// ---------------------------------------------------------------------------

test('kstDateKey: UTC 자정 직후는 이미 한국 날짜 기준으로 같은 날이다', () => {
  // 2026-07-26 00:30 UTC = 2026-07-26 09:30 KST
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
  // 진짜 오류는 폴백 대상이 아니다
  for (const code of ['23505', '42501', 'PGRST301', '', null, undefined]) {
    assert.equal(isMissingSchemaErrorCode(code), false, String(code));
  }
});

// ---------------------------------------------------------------------------
// 레이트리밋
// ---------------------------------------------------------------------------

test('readAiReferralLimits: 비정상 env 는 기본값으로 폴백한다', () => {
  assert.deepEqual(readAiReferralLimits({} as NodeJS.ProcessEnv), {
    ipDaily: DEFAULT_AI_REFERRAL_IP_DAILY_LIMIT,
    globalDaily: DEFAULT_AI_REFERRAL_GLOBAL_DAILY_LIMIT,
  });
  assert.deepEqual(
    readAiReferralLimits({ AI_REFERRAL_IP_DAILY_LIMIT: 'x', AI_REFERRAL_GLOBAL_DAILY_LIMIT: '-3' } as NodeJS.ProcessEnv),
    { ipDaily: DEFAULT_AI_REFERRAL_IP_DAILY_LIMIT, globalDaily: DEFAULT_AI_REFERRAL_GLOBAL_DAILY_LIMIT },
  );
  assert.deepEqual(
    readAiReferralLimits({ AI_REFERRAL_IP_DAILY_LIMIT: '5', AI_REFERRAL_GLOBAL_DAILY_LIMIT: '9' } as NodeJS.ProcessEnv),
    { ipDaily: 5, globalDaily: 9 },
  );
});

test('consumeAiReferralQuota: IP 캡을 넘으면 차단한다 (IP 는 카운터 키로만 소비)', () => {
  const store = new Map<string, number>();
  const limits = { ipDaily: 2, globalDaily: 100 };
  const now = Date.UTC(2026, 6, 26, 3, 0, 0);

  assert.equal(consumeAiReferralQuota(store, { ip: '1.1.1.1', now, limits }).allowed, true);
  assert.equal(consumeAiReferralQuota(store, { ip: '1.1.1.1', now, limits }).allowed, true);
  const blocked = consumeAiReferralQuota(store, { ip: '1.1.1.1', now, limits });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.allowed === false && blocked.reason, 'ip_limit');
  // 다른 IP 는 영향 없음
  assert.equal(consumeAiReferralQuota(store, { ip: '2.2.2.2', now, limits }).allowed, true);
});
