/**
 * runGeoTracking 라우트 수준 테스트.
 *
 * 핵심 목적 두 가지:
 *  ① 지연되는 DB·긴 질의·긴 인용 판정·긴 저장이 겹쳐도 **총 실행 시간이 300초 미만**임을
 *     상수 합계가 아니라 실제 제어 흐름에서 증명한다.
 *  ② 저장이 실패하면 status='done' 으로 마감되지 않고 재실행이 가능해야 한다.
 *
 * 방법: 가상 시계를 쓰고, mock 게이트웨이가 "타임아웃 안에서만 시간을 쓴다"는
 *      실제 계약을 그대로 시뮬레이션한다(지연 > 타임아웃이면 타임아웃까지만 쓰고 에러).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PLATFORM_MAX_DURATION_MS, PREFLIGHT_DEADLINE_MS, QUERY_DEADLINE_MS } from '../geo-engines/budget.ts';
import { createGeoQueryCache } from '../geo-engines/cache.ts';
import type { ExecuteQueriesInput, ExecuteQueriesResult } from '../geo-engines/index.ts';
import { runGeoTracking, type FinalizeLockInput, type GeoProfileRow, type GeoTrackingGateway } from '../geo-engines/run-tracking.ts';
import type { GeoEngineAdapter } from '../geo-engines/types.ts';

// ---------------------------------------------------------------------------
// 가상 시계 + mock 게이트웨이
// ---------------------------------------------------------------------------

interface Clock {
  now: () => number;
  advance: (ms: number) => void;
}

function createClock(start = 1_000_000): Clock {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

interface GatewayScript {
  /** 각 DB 작업이 "쓰려고 하는" 시간(ms). 타임아웃보다 길면 타임아웃까지만 쓰고 실패 */
  readonly latencyMs?: number;
  /** 잠금 작업 전용 지연 (미지정 시 latencyMs) */
  readonly lockLatencyMs?: number;
  /** insert 전용 지연 (미지정 시 latencyMs) */
  readonly insertLatencyMs?: number;
  /**
   * insert 가 타임아웃을 넘겨 더 쓰는 시간.
   * 실제 Postgres 문장 취소는 즉시가 아니라서 약간 초과할 수 있다 —
   * 그런 경우에도 저장 마감 가드가 작동하고 300초를 지키는지 보기 위한 것.
   */
  readonly insertOverrunMs?: number;
  readonly profiles?: readonly GeoProfileRow[];
  readonly paidCount?: number;
  readonly weekUserIds?: readonly string[];
  /** insert 를 항상 실패시킬지 */
  readonly insertFails?: boolean;
  readonly lockError?: { code?: string; message?: string } | null;
  readonly takenOver?: boolean;
}

interface GatewaySpy {
  readonly gateway: GeoTrackingGateway;
  readonly finalized: FinalizeLockInput[];
  readonly insertedRows: () => number;
  readonly insertCalls: () => number;
}

function createGateway(clock: Clock, script: GatewayScript = {}): GatewaySpy {
  const latency = script.latencyMs ?? 0;
  const lockLatency = script.lockLatencyMs ?? latency;
  const insertLatency = script.insertLatencyMs ?? latency;
  const finalized: FinalizeLockInput[] = [];
  let insertedRows = 0;
  let insertCalls = 0;

  /** 게이트웨이 계약 시뮬레이션: 타임아웃을 넘겨 쓰지 않는다 */
  function spend(timeoutMs: number, latencyMs: number = latency): { timedOut: boolean } {
    const spent = Math.min(latencyMs, timeoutMs);
    clock.advance(spent);
    return { timedOut: latencyMs > timeoutMs };
  }

  const gateway: GeoTrackingGateway = {
    async acquireLock(_weekStart, timeoutMs) {
      const { timedOut } = spend(timeoutMs, lockLatency);
      if (timedOut) return { error: { code: '57014', message: 'statement timeout' } };
      return { error: script.lockError ?? null };
    },
    async takeoverLock(_weekStart, _staleBefore, timeoutMs) {
      const { timedOut } = spend(timeoutMs, lockLatency);
      if (timedOut) return { takenOver: false, error: { code: '57014', message: 'statement timeout' } };
      return { takenOver: script.takenOver ?? false, error: null };
    },
    async finalizeLock(input, timeoutMs) {
      spend(timeoutMs, lockLatency);
      finalized.push(input);
      return { error: null };
    },
    async countPaidProfiles(timeoutMs) {
      const { timedOut } = spend(timeoutMs);
      if (timedOut) return { count: null, error: { code: '57014', message: 'statement timeout' } };
      return { count: script.paidCount ?? (script.profiles?.length ?? 0), error: null };
    },
    async listPaidProfiles(_limit, timeoutMs) {
      const { timedOut } = spend(timeoutMs);
      if (timedOut) return { rows: [], error: { code: '57014', message: 'statement timeout' } };
      return { rows: script.profiles ?? [], error: null };
    },
    async listWeekCitationUserIds(_iso, _ids, _limit, timeoutMs) {
      const { timedOut } = spend(timeoutMs);
      if (timedOut) return { userIds: [], error: { code: '57014', message: 'statement timeout' } };
      return { userIds: script.weekUserIds ?? [], error: null };
    },
    async insertCitations(rows, timeoutMs) {
      insertCalls++;
      const { timedOut } = spend(timeoutMs, insertLatency);
      if (script.insertOverrunMs) clock.advance(script.insertOverrunMs);
      if (timedOut || script.insertFails) {
        return { error: { code: '57014', message: 'insert failed' } };
      }
      insertedRows += rows.length;
      return { error: null };
    },
  };

  return { gateway, finalized, insertedRows: () => insertedRows, insertCalls: () => insertCalls };
}

function profile(id: string, keyword: string): GeoProfileRow {
  return {
    id,
    hospital_name: `${id}병원`,
    region: '대구 수성구',
    specialty: '피부과',
    hospital_keywords: [keyword],
    naver_blog_url: null,
  };
}

const stubEngine: GeoEngineAdapter = {
  id: 'openai',
  label: 'OpenAI',
  isConfigured: () => true,
  run: async () => ({ text: '답변', sources: [], searchQueryCount: 1 }),
};
const stubEngineB: GeoEngineAdapter = { ...stubEngine, id: 'perplexity', label: 'Perplexity' };
const stubEngineC: GeoEngineAdapter = { ...stubEngine, id: 'gemini', label: 'Gemini' };

/** 질의 단계가 데드라인을 꽉 채워 쓰는 최악 시나리오 */
function createSlowExecutor(clock: Clock, options: { fill: boolean; succeed: boolean }) {
  return async (input: ExecuteQueriesInput): Promise<ExecuteQueriesResult> => {
    if (options.fill) {
      // 실제 실행기는 공통 AbortSignal 로 deadlineAt 에 잘린다 → 그 시각까지만 쓴다
      const remaining = input.deadlineAt - clock.now();
      if (remaining > 0) clock.advance(remaining);
    }
    const cache = createGeoQueryCache();
    for (const question of input.questions) {
      for (const engine of input.engines) {
        await cache.resolve(engine.id, question, async () => {
          if (!options.succeed) throw new Error('engine down');
          return { text: `답변:${question}`, sources: [], searchQueryCount: 1 };
        });
      }
    }
    return {
      cache,
      stats: input.engines.map((e) => ({
        engine: e.id,
        calls: input.questions.length,
        succeeded: options.succeed ? input.questions.length : 0,
        failed: options.succeed ? 0 : input.questions.length,
        skipped: 0,
        httpAttempts: input.questions.length,
        searchQueries: input.questions.length,
      })),
      failures: [],
      httpAttempts: input.questions.length * input.engines.length,
      deadlineReached: options.fill,
    };
  };
}

// ---------------------------------------------------------------------------
// [차단 1] 최악의 경우에도 300초 안에 끝난다 — 실제 제어 흐름 검증
// ---------------------------------------------------------------------------

test('★최악 시나리오: 느린 DB + 데드라인까지 쓰는 질의 + 대량 저장 → 300초 미만', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  // 준비·저장 DB 가 매 호출 30초를 쓰려 들고(타임아웃에서 잘림), 질의는 데드라인까지 꽉 채우고,
  // 회원 100명이라 청크도 여러 개인 최악 조합
  const profiles = Array.from({ length: 100 }, (_, i) => profile(`u${i}`, `키워드${i}`));
  const spy = createGateway(clock, {
    lockLatencyMs: 4_000,
    latencyMs: 4_000,
    insertLatencyMs: 30_000,
    profiles,
    paidCount: 500,
  });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: createSlowExecutor(clock, { fill: true, succeed: true }),
  });

  const elapsed = clock.now() - startedAt;
  assert.ok(elapsed < PLATFORM_MAX_DURATION_MS, `경과 ${elapsed}ms 가 300초를 넘었다`);
  assert.ok(result.status === 200 || result.status === 500);
});

test('★잠금 확인이 타임아웃되면 외부 API 를 시작하지 않는다 (준비 구간 몇 초 안에 종료)', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  let executed = false;
  // 잠금 insert 가 30초를 쓰려 들지만 타임아웃(5초)에서 잘린다
  const spy = createGateway(clock, { latencyMs: 30_000, profiles: [profile('u1', 'k')] });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: async (input) => {
      executed = true;
      return createSlowExecutor(clock, { fill: false, succeed: true })(input);
    },
  });

  assert.equal(executed, false, '잠금 미확인인데 외부 API 를 호출했다');
  // 잠금 상태를 모르면 진행하지 않는다(이중 과금 방지)
  assert.equal(result.body.mode, 'error');
  // 준비 구간에서 잘렸으므로 전체 실행이 수 초 안에 끝난다
  assert.ok(clock.now() - startedAt <= PREFLIGHT_DEADLINE_MS, `경과 ${clock.now() - startedAt}ms`);
  assert.equal(spy.finalized.length, 0, '소유하지 않은 잠금을 건드리면 안 된다');
});

test('★잠금 이후 준비 DB 가 느리면 외부 API 를 시작하지 않고 failed 로 마감한다', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  let executed = false;
  // 잠금은 빠르게 성공, 나머지 준비 조회는 전부 타임아웃
  const spy = createGateway(clock, {
    lockLatencyMs: 50,
    latencyMs: 30_000,
    profiles: [profile('u1', 'k')],
  });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: async (input) => {
      executed = true;
      return createSlowExecutor(clock, { fill: false, succeed: true })(input);
    },
  });

  assert.equal(executed, false, '준비 단계 실패인데 외부 API 를 호출했다');
  assert.equal(result.body.mode, 'aborted');
  // 준비 구간 마감(20초) + 마무리 여유 안에서 끝난다
  assert.ok(clock.now() - startedAt < PLATFORM_MAX_DURATION_MS);
  // 잠금은 반드시 정리되고, 재실행 가능하도록 failed 로 마감돼야 한다
  assert.equal(spy.finalized.length, 1);
  assert.equal(spy.finalized[0].status, 'failed');
});

test('★질의가 데드라인을 꽉 채워도 저장 단계에 도달한다', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  const profiles = [profile('u1', 'k1'), profile('u2', 'k2')];
  const spy = createGateway(clock, { latencyMs: 100, profiles });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: createSlowExecutor(clock, { fill: true, succeed: true }),
  });

  // 질의가 200초를 다 썼어도 insert 가 실행됐다
  assert.ok(spy.insertCalls() >= 1, '저장 단계에 도달하지 못했다');
  assert.ok(spy.insertedRows() > 0);
  assert.equal(result.status, 200);
  assert.ok(clock.now() - startedAt < PLATFORM_MAX_DURATION_MS);
  assert.ok(clock.now() - startedAt >= QUERY_DEADLINE_MS);
});

test('★저장이 마감을 넘기면 중단하고 그 사실을 응답에 명시한다 (부분 저장 은폐 금지)', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  // 3엔진 × 회원 100명(상한으로 77명 유지) → 청크 5개.
  // 질의가 판정 마감 직전(209초)까지 쓰고, insert 는 타임아웃(10초)을 꽉 쓴 뒤
  // 문장 취소 지연 9초를 더 쓴다 → 4번째 청크에서 저장 마감(285초)에 닿는다.
  const profiles = Array.from({ length: 100 }, (_, i) => profile(`u${i}`, `키워드${i}`));
  const spy = createGateway(clock, {
    lockLatencyMs: 50,
    latencyMs: 50,
    insertLatencyMs: 10_000,
    insertOverrunMs: 9_000,
    profiles,
  });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine, stubEngineB, stubEngineC],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: async (input) => {
      const target = startedAt + 209_000;
      if (clock.now() < target) clock.advance(target - clock.now());
      return createSlowExecutor(clock, { fill: false, succeed: true })(input);
    },
  });

  const elapsed = clock.now() - startedAt;
  assert.ok(elapsed < PLATFORM_MAX_DURATION_MS, `경과 ${elapsed}ms 가 300초를 넘었다`);

  const truncated = (result.body as { truncated?: Record<string, unknown> }).truncated;
  assert.equal(result.body.mode, 'live');
  // 조용히 끝나지 않고 중단 사실과 남은 청크 수가 드러나야 한다
  assert.equal(truncated?.insertAborted, true, '저장 마감 중단이 보고되지 않았다');
  assert.ok((truncated?.chunksSkippedByDeadline as number) > 0);
  // 일부는 저장됐지만 전부는 아니다
  assert.ok(spy.insertedRows() > 0);
  // ★ 부분 저장이 그 주의 최종 결과로 고정되면 안 된다 → failed 로 마감해 재실행 허용
  assert.equal(spy.finalized[0].status, 'failed');
});

test('★인용 판정 마감이 코드로 강제된다 (산술 주석이 아니라 실제 검사)', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  const profiles = Array.from({ length: 60 }, (_, i) => profile(`u${i}`, `키워드${i}`));
  const spy = createGateway(clock, { latencyMs: 0, profiles });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    // 질의가 판정 마감(210초)까지 시간을 다 써 버린 상태를 만든다
    executeQueries: async (input) => {
      clock.advance(211_000);
      return createSlowExecutor(clock, { fill: false, succeed: true })(input);
    },
  });

  const truncated = (result.body as { truncated?: Record<string, unknown> }).truncated;
  assert.equal(truncated?.matchAborted, true, '판정 마감이 강제되지 않았다');
  assert.ok((truncated?.usersSkippedByMatchDeadline as number) > 0);
  assert.ok(clock.now() - startedAt < PLATFORM_MAX_DURATION_MS);
});

// ---------------------------------------------------------------------------
// [4차-2] 드레인 상한이 실행 코드에서 실제로 강제되는가
// ---------------------------------------------------------------------------

test('★드레인 상한: abort 후에도 끝나지 않는 질의를 기다리지 않고 저장으로 넘어간다', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  const spy = createGateway(clock, { latencyMs: 50, profiles: [profile('u1', 'k1')] });

  let releaseExecutor: (() => void) | undefined;
  // abort 이후에도 "영원히" 끝나지 않는 실행기 — 드레인 가드가 없으면 여기서 멈춘다
  const hangingExecutor = () =>
    new Promise<ExecuteQueriesResult>((resolve) => {
      releaseExecutor = () =>
        resolve({
          cache: createGeoQueryCache(),
          stats: [],
          failures: [],
          httpAttempts: 0,
          deadlineReached: true,
        });
    });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: hangingExecutor,
    // 가상 시계를 드레인 마감으로 옮기고 즉시 깨운다
    waitUntil: async (atMs) => {
      if (clock.now() < atMs) clock.advance(atMs - clock.now());
    },
  });

  // 실행기를 풀어주지 않았는데도 반환됐다 = 드레인 상한이 작동했다
  assert.equal(typeof releaseExecutor, 'function');
  const truncated = (result.body as { truncated?: Record<string, unknown> }).truncated;
  assert.equal(truncated?.queryDrainTimedOut, true, '드레인 초과가 보고되지 않았다');
  assert.equal(truncated?.deadlineReached, true);
  // 드레인 마감(205초) 근처에서 넘어갔고 300초를 넘지 않았다
  const elapsed = clock.now() - startedAt;
  assert.ok(elapsed >= QUERY_DEADLINE_MS, `경과 ${elapsed}ms 가 질의 마감보다 빠르다`);
  assert.ok(elapsed < PLATFORM_MAX_DURATION_MS);
  // 확정되지 않은 실행은 재실행 대상이다
  assert.equal(spy.finalized[0].status, 'failed');
  releaseExecutor?.();
});

test('★드레인 안에 정리가 끝나면 정상 결과를 그대로 쓴다', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  const spy = createGateway(clock, { latencyMs: 50, profiles: [profile('u1', 'k1')] });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: createSlowExecutor(clock, { fill: false, succeed: true }),
    // 드레인 대기는 영원히 오지 않는다 → 실행기가 이겨야 한다
    waitUntil: () => new Promise<void>(() => {}),
  });

  const truncated = (result.body as { truncated?: Record<string, unknown> }).truncated;
  assert.equal(truncated?.queryDrainTimedOut, false);
  assert.equal(spy.finalized[0].status, 'done');
});

test('★드레인 초과 시에도 그때까지 수집된 응답은 저장된다 (캐시를 호출부가 소유)', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  const spy = createGateway(clock, { latencyMs: 50, profiles: [profile('u1', 'k1')] });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    // 캐시에 응답을 채워 넣고는 영원히 반환하지 않는 실행기
    executeQueries: async (input) => {
      for (const question of input.questions) {
        for (const engine of input.engines) {
          await input.cache!.resolve(engine.id, question, async () => ({
            text: `${question} 답변 — u1병원 추천`,
            sources: [],
            searchQueryCount: 1,
          }));
        }
      }
      return new Promise<ExecuteQueriesResult>(() => {});
    },
    // 질의가 캐시를 다 채운 뒤에 드레인 마감이 오는 상황
    waitUntil: async (atMs) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (clock.now() < atMs) clock.advance(atMs - clock.now());
    },
  });

  // 드레인으로 넘어갔지만 캐시에 담긴 응답으로 행이 만들어져 저장됐다
  assert.equal((result.body as { truncated?: Record<string, unknown> }).truncated?.queryDrainTimedOut, true);
  assert.ok(spy.insertedRows() > 0, '수집된 응답이 버려졌다');
});

// ---------------------------------------------------------------------------
// [4차-1] 조회 상한 초과 회원 / count 실패도 실패 신호다
// ---------------------------------------------------------------------------

test('★MAX_USERS 를 넘긴 회원이 있으면 done 으로 확정하지 않는다', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  // 유료 500명인데 조회는 1명만 됐다 → 499명은 그 주에 처리되지 않는다
  const spy = createGateway(clock, {
    latencyMs: 50,
    profiles: [profile('u1', 'k1')],
    paidCount: 500,
  });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: createSlowExecutor(clock, { fill: false, succeed: true }),
  });

  const truncated = (result.body as { truncated?: Record<string, unknown> }).truncated;
  assert.equal(truncated?.usersOverFetchLimit, 499);
  assert.equal(spy.finalized[0].status, 'failed', '회원 누락인데 done 으로 확정됐다');
});

test('★유료 회원 총수 조회가 실패하면 누락 인원을 알 수 없으므로 failed 로 마감한다', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  const base = createGateway(clock, { latencyMs: 50, profiles: [profile('u1', 'k1')] });
  const failingCount: GeoTrackingGateway = {
    ...base.gateway,
    async countPaidProfiles() {
      return { count: null, error: { code: '57014', message: 'statement timeout' } };
    },
  };

  const result = await runGeoTracking({
    gateway: failingCount,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: createSlowExecutor(clock, { fill: false, succeed: true }),
  });

  const truncated = (result.body as { truncated?: Record<string, unknown> }).truncated;
  // count 를 0 으로 퉁쳐서 "누락 0명" 으로 보이게 하면 안 된다
  assert.equal(truncated?.paidCountUnknown, true);
  assert.equal(base.finalized[0].status, 'failed');
});

// ---------------------------------------------------------------------------
// [4차-3] finally 안의 예외가 결과를 덮어쓰면 안 된다
// ---------------------------------------------------------------------------

test('★잠금 정리 중 예외가 나도 원래 결과를 반환한다', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  const base = createGateway(clock, { latencyMs: 50, profiles: [profile('u1', 'k1')] });
  const throwingFinalize: GeoTrackingGateway = {
    ...base.gateway,
    async finalizeLock() {
      throw new Error('잠금 테이블 폭발');
    },
  };

  const result = await runGeoTracking({
    gateway: throwingFinalize,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: createSlowExecutor(clock, { fill: false, succeed: true }),
  });

  // 정리 실패가 정상 응답을 폐기하면 안 된다
  assert.equal(result.status, 200);
  assert.equal(result.body.mode, 'live');
  assert.ok((result.body as { inserted?: number }).inserted! > 0);
});

// ---------------------------------------------------------------------------
// [차단 2] 잠금이 부분 저장을 영구 고정하면 안 된다
// ---------------------------------------------------------------------------

test('★insert 실패 시 done 으로 마감하지 않는다 (재실행 가능해야 한다)', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  const spy = createGateway(clock, {
    latencyMs: 10,
    profiles: [profile('u1', 'k1')],
    insertFails: true,
  });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: createSlowExecutor(clock, { fill: false, succeed: true }),
  });

  assert.equal(spy.finalized.length, 1);
  assert.equal(spy.finalized[0].status, 'failed', 'insert 실패인데 done 으로 마감됐다');
  assert.equal(spy.finalized[0].inserted, 0);
  const body = result.body as { insertErrors?: string[] };
  assert.ok((body.insertErrors ?? []).length > 0, '실패 사유가 응답에 없다');
});

test('★완전 성공일 때만 done 으로 마감한다', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  const spy = createGateway(clock, { latencyMs: 10, profiles: [profile('u1', 'k1')] });

  await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: createSlowExecutor(clock, { fill: false, succeed: true }),
  });

  assert.equal(spy.finalized[0].status, 'done');
  assert.ok(spy.finalized[0].inserted > 0);
});

test('★엔진 실패로 회원이 빠지면 failed 로 마감해 재실행을 허용한다', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  const spy = createGateway(clock, { latencyMs: 10, profiles: [profile('u1', 'k1')] });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: createSlowExecutor(clock, { fill: false, succeed: false }),
  });

  assert.equal(spy.finalized[0].status, 'failed');
  const truncated = (result.body as { truncated?: Record<string, unknown> }).truncated;
  assert.equal(truncated?.usersDroppedPartialFailure, 1);
  assert.equal(spy.insertCalls(), 0, '부분 실패 회원을 저장하려 했다');
});

test('★예외가 나도 finally 에서 잠금을 정리한다 (running 방치 금지)', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  const spy = createGateway(clock, { latencyMs: 10, profiles: [profile('u1', 'k1')] });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: async () => {
      throw new Error('예기치 못한 폭발');
    },
  });

  assert.equal(result.status, 500);
  assert.equal(spy.finalized.length, 1, '예외 경로에서 잠금이 정리되지 않았다');
  assert.equal(spy.finalized[0].status, 'failed');
  assert.match(spy.finalized[0].note ?? '', /폭발/);
});

test('★DB 조회 실패로 조기 반환해도 잠금이 정리된다', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  const gateway = createGateway(clock, { latencyMs: 10, profiles: [] });
  // profiles 조회만 실패시킨다
  const failing: GeoTrackingGateway = {
    ...gateway.gateway,
    async listPaidProfiles() {
      return { rows: [], error: { code: '08006', message: '연결 끊김' } };
    },
  };

  const result = await runGeoTracking({
    gateway: failing,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: createSlowExecutor(clock, { fill: false, succeed: true }),
  });

  assert.equal(result.status, 500);
  assert.equal(gateway.finalized.length, 1);
  assert.equal(gateway.finalized[0].status, 'failed');
});

// ---------------------------------------------------------------------------
// 잠금 동작 — 동시 실행 차단 / 비용 발생 이전
// ---------------------------------------------------------------------------

test('★잠금 충돌 시 외부 API 를 호출하지 않고 즉시 종료한다', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  let executed = false;
  const spy = createGateway(clock, {
    latencyMs: 10,
    profiles: [profile('u1', 'k1')],
    lockError: { code: '23505', message: 'duplicate key' },
    takenOver: false,
  });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: async (input) => {
      executed = true;
      return createSlowExecutor(clock, { fill: false, succeed: true })(input);
    },
  });

  assert.equal(executed, false, '잠금 충돌인데 외부 API 비용이 발생했다');
  assert.equal(result.body.mode, 'locked');
  assert.equal(spy.finalized.length, 0, 'locked 는 정리할 잠금이 없다');
});

test('★failed/stale 잠금은 인계받아 진행한다', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  const spy = createGateway(clock, {
    latencyMs: 10,
    profiles: [profile('u1', 'k1')],
    lockError: { code: '23505', message: 'duplicate key' },
    takenOver: true,
  });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: createSlowExecutor(clock, { fill: false, succeed: true }),
  });

  assert.equal(result.body.mode, 'live');
  assert.equal(spy.finalized[0].status, 'done');
});

test('★잠금 상태 확인 불가는 진행하지 않는다 (이중 과금 방지)', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  let executed = false;
  const spy = createGateway(clock, {
    latencyMs: 10,
    profiles: [profile('u1', 'k1')],
    lockError: { code: '08006', message: '연결 실패' },
  });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: async (input) => {
      executed = true;
      return createSlowExecutor(clock, { fill: false, succeed: true })(input);
    },
  });

  assert.equal(executed, false);
  assert.equal(result.status, 500);
  assert.equal(result.body.mode, 'error');
});

test('이미 이번 주에 저장된 회원은 재실행에서 건너뛴다 (재과금 방지)', async () => {
  const clock = createClock();
  const startedAt = clock.now();
  const spy = createGateway(clock, {
    latencyMs: 10,
    profiles: [profile('u1', 'k1'), profile('u2', 'k2')],
    weekUserIds: ['u1'],
  });

  const result = await runGeoTracking({
    gateway: spy.gateway,
    engines: [stubEngine],
    env: {},
    weekStart: '2026-07-20',
    startedAt,
    now: clock.now,
    executeQueries: createSlowExecutor(clock, { fill: false, succeed: true }),
  });

  assert.equal((result.body as { skippedAlreadyChecked?: number }).skippedAlreadyChecked, 1);
  assert.equal((result.body as { users?: number }).users, 1);
});
