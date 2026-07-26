import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GEMINI_FREE_MONTHLY_SEARCH_QUERIES,
  GEO_RUNS_PER_MONTH,
  MAX_API_CALLS_PER_RUN,
  MAX_CALLS_PER_ENGINE,
  MAX_HTTP_ATTEMPTS_PER_RUN,
  PREFLIGHT_DEADLINE_MS,
  PREFLIGHT_OP_TIMEOUT_MS,
  QUERY_DEADLINE_MS,
  QUERY_DRAIN_ALLOWANCE_MS,
  MATCH_DEADLINE_MS,
  SAVE_DEADLINE_MS,
  INSERT_CHUNK_TIMEOUT_MS,
  MIN_INSERT_WINDOW_MS,
  FINALIZE_DEADLINE_MS,
  LOCK_FINALIZE_TIMEOUT_MS,
  RESPONSE_ALLOWANCE_MS,
  PLATFORM_MAX_DURATION_MS,
  clampTimeout,
  worstCaseRuntimeMs,
  capQuestionPlan,
  geminiPerRunSearchBudget,
  maxUniqueQuestionsFor,
} from '../geo-engines/budget.ts';
import {
  PG_UNDEFINED_TABLE,
  PG_UNIQUE_VIOLATION,
  STALE_LOCK_MS,
  interpretLockInsert,
  resolveFinalStatus,
  staleThresholdIso,
} from '../geo-engines/run-lock.ts';

// ---------------------------------------------------------------------------
// Gemini 무료 할당량 방어선
// ---------------------------------------------------------------------------

test('Gemini 실행당 예산 = floor(월 무료 5,000 × 0.8 ÷ 월 5회) = 800', () => {
  assert.equal(GEMINI_FREE_MONTHLY_SEARCH_QUERIES, 5_000);
  assert.equal(GEO_RUNS_PER_MONTH, 5);
  assert.equal(geminiPerRunSearchBudget(), 800);
});

test('Gemini 예산: 월 5회 실행 × 실행당 예산이 무료 한도를 넘지 않는다', () => {
  assert.ok(geminiPerRunSearchBudget() * GEO_RUNS_PER_MONTH <= GEMINI_FREE_MONTHLY_SEARCH_QUERIES);
});

test('Gemini 예산: 무료 등급(500 RPD 모델)으로 내려도 계산이 성립', () => {
  // gemini-2.5-flash-lite 무료 등급을 쓸 경우 하루 500 · 주 1회 → 월 한도를 500×4로 잡는 시나리오
  assert.equal(geminiPerRunSearchBudget({ monthlyFreeQueries: 2_000, runsPerMonth: 5 }), 320);
});

test('Gemini 예산: 잘못된 입력에도 음수·0으로 나누지 않는다', () => {
  assert.equal(geminiPerRunSearchBudget({ monthlyFreeQueries: 0 }), 0);
  // runsPerMonth 0 은 1로 클램프 → 월 예산 전액이 한 번에 배정된다(0 나눗셈 방지)
  assert.equal(geminiPerRunSearchBudget({ runsPerMonth: 0 }), 4_000);
  assert.equal(geminiPerRunSearchBudget({ safetyRatio: 0 }), 0);
});

// ---------------------------------------------------------------------------
// 고유 질의문 상한
// ---------------------------------------------------------------------------

test('고유 질의 상한: 엔진 수에 따라 재산정', () => {
  assert.equal(MAX_API_CALLS_PER_RUN, 240);
  assert.equal(MAX_CALLS_PER_ENGINE, 120);
  assert.equal(maxUniqueQuestionsFor(1), 120); // min(120, 240) — OpenAI 단독
  assert.equal(maxUniqueQuestionsFor(2), 120); // min(120, 120) — 운영 기본 2엔진
  assert.equal(maxUniqueQuestionsFor(3), 80); // min(120, 80) — Gemini 옵트인 시
  assert.equal(maxUniqueQuestionsFor(0), 0);
});

test('HTTP 시도 상한: 논리 호출 상한 + 재시도 여유 20%', () => {
  assert.equal(MAX_HTTP_ATTEMPTS_PER_RUN, 288);
  assert.equal(MAX_HTTP_ATTEMPTS_PER_RUN, Math.round(MAX_API_CALLS_PER_RUN * 1.2));
  // 상한이 논리 호출보다 커야 재시도가 완전히 봉쇄되지 않는다
  assert.ok(MAX_HTTP_ATTEMPTS_PER_RUN > MAX_API_CALLS_PER_RUN);
});

// ---------------------------------------------------------------------------
// 최악 실행 시간이 플랫폼 한도(300초) 안에 들어온다는 것을 고정한다
// ---------------------------------------------------------------------------

test('★구간 마감이 순서대로 배치되고 최악 실행 시간이 300초 미만이다', () => {
  // 구간 상한 (budget.ts "실행 시간 예산" 블록과 1:1 대응)
  assert.equal(PREFLIGHT_DEADLINE_MS, 20_000);
  assert.equal(QUERY_DEADLINE_MS, 200_000);
  assert.equal(QUERY_DRAIN_ALLOWANCE_MS, 5_000);
  assert.equal(MATCH_DEADLINE_MS, 210_000);
  assert.equal(SAVE_DEADLINE_MS, 285_000);
  assert.equal(FINALIZE_DEADLINE_MS, 288_000);
  assert.equal(RESPONSE_ALLOWANCE_MS, 2_000);

  // 마감은 반드시 이 순서여야 한다 — 어긋나면 앞 구간이 뒤 구간을 잡아먹는다
  assert.ok(PREFLIGHT_DEADLINE_MS < QUERY_DEADLINE_MS);
  assert.ok(QUERY_DEADLINE_MS + QUERY_DRAIN_ALLOWANCE_MS <= MATCH_DEADLINE_MS);
  assert.ok(MATCH_DEADLINE_MS < SAVE_DEADLINE_MS);
  assert.ok(SAVE_DEADLINE_MS + LOCK_FINALIZE_TIMEOUT_MS <= FINALIZE_DEADLINE_MS);

  const worst = worstCaseRuntimeMs(); // 288 + 2 = 290s
  assert.equal(worst, 290_000);
  assert.ok(worst < PLATFORM_MAX_DURATION_MS, `worst=${worst} >= limit=${PLATFORM_MAX_DURATION_MS}`);
  // 최소 10초 여유를 남긴다 (플랫폼 콜드스타트·네트워크 편차 흡수)
  assert.ok(PLATFORM_MAX_DURATION_MS - worst >= 10_000);
});

test('clampTimeout: 남은 시간으로 좁히고, 부족하면 null 로 작업을 막는다', () => {
  // 여유가 충분하면 최대치 그대로
  assert.equal(clampTimeout(0, 100_000, 10_000, 1_000), 10_000);
  // 남은 시간이 더 짧으면 그쪽으로 좁힌다 → 마감을 절대 넘지 않는다
  assert.equal(clampTimeout(95_000, 100_000, 10_000, 1_000), 5_000);
  // 최소 창보다 적게 남으면 시작하지 않는다
  assert.equal(clampTimeout(99_900, 100_000, 10_000, 1_000), null);
  // 마감이 이미 지났으면 당연히 null
  assert.equal(clampTimeout(101_000, 100_000, 10_000, 1_000), null);
});

test('저장 구간: 마지막 청크가 저장 마감을 넘지 못한다', () => {
  assert.equal(INSERT_CHUNK_TIMEOUT_MS, 10_000);
  assert.equal(MIN_INSERT_WINDOW_MS, 1_000);
  const latestStart = SAVE_DEADLINE_MS - MIN_INSERT_WINDOW_MS; // 284s
  const timeout = clampTimeout(latestStart, SAVE_DEADLINE_MS, INSERT_CHUNK_TIMEOUT_MS, MIN_INSERT_WINDOW_MS);
  assert.equal(timeout, MIN_INSERT_WINDOW_MS);
  assert.ok(latestStart + (timeout ?? 0) <= SAVE_DEADLINE_MS);
});

test('준비 구간: 마감과 1건 타임아웃이 어긋나지 않는다', () => {
  assert.equal(PREFLIGHT_OP_TIMEOUT_MS, 5_000);
  // 준비 작업은 잠금·인계·count·목록·중복확인 최대 5회 → 5 × 5초 = 25초.
  // 마감 20초가 먼저 걸리므로 어떤 조합에서도 20초를 넘지 않는다.
  assert.ok(PREFLIGHT_OP_TIMEOUT_MS < PREFLIGHT_DEADLINE_MS);
  // 마감 직전에 시작한 작업도 마감을 넘지 못한다
  const timeout = clampTimeout(PREFLIGHT_DEADLINE_MS - 600, PREFLIGHT_DEADLINE_MS, PREFLIGHT_OP_TIMEOUT_MS, 500);
  assert.equal(timeout, 600);
});

// ---------------------------------------------------------------------------
// 회원 단위 절단 — 구 MAX_TOTAL_QUERIES=200 침묵 누락 버그의 대체
// ---------------------------------------------------------------------------

function plan(userId: string, questions: string[]) {
  return { userId, questions };
}

test('절단: 상한 안이면 전원 유지', () => {
  const result = capQuestionPlan([plan('a', ['q1', 'q2']), plan('b', ['q3'])], 10);
  assert.equal(result.kept.length, 2);
  assert.equal(result.truncatedUsers, 0);
  assert.equal(result.droppedQuestions, 0);
  assert.deepEqual(result.uniqueQuestions.sort(), ['q1', 'q2', 'q3']);
});

test('절단: 상한 초과 회원 수와 질문 수를 명시한다 (침묵 실패 금지)', () => {
  const result = capQuestionPlan(
    [plan('a', ['a1', 'a2']), plan('b', ['b1', 'b2']), plan('c', ['c1', 'c2'])],
    4,
  );
  assert.deepEqual(result.kept.map((p) => p.userId), ['a', 'b']);
  assert.equal(result.truncatedUsers, 1);
  assert.equal(result.droppedQuestions, 2);
});

test('절단: 회원은 전부 아니면 전무 — 일부 질문만 잘리지 않는다', () => {
  const result = capQuestionPlan([plan('a', ['a1', 'a2', 'a3']), plan('b', ['b1', 'b2', 'b3'])], 4);
  assert.deepEqual(result.kept.map((p) => p.userId), ['a']);
  assert.equal(result.kept[0].questions.length, 3);
  assert.equal(result.truncatedUsers, 1);
});

test('절단: 중복 질의는 예산을 추가로 쓰지 않는다 (캐시 이득 반영)', () => {
  // 같은 지역·진료과 회원 3명이 공통 질문 1개 + 개인 질문 1개씩
  const shared = '대구 수성구 피부과 추천해줘';
  const result = capQuestionPlan(
    [plan('a', [shared, 'a1']), plan('b', [shared, 'b1']), plan('c', [shared, 'c1'])],
    4,
  );
  // 고유 질의는 shared + a1 + b1 + c1 = 4개 → 상한 4 안에 3명 전원 통과
  assert.equal(result.kept.length, 3);
  assert.equal(result.uniqueQuestions.length, 4);
  assert.equal(result.truncatedUsers, 0);
});

test('절단: 상한 0 이면 전원 제외되고 그 수가 보고된다', () => {
  const result = capQuestionPlan([plan('a', ['q1']), plan('b', ['q2'])], 0);
  assert.equal(result.kept.length, 0);
  assert.equal(result.truncatedUsers, 2);
  assert.equal(result.droppedQuestions, 2);
});

// ---------------------------------------------------------------------------
// [Codex 2차-3] cron 동시 실행 차단 — 외부 API 비용이 나가기 전에 막아야 한다
// ---------------------------------------------------------------------------

test('★잠금: insert 성공 = 이번 실행이 주차를 선점 (진행)', () => {
  const decision = interpretLockInsert(null);
  assert.equal(decision.mode, 'acquired');
  assert.equal(decision.proceed, true);
});

test('★잠금: 고유키 충돌 = 다른 실행이 선점 → 진행 금지 (비용 발생 전에 차단)', () => {
  const decision = interpretLockInsert({ code: PG_UNIQUE_VIOLATION, message: 'duplicate key' });
  assert.equal(decision.mode, 'locked');
  assert.equal(decision.proceed, false);
  assert.match(decision.reason ?? '', /중복 실행 차단/);
});

test('★잠금: 동시 실행 시 두 번째 인스턴스가 차단된다', () => {
  // 원자적 insert 는 정확히 하나만 성공한다 — 그 결과를 해석하는 계약을 고정
  const first = interpretLockInsert(null);
  const second = interpretLockInsert({ code: PG_UNIQUE_VIOLATION, message: 'duplicate key' });
  assert.equal(first.proceed, true);
  assert.equal(second.proceed, false);
  assert.notEqual(first.mode, second.mode);
});

test('★잠금: stale 인계에 성공하면 진행한다', () => {
  const decision = interpretLockInsert({ code: PG_UNIQUE_VIOLATION }, true);
  assert.equal(decision.mode, 'acquired');
  assert.equal(decision.proceed, true);
  assert.match(decision.reason ?? '', /인계/);
});

test('★잠금: 테이블 미적용(42P01)은 잠금 없이 진행하되 사실을 명시', () => {
  const decision = interpretLockInsert({ code: PG_UNDEFINED_TABLE, message: 'relation does not exist' });
  assert.equal(decision.mode, 'unavailable');
  assert.equal(decision.proceed, true);
  assert.match(decision.reason ?? '', /048/);
  assert.match(decision.reason ?? '', /차단되지 않습니다/);
});

test('★잠금: 상태를 알 수 없으면 진행하지 않는다 (폴백 진행 = 이중 과금)', () => {
  const decision = interpretLockInsert({ code: '08006', message: 'connection failure' });
  assert.equal(decision.mode, 'error');
  assert.equal(decision.proceed, false);
  assert.match(decision.reason ?? '', /이중 과금 방지/);
});

test('★마감 상태: 완전 성공에만 done — 나머지는 전부 failed(재실행 허용)', () => {
  const clean = {
    preflightAborted: false,
    queryDeadlineReached: false,
    matchAborted: false,
    insertAborted: false,
    insertErrorCount: 0,
    usersDroppedPartialFailure: 0,
    usersOverQueryBudget: 0,
    threw: false,
  };
  assert.equal(resolveFinalStatus(clean), 'done');

  // 하나라도 어긋나면 done 이 아니다 — done 은 그 주를 영구히 잠근다
  const breakers: Array<Partial<typeof clean>> = [
    { preflightAborted: true },
    { queryDeadlineReached: true },
    { matchAborted: true },
    { insertAborted: true },
    { insertErrorCount: 1 },
    { usersDroppedPartialFailure: 1 },
    { usersOverQueryBudget: 1 },
    { threw: true },
  ];
  for (const breaker of breakers) {
    assert.equal(
      resolveFinalStatus({ ...clean, ...breaker }),
      'failed',
      `${JSON.stringify(breaker)} 인데 done 으로 마감됐다`,
    );
  }
});

test('잠금: locked/unavailable 은 정리할 잠금이 없다(needsFinalize=false)', () => {
  assert.equal(interpretLockInsert({ code: PG_UNIQUE_VIOLATION }).needsFinalize, false);
  assert.equal(interpretLockInsert({ code: PG_UNDEFINED_TABLE }).needsFinalize, false);
  assert.equal(interpretLockInsert({ code: '08006' }).needsFinalize, false);
  // 선점했거나 인계받았으면 반드시 정리해야 한다
  assert.equal(interpretLockInsert(null).needsFinalize, true);
  assert.equal(interpretLockInsert({ code: PG_UNIQUE_VIOLATION }, true).needsFinalize, true);
});

test('잠금: stale 기준은 함수 최대 실행시간(300초)보다 충분히 길다', () => {
  assert.equal(STALE_LOCK_MS, 600_000);
  assert.ok(STALE_LOCK_MS > PLATFORM_MAX_DURATION_MS);
  const iso = staleThresholdIso(1_000_000_000_000);
  assert.equal(iso, new Date(1_000_000_000_000 - STALE_LOCK_MS).toISOString());
});

test('절단: 구 버그 재현 방지 — 100명×5질의를 2엔진 상한(120 고유질의)에 넣으면 잘린 수가 드러난다', () => {
  const plans = Array.from({ length: 100 }, (_, i) =>
    plan(`u${i}`, [`u${i}-q1`, `u${i}-q2`, `u${i}-q3`, `u${i}-q4`, `u${i}-q5`]),
  );
  const result = capQuestionPlan(plans, maxUniqueQuestionsFor(2));
  assert.equal(result.kept.length, 24); // 120 고유질의 ÷ 5 = 24명
  assert.equal(result.truncatedUsers, 76);
  assert.equal(result.droppedQuestions, 380);
  // 구 코드처럼 조용히 사라지지 않고 수가 드러나야 한다
  assert.ok(result.truncatedUsers > 0);
});
