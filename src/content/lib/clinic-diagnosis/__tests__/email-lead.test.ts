import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EMAIL_ADDRESS_DAILY_LIMIT,
  DEFAULT_EMAIL_GLOBAL_DAILY_LIMIT,
  DEFAULT_EMAIL_IP_DAILY_LIMIT,
  buildDiagnosisEmail,
  buildEmailFactLines,
  consumeEmailLeadQuota,
  emailLimitMessage,
  escapeHtml,
  normalizeLeadEmail,
  readEmailLeadLimits,
} from '../email-lead.ts';
import type { DiagnosisLeadSummary } from '../conversion.ts';

const SUMMARY: DiagnosisLeadSummary = {
  badCount: 3,
  improveCount: 2,
  goodCount: 4,
  unknownCount: 1,
  ourScopeCount: 2,
  topIssues: ['최근 발행', '의료광고법 표현'],
  daysSinceLatestPost: 208,
  postsPerWeek: 0.2,
  prohibitedCount: 11,
  cautionCount: 3,
  keywordsChecked: 5,
  keywordsTop10: 0,
  aiRecommendTotal: 3,
  aiRecommendMentioned: 0,
  blogId: 'myclinic',
  siteUrl: 'https://example.com',
};

/* ── 이메일 검증 ─────────────────────────────────────────── */

test('normalizeLeadEmail: 정상 주소는 소문자로 정규화한다', () => {
  assert.equal(normalizeLeadEmail('  Dr.Kim@Example.CO.KR '), 'dr.kim@example.co.kr');
  assert.equal(normalizeLeadEmail('a+tag@sub.domain.com'), 'a+tag@sub.domain.com');
});

test('normalizeLeadEmail: 명백히 잘못된 값은 거부한다', () => {
  const bad = [
    '',
    '   ',
    'no-at-sign',
    'a@b',
    'a@@b.com',
    'a b@c.com',
    'a..b@c.com',
    '@c.com',
    'a@.com',
    'a@c.',
    null,
    undefined,
    123,
    { email: 'a@b.com' },
  ];
  for (const value of bad) {
    assert.equal(normalizeLeadEmail(value), null, `${String(value)} 는 거부돼야 한다`);
  }
});

test('normalizeLeadEmail: 길이 상한을 넘으면 거부한다', () => {
  assert.equal(normalizeLeadEmail(`${'a'.repeat(250)}@example.com`), null);
  assert.equal(normalizeLeadEmail(`${'a'.repeat(65)}@example.com`), null);
});

/* ── 남용 방어 캡 ────────────────────────────────────────── */

const LIMITS = { ipDaily: 2, addressDaily: 1, globalDaily: 3 };

test('consumeEmailLeadQuota: 같은 수신 주소로 반복 발송을 막는다', () => {
  const store = new Map<string, number>();
  const first = consumeEmailLeadQuota(store, { ip: '1.1.1.1', email: 'a@b.com', limits: LIMITS });
  assert.deepEqual(first, { allowed: true });

  // 같은 주소를 다른 IP 에서 요청해도 막힌다 (남의 주소 괴롭히기 방어).
  const second = consumeEmailLeadQuota(store, { ip: '2.2.2.2', email: 'a@b.com', limits: LIMITS });
  assert.deepEqual(second, { allowed: false, reason: 'address_limit' });
});

test('consumeEmailLeadQuota: IP 캡을 넘으면 거부한다', () => {
  const store = new Map<string, number>();
  consumeEmailLeadQuota(store, { ip: '1.1.1.1', email: 'a@b.com', limits: LIMITS });
  consumeEmailLeadQuota(store, { ip: '1.1.1.1', email: 'c@d.com', limits: LIMITS });
  const third = consumeEmailLeadQuota(store, { ip: '1.1.1.1', email: 'e@f.com', limits: LIMITS });
  assert.deepEqual(third, { allowed: false, reason: 'ip_limit' });
});

test('consumeEmailLeadQuota: 전체 캡을 넘으면 거부한다', () => {
  const store = new Map<string, number>();
  const limits = { ipDaily: 100, addressDaily: 100, globalDaily: 2 };
  consumeEmailLeadQuota(store, { ip: '1.1.1.1', email: 'a@b.com', limits });
  consumeEmailLeadQuota(store, { ip: '2.2.2.2', email: 'c@d.com', limits });
  const third = consumeEmailLeadQuota(store, { ip: '3.3.3.3', email: 'e@f.com', limits });
  assert.deepEqual(third, { allowed: false, reason: 'global_limit' });
});

test('consumeEmailLeadQuota: 거부된 요청은 어떤 카운터도 소비하지 않는다', () => {
  const store = new Map<string, number>();
  const limits = { ipDaily: 5, addressDaily: 1, globalDaily: 5 };
  consumeEmailLeadQuota(store, { ip: '1.1.1.1', email: 'a@b.com', limits });
  const before = new Map(store);
  const denied = consumeEmailLeadQuota(store, { ip: '1.1.1.1', email: 'a@b.com', limits });
  assert.equal(denied.allowed, false);
  assert.deepEqual([...store.entries()].sort(), [...before.entries()].sort());
});

test('consumeEmailLeadQuota: 날짜가 바뀌면 캡이 초기화된다(KST 경계)', () => {
  const store = new Map<string, number>();
  const day1 = Date.parse('2026-07-27T05:00:00+09:00');
  const day2 = Date.parse('2026-07-28T05:00:00+09:00');
  consumeEmailLeadQuota(store, { ip: '1.1.1.1', email: 'a@b.com', now: day1, limits: LIMITS });
  const blocked = consumeEmailLeadQuota(store, { ip: '1.1.1.1', email: 'a@b.com', now: day1, limits: LIMITS });
  assert.equal(blocked.allowed, false);
  const nextDay = consumeEmailLeadQuota(store, { ip: '1.1.1.1', email: 'a@b.com', now: day2, limits: LIMITS });
  assert.deepEqual(nextDay, { allowed: true });
});

test('readEmailLeadLimits: 비정상 env 는 기본값으로 떨어진다', () => {
  assert.deepEqual(readEmailLeadLimits({} as NodeJS.ProcessEnv), {
    ipDaily: DEFAULT_EMAIL_IP_DAILY_LIMIT,
    addressDaily: DEFAULT_EMAIL_ADDRESS_DAILY_LIMIT,
    globalDaily: DEFAULT_EMAIL_GLOBAL_DAILY_LIMIT,
  });
  assert.deepEqual(
    readEmailLeadLimits({
      DIAGNOSIS_EMAIL_IP_DAILY_LIMIT: 'abc',
      DIAGNOSIS_EMAIL_ADDRESS_DAILY_LIMIT: '-3',
      DIAGNOSIS_EMAIL_GLOBAL_DAILY_LIMIT: '50',
    } as NodeJS.ProcessEnv),
    {
      ipDaily: DEFAULT_EMAIL_IP_DAILY_LIMIT,
      addressDaily: DEFAULT_EMAIL_ADDRESS_DAILY_LIMIT,
      globalDaily: 50,
    },
  );
});

test('emailLimitMessage: 캡 숫자를 문구에 박지 않는다', () => {
  for (const reason of ['ip_limit', 'address_limit', 'global_limit'] as const) {
    const msg = emailLimitMessage(reason);
    assert.ok(msg.length > 0);
    assert.doesNotMatch(msg, /\d+회/);
  }
});

/* ── 메일 본문 ───────────────────────────────────────────── */

test('escapeHtml: HTML 특수문자를 이스케이프한다', () => {
  assert.equal(escapeHtml('<script>"x"&\'y\''), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');
});

test('buildEmailFactLines: 확인하지 못한 값은 줄 자체를 만들지 않는다', () => {
  const lines = buildEmailFactLines({
    ...SUMMARY,
    daysSinceLatestPost: null,
    prohibitedCount: null,
    cautionCount: null,
    keywordsChecked: null,
    aiRecommendTotal: null,
  });
  assert.deepEqual(lines, []);
});

test('buildEmailFactLines: 확인한 값만 사실 그대로 적는다', () => {
  const lines = buildEmailFactLines(SUMMARY);
  assert.ok(lines.some((l) => l.includes('208일 전')));
  assert.ok(lines.some((l) => l.includes('11건')));
  assert.ok(lines.some((l) => l.includes('상위권 0개')));
});

test('buildDiagnosisEmail: 제목에 병원명과 고쳐야 할 건수가 들어간다', () => {
  const { subject } = buildDiagnosisEmail({
    clinicName: '테스트의원',
    summary: SUMMARY,
    reportUrl: 'https://www.hospitalblog.kr/clinic-check/r/abc',
    runAt: '2026-07-27T00:00:00.000Z',
  });
  assert.ok(subject.includes('테스트의원'));
  assert.ok(subject.includes('3건'));
});

test('buildDiagnosisEmail: 병원명·주소를 이스케이프해 본문에 싣는다', () => {
  const { html } = buildDiagnosisEmail({
    clinicName: '<img src=x onerror=alert(1)>의원',
    summary: SUMMARY,
    reportUrl: 'https://www.hospitalblog.kr/clinic-check/r/abc?a=1&b=2',
    runAt: '2026-07-27T00:00:00.000Z',
  });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
  assert.ok(html.includes('a=1&amp;b=2'));
  assert.ok(html.includes('/clinic-check/r/abc'));
});

test('buildDiagnosisEmail: 의료광고법 면책 문구와 발송 근거 고지를 유지한다', () => {
  const { html } = buildDiagnosisEmail({
    clinicName: '테스트의원',
    summary: SUMMARY,
    reportUrl: 'https://www.hospitalblog.kr/clinic-check/r/abc',
    runAt: '2026-07-27T00:00:00.000Z',
  });
  // "위반입니다" 로 단정하지 않는다.
  assert.ok(html.includes('위반 여부를 판단한 것은 아닙니다'));
  assert.ok(!html.includes('위반입니다'));
  // 직접 요청해서 나간 메일이라는 근거 + 광고성 아님.
  assert.ok(html.includes('직접 요청'));
  assert.ok(html.includes('광고성 정보는 보내지 않습니다'));
});

test('buildDiagnosisEmail: 진단 시각이 깨져도 예외 없이 만들어진다', () => {
  const { html } = buildDiagnosisEmail({
    clinicName: '테스트의원',
    summary: SUMMARY,
    reportUrl: 'https://www.hospitalblog.kr/clinic-check/r/abc',
    runAt: 'not-a-date',
  });
  assert.ok(html.includes('테스트의원'));
});
