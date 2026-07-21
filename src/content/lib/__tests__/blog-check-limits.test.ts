import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readBlogCheckLimits,
  readUserDailyLimit,
  consumeBlogCheckQuota,
  consumeUserQuota,
  kstDayKey,
  kstDayRangeUtc,
  extractClientIp,
  DEFAULT_IP_DAILY_LIMIT,
  DEFAULT_GLOBAL_DAILY_LIMIT,
  DEFAULT_USER_DAILY_LIMIT,
} from '../blog-check-limits.ts';

// ── readBlogCheckLimits ──
test('readBlogCheckLimits: env 로 조절, 비정상 값은 기본값', () => {
  assert.deepEqual(readBlogCheckLimits({} as NodeJS.ProcessEnv), {
    ipDaily: DEFAULT_IP_DAILY_LIMIT,
    globalDaily: DEFAULT_GLOBAL_DAILY_LIMIT,
  });
  assert.deepEqual(
    readBlogCheckLimits({
      BLOG_CHECK_IP_DAILY_LIMIT: '5',
      BLOG_CHECK_GLOBAL_DAILY_LIMIT: '200',
    } as NodeJS.ProcessEnv),
    { ipDaily: 5, globalDaily: 200 },
  );
  assert.deepEqual(
    readBlogCheckLimits({
      BLOG_CHECK_IP_DAILY_LIMIT: '-1',
      BLOG_CHECK_GLOBAL_DAILY_LIMIT: 'abc',
    } as NodeJS.ProcessEnv),
    { ipDaily: DEFAULT_IP_DAILY_LIMIT, globalDaily: DEFAULT_GLOBAL_DAILY_LIMIT },
  );
});

// ── kstDayKey ──
test('kstDayKey: UTC 15시(=KST 자정) 경계에서 날짜가 넘어간다', () => {
  const before = Date.parse('2026-07-20T14:59:00Z');
  const after = Date.parse('2026-07-20T15:01:00Z');
  assert.equal(kstDayKey(before), '2026-07-20');
  assert.equal(kstDayKey(after), '2026-07-21');
});

// ── consumeBlogCheckQuota ──
test('consumeBlogCheckQuota: IP당 일 3회 초과 시 차단', () => {
  const store = new Map<string, number>();
  const now = Date.parse('2026-07-20T03:00:00Z');
  for (let i = 0; i < DEFAULT_IP_DAILY_LIMIT; i++) {
    assert.deepEqual(consumeBlogCheckQuota(store, { ip: '1.2.3.4', now }), { allowed: true });
  }
  assert.deepEqual(consumeBlogCheckQuota(store, { ip: '1.2.3.4', now }), {
    allowed: false,
    reason: 'ip_limit',
  });
  // 다른 IP 는 독립 카운트
  assert.deepEqual(consumeBlogCheckQuota(store, { ip: '5.6.7.8', now }), { allowed: true });
});

test('consumeBlogCheckQuota: 전체 캡 도달 시 global_limit', () => {
  const store = new Map<string, number>();
  const now = Date.parse('2026-07-20T03:00:00Z');
  const limits = { ipDaily: 10, globalDaily: 2 };
  assert.equal(consumeBlogCheckQuota(store, { ip: 'a', now, limits }).allowed, true);
  assert.equal(consumeBlogCheckQuota(store, { ip: 'b', now, limits }).allowed, true);
  assert.deepEqual(consumeBlogCheckQuota(store, { ip: 'c', now, limits }), {
    allowed: false,
    reason: 'global_limit',
  });
});

test('consumeBlogCheckQuota: 날짜가 바뀌면 카운터 리셋 + 옛 키 정리', () => {
  const store = new Map<string, number>();
  const day1 = Date.parse('2026-07-20T03:00:00Z');
  const day2 = Date.parse('2026-07-21T03:00:00Z');
  for (let i = 0; i < DEFAULT_IP_DAILY_LIMIT; i++) {
    consumeBlogCheckQuota(store, { ip: '1.2.3.4', now: day1 });
  }
  assert.equal(consumeBlogCheckQuota(store, { ip: '1.2.3.4', now: day1 }).allowed, false);
  assert.equal(consumeBlogCheckQuota(store, { ip: '1.2.3.4', now: day2 }).allowed, true);
  // 지난 날짜 키는 정리됨
  for (const key of store.keys()) {
    assert.ok(key.includes('2026-07-21'));
  }
});

// ── extractClientIp ──
const headers = (map: Record<string, string>) => ({
  get: (name: string) => map[name.toLowerCase()] ?? null,
});

test('extractClientIp: 플랫폼 헤더(x-real-ip) 우선 — 클라이언트 위조 가능한 XFF 무시', () => {
  assert.equal(
    extractClientIp(
      headers({
        'x-forwarded-for': 'fake.ip.injected, 1.2.3.4', // 클라이언트가 앞에 끼워 넣은 위조 값
        'x-real-ip': '9.9.9.9', // Vercel 플랫폼이 덮어쓴 실제 IP
      }),
    ),
    '9.9.9.9',
  );
});

test('extractClientIp: x-real-ip 없으면 x-vercel-forwarded-for → 마지막 수단 XFF → unknown', () => {
  assert.equal(
    extractClientIp(headers({ 'x-vercel-forwarded-for': '8.8.8.8', 'x-forwarded-for': 'fake, 1.1.1.1' })),
    '8.8.8.8',
  );
  assert.equal(extractClientIp(headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4');
  assert.equal(extractClientIp(headers({})), 'unknown');
});

// ── readUserDailyLimit / consumeUserQuota (상세분석 회원 캡) ──
test('readUserDailyLimit: 기본 5, env 조절, 비정상 값은 기본값', () => {
  assert.equal(readUserDailyLimit({} as NodeJS.ProcessEnv), DEFAULT_USER_DAILY_LIMIT);
  assert.equal(readUserDailyLimit({ BLOG_CHECK_USER_DAILY_LIMIT: '9' } as NodeJS.ProcessEnv), 9);
  assert.equal(
    readUserDailyLimit({ BLOG_CHECK_USER_DAILY_LIMIT: '0' } as NodeJS.ProcessEnv),
    DEFAULT_USER_DAILY_LIMIT,
  );
});

test('consumeUserQuota: 회원별 일일 상한 소비·차단·날짜 리셋', () => {
  const store = new Map<string, number>();
  const day1 = Date.parse('2026-07-21T03:00:00Z');
  const day2 = Date.parse('2026-07-22T03:00:00Z');
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(consumeUserQuota(store, { userId: 'u1', now: day1, limit: 5 }), { allowed: true });
  }
  assert.deepEqual(consumeUserQuota(store, { userId: 'u1', now: day1, limit: 5 }), {
    allowed: false,
    reason: 'user_limit',
  });
  // 다른 회원은 독립, 날짜가 바뀌면 리셋 + 옛 키 정리
  assert.equal(consumeUserQuota(store, { userId: 'u2', now: day1, limit: 5 }).allowed, true);
  assert.equal(consumeUserQuota(store, { userId: 'u1', now: day2, limit: 5 }).allowed, true);
  for (const key of store.keys()) {
    assert.ok(key.startsWith('user:2026-07-22:'));
  }
});

// ── kstDayRangeUtc (DB 일일 카운트 판정 경계) ──
test('kstDayRangeUtc: KST 하루 = UTC 전날 15:00Z ~ 당일 15:00Z', () => {
  const now = Date.parse('2026-07-21T03:00:00Z'); // KST 2026-07-21 12:00
  assert.deepEqual(kstDayRangeUtc(now), {
    startIso: '2026-07-20T15:00:00.000Z',
    endIso: '2026-07-21T15:00:00.000Z',
  });
  // KST 자정 직후(UTC 15:01)는 다음 날 범위
  const after = Date.parse('2026-07-21T15:01:00Z');
  assert.equal(kstDayRangeUtc(after).startIso, '2026-07-21T15:00:00.000Z');
});
