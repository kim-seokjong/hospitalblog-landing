import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readBlogCheckLimits,
  readUserDailyLimit,
  consumeBlogCheckQuota,
  consumeUserQuota,
  evaluateReservation,
  joinOrStartSingleFlight,
  kstDayKey,
  kstDayRangeUtc,
  extractClientIp,
  DEFAULT_IP_DAILY_LIMIT,
  DEFAULT_GLOBAL_DAILY_LIMIT,
  DEFAULT_USER_DAILY_LIMIT,
  type RateLimitDecision,
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

test('consumeUserQuota: 동시 요청 레이스 — 원자 소비라 COUNT→INSERT 갭 없이 정확히 limit 회만 통과', () => {
  // detail 라우트의 이중 가드 1단계: DB COUNT 판정과 달리 검사+소비가 한 호출에서
  // 원자적으로 일어나므로, 동일 인스턴스 동시 20요청도 limit(5) 회만 통과한다.
  const store = new Map<string, number>();
  const now = Date.parse('2026-07-22T03:00:00Z');
  const results = Array.from({ length: 20 }, () =>
    consumeUserQuota(store, { userId: 'racer', now, limit: 5 }),
  );
  assert.equal(results.filter((r) => r.allowed).length, 5);
  assert.equal(results.filter((r) => !r.allowed).length, 15);
});

// ── evaluateReservation (detail 회원 캡 — DB 원자 예약 판정) ──
test('evaluateReservation: 자기 행 포함 count ≤ limit 은 진행, 초과는 차단', () => {
  // 1~5번째 요청 (limit 5): count 는 자기 예약 행 포함이므로 1..5 → 전부 진행
  for (let count = 1; count <= 5; count++) {
    assert.equal(evaluateReservation(count, 5), 'proceed');
  }
  // 6번째부터: count 6 이상 → 초과 (자기 예약 행은 'failed' 전이)
  assert.equal(evaluateReservation(6, 5), 'over_limit');
  assert.equal(evaluateReservation(20, 5), 'over_limit');
});

test('evaluateReservation: 동시 N요청 — insert-then-count 라 한도+ε 로 바운드', () => {
  // 동시 20요청이 전부 INSERT 를 마친 뒤 각자 COUNT 하는 최악 시나리오:
  // 모두 count=20 을 보게 되어 전부 over_limit — 한도를 넘는 통과가 발생하지 않는다.
  // (ε 는 COUNT 시점에 아직 안 보이는 극소수 동시 트랜잭션의 가시성 지연분뿐)
  const verdicts = Array.from({ length: 20 }, () => evaluateReservation(20, 5));
  assert.ok(verdicts.every((v) => v === 'over_limit'));
});

test('evaluateReservation: 카운트 실패(null·비정상)는 진행 — 그레이스풀', () => {
  assert.equal(evaluateReservation(null, 5), 'proceed');
  assert.equal(evaluateReservation(Number.NaN, 5), 'proceed');
});

// ── joinOrStartSingleFlight (공개 라우트 쿼터-조인 순서) ──
test('joinOrStartSingleFlight: 팔로워는 무과금 조인 — 쿼터는 리더 1회만 소비', async () => {
  const inflight = new Map<string, Promise<string>>();
  let consumed = 0;
  const consume = (): RateLimitDecision => {
    consumed += 1;
    return { allowed: true };
  };
  let resolveRun: (v: string) => void = () => {};
  const start = () => new Promise<string>((resolve) => { resolveRun = resolve; });

  const leader = joinOrStartSingleFlight(inflight, 'blog1', consume, start);
  assert.ok(leader.ok && leader.isLeader);
  const follower = joinOrStartSingleFlight(inflight, 'blog1', consume, start);
  assert.ok(follower.ok && !follower.isLeader);
  assert.equal(consumed, 1); // 동시 3요청이 IP 일일 허용량을 태우지 않는다
  if (leader.ok && follower.ok) {
    assert.equal(leader.promise, follower.promise); // 같은 파이프라인 공유
  }

  resolveRun('done');
  if (leader.ok) assert.equal(await leader.promise, 'done');
  await Promise.resolve(); // finally 정리 틱
  assert.equal(inflight.size, 0); // 완료 시 맵 제거 → 다음 요청은 새 리더
});

test('joinOrStartSingleFlight: 쿼터 거부 시 시작하지 않음, 실패해도 맵 정리', async () => {
  const inflight = new Map<string, Promise<string>>();
  let started = 0;

  const denied = joinOrStartSingleFlight(
    inflight,
    'blog1',
    () => ({ allowed: false, reason: 'ip_limit' }),
    () => {
      started += 1;
      return Promise.resolve('x');
    },
  );
  assert.deepEqual(denied, { ok: false, reason: 'ip_limit' });
  assert.equal(started, 0);
  assert.equal(inflight.size, 0);

  // 실패하는 파이프라인도 맵에서 제거된다
  const failing = joinOrStartSingleFlight(
    inflight,
    'blog2',
    () => ({ allowed: true }),
    () => Promise.reject(new Error('boom')),
  );
  assert.ok(failing.ok);
  if (failing.ok) {
    await assert.rejects(failing.promise);
  }
  await Promise.resolve();
  assert.equal(inflight.size, 0);
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
