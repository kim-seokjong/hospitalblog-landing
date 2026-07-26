/**
 * GEO 인용 추적 실행 오케스트레이터.
 *
 * 라우트에서 분리한 이유: **시간 상한을 테스트로 증명하기 위해서**다.
 * DB 접근을 게이트웨이 인터페이스로, 시각을 now() 로 주입받으므로
 * 가상 시계 + 지연 mock 으로 "최악의 경우에도 300초를 넘지 않는다"를 실제 제어 흐름에서 검증할 수 있다.
 * (상수 합계만 검증하는 테스트는 아무것도 보장하지 못한다)
 *
 * 강제되는 절대 마감 (모두 startedAt 기준, 근거는 budget.ts "실행 시간 예산"):
 *   1~3단계 준비   → PREFLIGHT_DEADLINE_MS (20s)  · 초과 시 외부 API 를 시작하지 않는다
 *   5단계 질의     → QUERY_DEADLINE_MS (200s)     · 공통 AbortSignal
 *   6단계 인용판정 → MATCH_DEADLINE_MS (210s)     · 회원 루프에서 시각 검사
 *   7단계 저장     → SAVE_DEADLINE_MS (285s)      · 청크별 타임아웃 + 중단 보고
 *   마무리         → FINALIZE_DEADLINE_MS (288s)  · finally 에서 잠금 정리
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

import { createAttemptBudget } from './attempts.ts';
import { chunkGroups } from './batching.ts';
import {
  FINALIZE_DEADLINE_MS,
  INSERT_CHUNK_TIMEOUT_MS,
  LOCK_FINALIZE_TIMEOUT_MS,
  MATCH_DEADLINE_MS,
  MAX_HTTP_ATTEMPTS_PER_RUN,
  MAX_MATCH_TEXT_CHARS,
  MAX_REPORTED_FAILURES,
  MAX_USERS,
  MIN_INSERT_WINDOW_MS,
  MIN_PREFLIGHT_WINDOW_MS,
  PREFLIGHT_DEADLINE_MS,
  PREFLIGHT_OP_TIMEOUT_MS,
  QUERY_DEADLINE_MS,
  QUERY_DRAIN_ALLOWANCE_MS,
  SAVE_DEADLINE_MS,
  capQuestionPlan,
  clampTimeout,
  maxUniqueQuestionsFor,
  type UserQuestionPlan,
} from './budget.ts';
import { createGeoQueryCache } from './cache.ts';
import { executeGeoQueries, type ExecuteQueriesInput, type ExecuteQueriesResult } from './index.ts';
import { MAX_SOURCES } from './types.ts';
import {
  interpretLockInsert,
  resolveFinalStatus,
  staleThresholdIso,
  type DbErrorLike,
  type RunLockDecision,
  type RunStatus,
} from './run-lock.ts';
import type { GeoEngineAdapter, GeoEngineEnv } from './types.ts';
import {
  buildGeoQuestions,
  detectCitation,
  sanitizeExcerpt,
} from '../geo-tracking.ts';
import { extractNaverBlogId } from '../rank-tracking.ts';

/** raw 에 보관하는 응답 발췌 길이 (전체 원문 저장 금지) */
const RAW_EXCERPT_LENGTH = 300;
/** geo_citations 배치 insert 목표 크기 — 회원 경계는 넘지 않는다 */
const INSERT_CHUNK_SIZE = 200;
/**
 * 이번 주 중복 확인 조회 상한.
 * 후보 회원 id 로 범위를 좁혀 조회하므로(.in) 테이블 전체 증가와 무관하다.
 * 우리 cron 이 한 주에 쓰는 최대 행 수 = 100명 × 5질의 × 3엔진 = 1,500.
 * 실패 후 재실행까지 겹쳐도 3,000. 그 두 배인 6,000 을 상한으로 둔다.
 */
export const WEEK_ROWS_LOOKUP_LIMIT = 6_000;
/**
 * 인용 판정 루프에서 마감을 확인하는 주기 (회원 수).
 * 1 = 매 회원마다. now() 호출 비용은 무시할 수 있고,
 * 회원당 처리 시간이 MAX_MATCH_TEXT_CHARS 로 묶여 있어 이 주기면 마감이 엄밀해진다.
 */
const MATCH_DEADLINE_CHECK_EVERY = 1;

export interface GeoProfileRow {
  readonly id: string;
  readonly hospital_name: string | null;
  readonly region: string | null;
  readonly specialty: string | null;
  readonly hospital_keywords: string[] | null;
  readonly naver_blog_url: string | null;
}

export interface GeoCitationInsertRow {
  readonly user_id: string;
  readonly question: string;
  readonly engine: string;
  readonly cited: boolean;
  readonly citation_type: string;
  readonly evidence: string | null;
  readonly raw: {
    readonly sources: ReadonlyArray<{ url: string; title: string }>;
    readonly excerpt: string;
  };
}

export interface FinalizeLockInput {
  readonly weekStart: string;
  readonly status: RunStatus;
  readonly users: number;
  readonly inserted: number;
  readonly httpAttempts: number;
  readonly note: string | null;
}

/**
 * DB 접근 경계. 모든 메서드가 timeoutMs 를 받아 **호출 시간이 상한을 넘지 않음**을
 * 구현체가 보장한다(실제 구현은 AbortSignal.timeout, 테스트는 가상 시계).
 */
export interface GeoTrackingGateway {
  acquireLock(weekStart: string, timeoutMs: number): Promise<{ error: DbErrorLike | null }>;
  takeoverLock(
    weekStart: string,
    staleBeforeIso: string,
    timeoutMs: number,
  ): Promise<{ takenOver: boolean; error: DbErrorLike | null }>;
  finalizeLock(input: FinalizeLockInput, timeoutMs: number): Promise<{ error: DbErrorLike | null }>;
  countPaidProfiles(timeoutMs: number): Promise<{ count: number | null; error: DbErrorLike | null }>;
  listPaidProfiles(
    limit: number,
    timeoutMs: number,
  ): Promise<{ rows: readonly GeoProfileRow[]; error: DbErrorLike | null }>;
  listWeekCitationUserIds(
    weekStartIso: string,
    candidateIds: readonly string[],
    limit: number,
    timeoutMs: number,
  ): Promise<{ userIds: readonly string[]; error: DbErrorLike | null }>;
  insertCitations(
    rows: readonly GeoCitationInsertRow[],
    timeoutMs: number,
  ): Promise<{ error: DbErrorLike | null }>;
}

export interface RunGeoTrackingInput {
  readonly gateway: GeoTrackingGateway;
  readonly engines: readonly GeoEngineAdapter[];
  readonly env: GeoEngineEnv;
  readonly weekStart: string;
  /** 요청 진입 시각 — 모든 절대 마감의 기준점 */
  readonly startedAt: number;
  readonly now: () => number;
  readonly fetchImpl?: typeof fetch;
  readonly sleepImpl?: (ms: number) => Promise<void>;
  /** 테스트 주입용 — 기본은 실제 엔진 실행기 */
  readonly executeQueries?: (input: ExecuteQueriesInput) => Promise<ExecuteQueriesResult>;
  /** 테스트 주입용 — 드레인 마감까지의 대기(기본은 실제 타이머) */
  readonly waitUntil?: (atMs: number) => Promise<void>;
  readonly logger?: {
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

export interface RunGeoTrackingResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

const NOOP_LOGGER = { warn: () => {}, error: () => {} };

/** 준비 단계 1건의 타임아웃 — 마감까지 남은 시간으로 좁힌다. null = 시간 없음 */
function preflightTimeout(now: number, deadlineAt: number): number | null {
  return clampTimeout(now, deadlineAt, PREFLIGHT_OP_TIMEOUT_MS, MIN_PREFLIGHT_WINDOW_MS);
}

/** 드레인 경합에서 "시간 초과" 쪽이 이겼음을 나타내는 고유 토큰 */
const DRAIN_TIMED_OUT = Symbol('geo-query-drain-timeout');

interface DrainWaiter {
  readonly promise: Promise<typeof DRAIN_TIMED_OUT>;
  readonly cancel: () => void;
}

/**
 * 드레인 마감까지 기다리는 대기자.
 * waitUntil 주입이 있으면 그것을 쓰고(테스트의 가상 시계), 없으면 실제 타이머를 쓴다.
 */
function createDrainWaiter(
  atMs: number,
  now: () => number,
  waitUntil?: (atMs: number) => Promise<void>,
): DrainWaiter {
  if (waitUntil) {
    return { promise: waitUntil(atMs).then(() => DRAIN_TIMED_OUT), cancel: () => {} };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<typeof DRAIN_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(DRAIN_TIMED_OUT), Math.max(0, atMs - now()));
  });
  return { promise, cancel: () => { if (timer) clearTimeout(timer); } };
}

export async function runGeoTracking(input: RunGeoTrackingInput): Promise<RunGeoTrackingResult> {
  const { gateway, engines, weekStart, startedAt, now } = input;
  const log = input.logger ?? NOOP_LOGGER;
  const execute = input.executeQueries ?? executeGeoQueries;

  const preflightDeadlineAt = startedAt + PREFLIGHT_DEADLINE_MS;
  const queryDeadlineAt = startedAt + QUERY_DEADLINE_MS;
  const matchDeadlineAt = startedAt + MATCH_DEADLINE_MS;
  const saveDeadlineAt = startedAt + SAVE_DEADLINE_MS;
  const finalizeDeadlineAt = startedAt + FINALIZE_DEADLINE_MS;

  let lock: RunLockDecision = { mode: 'error', reason: null, proceed: false, needsFinalize: false };
  // 마감 상태 판정 재료 — finally 에서 done/failed 를 가른다
  let preflightAborted = false;
  let paidCountUnknown = false;
  let usersOverFetchLimit = 0;
  let queryDeadlineReached = false;
  let queryDrainTimedOut = false;
  let matchAborted = false;
  let insertAborted = false;
  let insertErrorCount = 0;
  let usersDroppedPartialFailure = 0;
  let usersOverQueryBudget = 0;
  let threw = false;
  let savedUsers = 0;
  let inserted = 0;
  let httpAttempts = 0;
  let finalizeNote: string | null = null;

  try {
    // ── 1단계: 실행 잠금 (외부 API 호출 = 비용 발생 이전에 원자적으로 선점)
    const lockTimeout = preflightTimeout(now(), preflightDeadlineAt);
    if (lockTimeout === null) {
      preflightAborted = true;
      return { status: 500, body: { ok: false, mode: 'aborted', weekStart, error: '준비 단계 시간이 부족해 시작하지 못했습니다.' } };
    }
    const acquired = await gateway.acquireLock(weekStart, lockTimeout);
    if (acquired.error?.code === '23505') {
      const takeoverTimeout = preflightTimeout(now(), preflightDeadlineAt);
      if (takeoverTimeout === null) {
        lock = interpretLockInsert(acquired.error);
      } else {
        const taken = await gateway.takeoverLock(weekStart, staleThresholdIso(now()), takeoverTimeout);
        lock = taken.error
          ? interpretLockInsert(acquired.error)
          : interpretLockInsert(acquired.error, taken.takenOver);
      }
    } else {
      lock = interpretLockInsert(acquired.error);
    }

    if (!lock.proceed) {
      log.warn(`[geo-tracking] 실행 중단 (lock=${lock.mode}): ${lock.reason}`);
      return {
        status: lock.mode === 'error' ? 500 : 200,
        body: { ok: lock.mode !== 'error', mode: lock.mode, weekStart, message: lock.reason },
      };
    }
    if (lock.mode === 'unavailable') log.warn(`[geo-tracking] ${lock.reason}`);

    // ── 2단계: 유료 회원 조회 (count 와 목록은 서로 의존하지 않아 병렬로 — 준비 구간 단축)
    const profilesTimeout = preflightTimeout(now(), preflightDeadlineAt);
    if (profilesTimeout === null) {
      preflightAborted = true;
      finalizeNote = '준비 단계 마감 초과 (회원 조회 전)';
      return abortedResult(weekStart, lock, finalizeNote);
    }
    const [countRes, listRes] = await Promise.all([
      gateway.countPaidProfiles(profilesTimeout),
      gateway.listPaidProfiles(MAX_USERS, profilesTimeout),
    ]);
    if (listRes.error) {
      preflightAborted = true;
      finalizeNote = `회원 조회 실패: ${listRes.error.message ?? '알 수 없는 오류'}`;
      return { status: 500, body: { ok: false, mode: 'aborted', weekStart, lock: lock.mode, error: finalizeNote } };
    }
    const profiles = listRes.rows;

    // count 실패를 무시하면 (count ?? 0) 때문에 초과 회원이 0명으로 보이고
    // 누락이 있는데도 done 으로 마감된다 → 알 수 없으면 실패로 간주한다.
    paidCountUnknown = Boolean(countRes.error) || countRes.count === null;
    if (paidCountUnknown) {
      log.warn(
        `[geo-tracking] 유료 회원 총수 조회 실패 — 누락 인원을 알 수 없어 failed 로 마감합니다: ${countRes.error?.message ?? 'count 없음'}`,
      );
    }
    // MAX_USERS 를 넘겨 조회조차 되지 않은 회원 — 그 주에 영영 처리되지 않으므로 실패 신호다
    usersOverFetchLimit = Math.max(0, (countRes.count ?? 0) - profiles.length);

    // ── 3단계: 이번 주 중복 확인 (재실행이 이미 저장된 회원을 다시 과금하지 않게 한다)
    const dupTimeout = preflightTimeout(now(), preflightDeadlineAt);
    if (dupTimeout === null) {
      preflightAborted = true;
      finalizeNote = '준비 단계 마감 초과 (중복 확인 전)';
      return abortedResult(weekStart, lock, finalizeNote);
    }
    const dup = await gateway.listWeekCitationUserIds(
      `${weekStart}T00:00:00.000Z`,
      profiles.map((p) => p.id),
      WEEK_ROWS_LOOKUP_LIMIT,
      dupTimeout,
    );
    if (dup.error) {
      preflightAborted = true;
      finalizeNote = `중복 확인 실패로 중단(이중 과금 방지): ${dup.error.message ?? '알 수 없는 오류'}`;
      log.error(`[geo-tracking] ${finalizeNote}`);
      return { status: 500, body: { ok: false, mode: 'aborted', weekStart, lock: lock.mode, error: finalizeNote } };
    }
    if (dup.userIds.length >= WEEK_ROWS_LOOKUP_LIMIT) {
      preflightAborted = true;
      finalizeNote = `중복 확인 조회가 상한(${WEEK_ROWS_LOOKUP_LIMIT})에 닿아 신뢰할 수 없습니다.`;
      log.error(`[geo-tracking] ${finalizeNote}`);
      return { status: 500, body: { ok: false, mode: 'aborted', weekStart, lock: lock.mode, error: finalizeNote } };
    }
    const alreadyChecked = new Set(dup.userIds);

    // 준비 구간을 다 쓰고 나면 질의를 시작하지 않는다 (여기서 넘기면 300초를 못 지킨다)
    if (now() >= preflightDeadlineAt) {
      preflightAborted = true;
      finalizeNote = '준비 단계 마감 초과 — 외부 API 를 시작하지 않았습니다.';
      log.error(`[geo-tracking] ${finalizeNote}`);
      return abortedResult(weekStart, lock, finalizeNote);
    }

    // ── 4단계: 질의 계획
    const plans: UserQuestionPlan[] = [];
    const targets = new Map<string, { hospitalName: string | null; naverBlogId: string | null }>();
    let skippedNoMaterial = 0;
    let skippedAlreadyChecked = 0;

    for (const profile of profiles) {
      if (alreadyChecked.has(profile.id)) {
        skippedAlreadyChecked++;
        continue;
      }
      const questions = buildGeoQuestions({
        region: profile.region,
        specialty: profile.specialty,
        hospitalKeywords: profile.hospital_keywords,
      });
      const naverBlogId = extractNaverBlogId(profile.naver_blog_url);
      if (questions.length === 0 || (!profile.hospital_name && !naverBlogId)) {
        skippedNoMaterial++;
        continue;
      }
      plans.push({ userId: profile.id, questions });
      targets.set(profile.id, { hospitalName: profile.hospital_name, naverBlogId });
    }

    const capped = capQuestionPlan(plans, maxUniqueQuestionsFor(engines.length));
    usersOverQueryBudget = capped.truncatedUsers;

    // ── 5단계: 엔진 병렬 실행 (공통 AbortSignal 이 200초에 모든 대기를 깨운다)
    //
    // ★ 드레인 상한 강제: 200초에 취소 신호를 쏴도 워커 정리가 끝날 때까지
    //   무한정 기다리면 QUERY_DRAIN_ALLOWANCE_MS 는 이름뿐인 상수가 된다.
    //   그래서 실행 완료와 드레인 마감(205초)을 경합시키고, 드레인이 이기면
    //   결과를 기다리지 않고 저장 단계로 넘어간다.
    //   캐시와 시도 예산은 **여기서 소유**하므로, 기다리지 않고 넘어가도
    //   그때까지 수집된 응답과 실제 발생 비용은 그대로 남는다.
    const cache = createGeoQueryCache();
    const attemptBudget = createAttemptBudget(MAX_HTTP_ATTEMPTS_PER_RUN);
    const drainDeadlineAt = queryDeadlineAt + QUERY_DRAIN_ALLOWANCE_MS;

    const executePromise = execute({
      questions: capped.uniqueQuestions,
      engines,
      env: input.env,
      fetchImpl: input.fetchImpl,
      deadlineAt: queryDeadlineAt,
      cache,
      attemptBudget,
      now,
      sleepImpl: input.sleepImpl,
    });
    // 버려질 수 있는 Promise 이므로 미처리 거부(unhandled rejection)를 막는다
    const settled = executePromise.then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason }),
    );

    const drain = createDrainWaiter(drainDeadlineAt, now, input.waitUntil);
    const raced = await Promise.race([settled, drain.promise]);
    drain.cancel();

    let executed: ExecuteQueriesResult;
    if (raced === DRAIN_TIMED_OUT) {
      queryDrainTimedOut = true;
      queryDeadlineReached = true;
      httpAttempts = attemptBudget.used();
      // 수집된 캐시는 그대로 쓰고, 확정되지 않은 통계는 비운다
      executed = { cache, stats: [], failures: [], httpAttempts, deadlineReached: true };
      log.error(
        `[geo-tracking] 질의 드레인 상한(${QUERY_DRAIN_ALLOWANCE_MS}ms) 초과 — 정리를 기다리지 않고 저장 단계로 넘어갑니다.`,
      );
    } else if (!raced.ok) {
      throw raced.reason instanceof Error ? raced.reason : new Error(String(raced.reason));
    } else {
      executed = raced.value;
      httpAttempts = executed.httpAttempts;
      queryDeadlineReached = executed.deadlineReached;
    }

    for (const failure of executed.failures.slice(0, MAX_REPORTED_FAILURES)) {
      log.error(`[geo-tracking] ${failure.engine} 질의 실패: ${failure.question} — ${failure.reason}`);
    }
    if (queryDeadlineReached && !queryDrainTimedOut) {
      log.warn('[geo-tracking] 질의 데드라인 도달 — 미완료 질의를 취소하고 저장 단계로 넘어갑니다.');
    }

    // ── 6단계: 회원별 인용 판정 (전부 아니면 전무 + 마감 강제)
    const userRowGroups: GeoCitationInsertRow[][] = [];
    let citedCount = 0;
    let unresolvedResults = 0;
    let usersSkippedByMatchDeadline = 0;

    for (let i = 0; i < capped.kept.length; i++) {
      // 순수 문자열 매칭이라 빠르지만 상한을 코드로 확인한다(산술 주석만으로는 보장이 안 된다)
      if (i % MATCH_DEADLINE_CHECK_EVERY === 0 && now() >= matchDeadlineAt) {
        matchAborted = true;
        usersSkippedByMatchDeadline = capped.kept.length - i;
        log.error(`[geo-tracking] 인용 판정 마감 도달 — 회원 ${usersSkippedByMatchDeadline}명을 처리하지 못했습니다.`);
        break;
      }

      const plan = capped.kept[i];
      const target = targets.get(plan.userId);
      if (!target) continue;

      const rows: GeoCitationInsertRow[] = [];
      let cited = 0;
      let complete = true;

      for (const question of plan.questions) {
        for (const engine of engines) {
          const outcome = executed.cache.peek(engine.id, question);
          if (!outcome || !outcome.ok) {
            unresolvedResults++;
            complete = false;
            continue;
          }
          // 회원당 처리 시간을 유한하게 묶는다 — 이 상한이 없으면
          // 판정 마감(210초)이 "엄밀한 상한"이라고 말할 수 없다.
          const matchText = outcome.answer.text.slice(0, MAX_MATCH_TEXT_CHARS);
          const sources = outcome.answer.sources.slice(0, MAX_SOURCES);

          const result = detectCitation(
            { text: matchText, sourceUrls: sources.map((s) => s.url) },
            { hospitalName: target.hospitalName, naverBlogId: target.naverBlogId },
          );
          if (result.cited) cited++;
          rows.push({
            user_id: plan.userId,
            question,
            engine: engine.id,
            cited: result.cited,
            citation_type: result.citationType,
            evidence: result.evidence,
            raw: {
              sources: sources.map((s) => ({ url: s.url, title: s.title })),
              excerpt: sanitizeExcerpt(matchText, RAW_EXCERPT_LENGTH),
            },
          });
        }
      }

      if (!complete) {
        usersDroppedPartialFailure++;
        continue; // 부분 표본은 저장하지 않는다
      }
      citedCount += cited;
      userRowGroups.push(rows);
    }

    // ── 7단계: 배치 저장 (회원 경계 보존 + 절대 마감)
    const chunks = chunkGroups(userRowGroups, INSERT_CHUNK_SIZE);
    const insertErrors: string[] = [];
    let chunksSkippedByDeadline = 0;

    for (let i = 0; i < chunks.length; i++) {
      const timeoutMs = clampTimeout(now(), saveDeadlineAt, INSERT_CHUNK_TIMEOUT_MS, MIN_INSERT_WINDOW_MS);
      if (timeoutMs === null) {
        insertAborted = true;
        chunksSkippedByDeadline = chunks.length - i;
        log.error(`[geo-tracking] 저장 마감 도달 — 남은 청크 ${chunksSkippedByDeadline}건을 저장하지 못했습니다.`);
        break;
      }
      const { error: insErr } = await gateway.insertCitations(chunks[i], timeoutMs);
      if (insErr) {
        insertErrorCount++;
        if (insertErrors.length < MAX_REPORTED_FAILURES) {
          insertErrors.push(insErr.message ?? '알 수 없는 오류');
        }
        log.error(`[geo-tracking] geo_citations 배치 insert 실패: ${insErr.message ?? ''}`);
        continue;
      }
      inserted += chunks[i].length;
      savedUsers += countGroupsIn(chunks[i]);
    }

    const plannedApiCalls =
      capped.kept.reduce((sum, p) => sum + p.questions.length, 0) * engines.length;
    // 드레인으로 넘어간 경우 엔진 통계가 확정되지 않았다.
    // 0 으로 보고하면 "중복 제거 100%" 같은 거짓 수치가 나오므로 null 로 둔다.
    const actualApiCalls = queryDrainTimedOut
      ? null
      : executed.stats.reduce((sum, s) => sum + s.calls, 0);
    const dedupedApiCalls = actualApiCalls === null ? null : Math.max(0, plannedApiCalls - actualApiCalls);

    return {
      status: 200,
      body: {
        ok: true,
        mode: 'live',
        weekStart,
        lock: { mode: lock.mode, note: lock.reason },
        engines: engines.map((e) => e.id),
        users: savedUsers,
        inserted,
        cited: citedCount,
        truncated: {
          usersOverFetchLimit,
          // 유료 회원 총수 조회 실패 → 누락 인원을 알 수 없다(이 경우 failed 로 마감)
          paidCountUnknown,
          usersOverQueryBudget,
          questionsDropped: capped.droppedQuestions,
          usersDroppedPartialFailure,
          unresolvedResults,
          deadlineReached: queryDeadlineReached,
          queryDrainTimedOut,
          matchAborted,
          usersSkippedByMatchDeadline,
          insertAborted,
          chunksSkippedByDeadline,
        },
        skippedNoMaterial,
        skippedAlreadyChecked,
        queries: {
          uniqueQuestions: capped.uniqueQuestions.length,
          plannedApiCalls,
          actualApiCalls,
          dedupedApiCalls,
          httpAttempts,
        },
        engineStats: executed.stats,
        failures: executed.failures.slice(0, MAX_REPORTED_FAILURES),
        failureCount: executed.failures.length,
        insertErrors,
        elapsedMs: now() - startedAt,
      },
    };
  } catch (e) {
    threw = true;
    const message = e instanceof Error ? e.message : 'cron failed';
    finalizeNote = message;
    log.error(`[geo-tracking] 배치 중단: ${message}`);
    return { status: 500, body: { ok: false, mode: 'error', weekStart, lock: lock.mode, error: message } };
  } finally {
    // ★ 정상·에러·조기반환 어느 경로로 나가도 잠금을 반드시 정리한다.
    //   여기서 빠지면 레코드가 running 으로 남아 정상 재실행까지 10분간 거부된다.
    //   그리고 완전 성공이 아니면 'failed' 로 마감해 그 주 재실행을 허용한다
    //   (done 으로 찍으면 부분 저장이 그 주의 최종 결과로 영구 고정된다).
    // ★ finally 안에서 던지면 try/catch 가 만든 응답이 통째로 폐기되고
    //   라우트가 500 으로 끝난다. 정리 실패는 로그만 남기고 원래 결과를 돌려준다.
    try {
      if (lock.needsFinalize) {
        const status: RunStatus = resolveFinalStatus({
          preflightAborted,
          paidCountUnknown,
          usersOverFetchLimit,
          queryDeadlineReached,
          queryDrainTimedOut,
          matchAborted,
          insertAborted,
          insertErrorCount,
          usersDroppedPartialFailure,
          usersOverQueryBudget,
          threw,
        });
        const timeoutMs = clampTimeout(now(), finalizeDeadlineAt, LOCK_FINALIZE_TIMEOUT_MS, 1);
        if (timeoutMs === null) {
          log.error('[geo-tracking] 마무리 마감 초과 — 잠금을 정리하지 못했습니다(10분 뒤 stale 인계 대상).');
        } else {
          const { error: finErr } = await gateway.finalizeLock(
            { weekStart, status, users: savedUsers, inserted, httpAttempts, note: finalizeNote },
            timeoutMs,
          );
          if (finErr) log.error(`[geo-tracking] 실행 잠금 마무리 실패: ${finErr.message ?? ''}`);
        }
      }
    } catch (finalizeError) {
      const message = finalizeError instanceof Error ? finalizeError.message : String(finalizeError);
      log.error(`[geo-tracking] 실행 잠금 마무리 중 예외(무시하고 결과 반환): ${message}`);
    }
  }
}

/** 준비 단계 중단 응답 (잠금 정리는 finally 가 담당) */
function abortedResult(weekStart: string, lock: RunLockDecision, message: string): RunGeoTrackingResult {
  return {
    status: 500,
    body: { ok: false, mode: 'aborted', weekStart, lock: lock.mode, error: message },
  };
}

/** 청크 안에 들어 있는 회원 수 (회원 경계가 보존돼 있으므로 user_id 종류 수와 같다) */
function countGroupsIn(rows: readonly GeoCitationInsertRow[]): number {
  const ids = new Set<string>();
  for (const row of rows) ids.add(row.user_id);
  return ids.size;
}
