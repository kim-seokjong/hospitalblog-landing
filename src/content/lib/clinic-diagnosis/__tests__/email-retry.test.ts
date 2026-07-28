import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRetrySummaryText,
  isPermanentSendError,
  MAX_RETRIES_PER_RUN,
  planEmailRetries,
  RETRY_WINDOW_DAYS,
  type RetryCandidate,
} from '../email-retry.ts';

/**
 * 회귀 고정 — 2026-07-28.
 *
 * 배경: 진단 메일 발송이 실패하면 리드가 sent=false 로 남고 **아무도 다시 보내지
 * 않았다.** 7/27 Resend 도메인 미검증으로 2건이 실패했고, 도메인 복구 뒤에도
 * 그대로 방치됐다. 전화 아웃바운드의 목표가 이메일 주소 확보인데 그 주소로
 * 리포트가 안 나가면 리드가 죽는다.
 *
 * 여기서 지키는 것:
 *   ① 일시 장애로 실패한 리드는 반드시 다시 보낸다 (리드 유실 방지)
 *   ② 영구 실패(잘못된 주소·차단)는 매일 두드리지 않는다 (발신 평판 보호)
 *   ③ 기간 창을 벗어나면 멈춘다 (재시도 상태 컬럼 없이 무한 재시도를 막는 장치)
 */

const NOW = Date.parse('2026-07-28T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

/**
 * ⚠️ 기본값을 `??` 로 채우면 **명시적으로 넘긴 null 이 기본값으로 되돌아간다**
 *    (null 도 nullish 이므로). shareToken:null 을 검증하려던 테스트가 그래서
 *    조용히 통과할 뻔했다. 스프레드로 덮어써야 의도한 값이 남는다.
 */
const candidate = (over: Partial<RetryCandidate> = {}): RetryCandidate => ({
  id: 'id-1',
  email: 'doctor@example.com',
  clinicName: '미소치과의원',
  shareToken: 'a'.repeat(40),
  summary: { badCount: 1, goodCount: 5 },
  diagnosedAt: daysAgo(1),
  sendError: 'The hospitalblog.kr domain is not verified.',
  createdAt: daysAgo(1),
  ...over,
});

/* ── ① 일시 장애는 다시 보낸다 ── */

test('도메인 미검증으로 실패한 리드는 재발송 대상이다 — 이번 사고의 원인 유형', () => {
  const plan = planEmailRetries([candidate()], NOW);
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.skipped.length, 0);
});

test('사유를 모르는 실패도 재발송한다 — 애매하면 보내는 쪽이 안전하다', () => {
  const plan = planEmailRetries([candidate({ sendError: '알 수 없는 오류' })], NOW);
  assert.equal(plan.targets.length, 1);
});

test('사유가 비어 있어도 재발송 대상이다', () => {
  const plan = planEmailRetries([candidate({ sendError: null })], NOW);
  assert.equal(plan.targets.length, 1);
});

/* ── ② 영구 실패는 두드리지 않는다 ── */

test('영구 실패 판정 — 주소 오류·차단·수신거부', () => {
  assert.equal(isPermanentSendError('Invalid `to` field'), true);
  assert.equal(isPermanentSendError('recipient is not a valid email'), true);
  assert.equal(isPermanentSendError('hard bounce recorded'), true);
  assert.equal(isPermanentSendError('address is on the suppression list'), true);
  assert.equal(isPermanentSendError('blocked by recipient server'), true);
  assert.equal(isPermanentSendError('user unsubscribed'), true);
});

test('일시 장애는 영구 실패가 아니다', () => {
  assert.equal(isPermanentSendError('domain is not verified'), false);
  assert.equal(isPermanentSendError('rate limit exceeded'), false);
  assert.equal(isPermanentSendError('timeout'), false);
  assert.equal(isPermanentSendError(null), false);
  assert.equal(isPermanentSendError(''), false);
});

test('영구 실패 리드는 건너뛴다 — 매일 같은 주소를 두드리면 발신 평판이 깎인다', () => {
  const plan = planEmailRetries([candidate({ sendError: 'Invalid `to` field' })], NOW);
  assert.equal(plan.targets.length, 0);
  assert.deepEqual(plan.skipped, [{ id: 'id-1', reason: 'permanent_error' }]);
});

/* ── ③ 기간 창 ── */

test(`${RETRY_WINDOW_DAYS}일 창 안이면 재발송한다`, () => {
  const plan = planEmailRetries([candidate({ createdAt: daysAgo(RETRY_WINDOW_DAYS - 1) })], NOW);
  assert.equal(plan.targets.length, 1);
});

test('창을 벗어난 오래된 실패는 손대지 않는다 — 무한 재시도 방지 장치', () => {
  const plan = planEmailRetries([candidate({ createdAt: daysAgo(RETRY_WINDOW_DAYS + 1) })], NOW);
  assert.equal(plan.targets.length, 0);
  assert.deepEqual(plan.skipped, [{ id: 'id-1', reason: 'too_old' }]);
});

test('created_at 이 깨져 있으면 건너뛴다 — 파싱 실패를 최신으로 오해하지 않는다', () => {
  const plan = planEmailRetries([candidate({ createdAt: '알 수 없음' })], NOW);
  assert.equal(plan.targets.length, 0);
  assert.equal(plan.skipped[0]?.reason, 'too_old');
});

/* ── 결측 데이터 ── */

test('토큰이 없으면 건너뛴다 — 빈 링크를 보내느니 안 보낸다', () => {
  const plan = planEmailRetries([candidate({ shareToken: null })], NOW);
  assert.equal(plan.targets.length, 0);
  assert.equal(plan.skipped[0]?.reason, 'no_token');
});

test('이메일이 비었거나 형식이 아니면 건너뛴다', () => {
  const plan = planEmailRetries(
    [candidate({ id: 'a', email: '' }), candidate({ id: 'b', email: 'not-an-email' })],
    NOW,
  );
  assert.equal(plan.targets.length, 0);
  assert.deepEqual(
    plan.skipped.map((s) => s.reason),
    ['no_email', 'no_email'],
  );
});

/* ── 순서·상한 ── */

test('오래된 리드부터 보낸다 — 먼저 기다린 사람이 먼저 받는다', () => {
  const plan = planEmailRetries(
    [
      candidate({ id: 'new', createdAt: daysAgo(1) }),
      candidate({ id: 'old', createdAt: daysAgo(5) }),
      candidate({ id: 'mid', createdAt: daysAgo(3) }),
    ],
    NOW,
  );
  assert.deepEqual(
    plan.targets.map((t) => t.id),
    ['old', 'mid', 'new'],
  );
});

test('한 번의 실행 상한을 넘으면 나머지는 이월한다 — 폭주 방지', () => {
  const rows = Array.from({ length: MAX_RETRIES_PER_RUN + 5 }, (_, i) =>
    candidate({ id: `id-${i}`, createdAt: daysAgo(1) }),
  );
  const plan = planEmailRetries(rows, NOW);
  assert.equal(plan.targets.length, MAX_RETRIES_PER_RUN);
  assert.equal(plan.deferred, 5);
});

test('빈 입력은 아무것도 하지 않는다', () => {
  const plan = planEmailRetries([], NOW);
  assert.deepEqual(plan.targets, []);
  assert.equal(plan.deferred, 0);
});

/* ── 보고 문구 ── */

test('요약 문구에 다섯 수치가 모두 들어간다', () => {
  const text = buildRetrySummaryText({
    attempted: 3,
    succeeded: 2,
    failed: 1,
    skipped: 4,
    deferred: 5,
  });
  for (const n of ['3건', '2건', '1건', '4건', '5건']) {
    assert.ok(text.includes(n), `${n} 이 문구에 없다: ${text}`);
  }
});

test('요약 문구에 수신 주소가 실리지 않는다 — 알림 채널에 PII 금지', () => {
  const text = buildRetrySummaryText({
    attempted: 1,
    succeeded: 1,
    failed: 0,
    skipped: 0,
    deferred: 0,
  });
  assert.ok(!text.includes('@'), `주소가 노출됐다: ${text}`);
});

/* ── 2026-07-28 교차검증 반영: 처리량이 유입을 따라가야 한다 ── */

/**
 * 신규 발송의 전역 일일 한도는 200건이다(DEFAULT_EMAIL_GLOBAL_DAILY_LIMIT).
 * 재시도 처리량이 그보다 작으면 인프라 장애 뒤 backlog 가 기간 창 안에 소화되지
 * 못하고 만료된다 — 리드를 살리려는 장치가 리드를 버리게 된다.
 * (처음에 20으로 뒀다가 이 계산 때문에 되물렸다.)
 */
test('실행당 상한이 신규 유입 일일 한도(200) 이상이다 — backlog 가 창 안에 소화된다', () => {
  assert.ok(
    MAX_RETRIES_PER_RUN >= 200,
    `상한 ${MAX_RETRIES_PER_RUN} 은 유입(200/일)보다 작다 — 창 만료로 유실된다`,
  );
});

test('하루치 최대 유입(200건)이 한 번에 전부 대상이 된다', () => {
  const rows = Array.from({ length: 200 }, (_, i) =>
    candidate({ id: `id-${i}`, createdAt: daysAgo(1) }),
  );
  const plan = planEmailRetries(rows, NOW);
  assert.equal(plan.targets.length, 200);
  assert.equal(plan.deferred, 0);
});
