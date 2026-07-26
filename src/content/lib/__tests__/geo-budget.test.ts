import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GEMINI_FREE_MONTHLY_SEARCH_QUERIES,
  GEO_RUNS_PER_MONTH,
  MAX_API_CALLS_PER_RUN,
  MAX_CALLS_PER_ENGINE,
  MAX_HTTP_ATTEMPTS_PER_RUN,
  QUERY_DEADLINE_MS,
  SAVE_RESERVE_MS,
  capQuestionPlan,
  geminiPerRunSearchBudget,
  maxUniqueQuestionsFor,
} from '../geo-engines/budget.ts';

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

test('데드라인·저장 몫 합계가 플랫폼 제한(300초)을 넘지 않는다', () => {
  assert.equal(QUERY_DEADLINE_MS, 240_000);
  assert.equal(SAVE_RESERVE_MS, 60_000);
  assert.ok(QUERY_DEADLINE_MS + SAVE_RESERVE_MS <= 300_000);
  // 저장 몫이 0이면 수집분이 DB 도달 전에 함수가 죽는다
  assert.ok(SAVE_RESERVE_MS > 0);
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
