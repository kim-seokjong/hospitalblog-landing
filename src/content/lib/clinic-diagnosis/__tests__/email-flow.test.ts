import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runDiagnosisEmailFlow,
  type CountLeadsResult,
  type EmailFlowDeps,
  type LeadRow,
  type ReportLoad,
  type SaveLeadResult,
  type SendOutcome,
} from '../email-flow.ts';
import type { EmailLeadLimits } from '../email-lead.ts';
import type { DiagnosisLeadSummary } from '../conversion.ts';

/**
 * 진단 메일 발송 순서 — **취약점별 회귀 테스트**.
 *
 * 여기서 지키는 것은 전부 실제로 터졌던(또는 터질 수 있던) 것들이다:
 *  · 리드 저장 실패를 200 으로 응답 → 메일은 나가고 연락처는 유실 (이미지 546장 패턴)
 *  · 캡 테이블이 없는데 메일이 나감 → 세지 못하는 상태로 외부 발송
 *  · 만료 토큰 요청이 캡을 소비 → 정상 원장이 하루 횟수를 잃음
 *  · 퍼널이 실패를 성공으로 셈 → "확보율 100%, 리드 0건"
 */

const TOKEN = 'a'.repeat(64);
const EMAIL = 'doctor@example.com';

const LIMITS: EmailLeadLimits = {
  ipDaily: 5,
  addressDaily: 3,
  globalDaily: 200,
  tokenDaily: 3,
  tokenAddresses: 2,
};

const SUMMARY: DiagnosisLeadSummary = {
  badCount: 3,
  improveCount: 2,
  goodCount: 4,
  unknownCount: 1,
  badScopeCount: 2,
  improveScopeCount: 0,
  ourScopeCount: 2,
  topIssues: ['최근 발행'],
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

const REPORT = {
  runAt: '2026-07-27T00:00:00.000Z',
  clinic: {
    mngNo: 'M1',
    name: '테스트의원',
    province: '대구광역시',
    region: '수성구',
    specialty: '피부과',
    phone: '053-000-0000',
  },
};

const ZERO_COUNTS = {
  globalToday: 0,
  ipToday: 0,
  addressToday: 0,
  tokenToday: 0,
  tokenOtherAddresses: 0,
};

interface Recorder {
  readonly deps: EmailFlowDeps;
  readonly calls: {
    countLeads: number;
    saveLead: number;
    sendEmail: number;
    markSendResult: number;
    recordFunnel: number;
  };
  readonly saved: LeadRow[];
  readonly funnel: boolean[];
  readonly marks: { id: string; sent: boolean; error: string | null }[];
}

function makeDeps(overrides: {
  report?: ReportLoad;
  counts?: CountLeadsResult;
  save?: SaveLeadResult;
  send?: SendOutcome;
  summarize?: (report: unknown) => DiagnosisLeadSummary | null;
} = {}): Recorder {
  const calls = { countLeads: 0, saveLead: 0, sendEmail: 0, markSendResult: 0, recordFunnel: 0 };
  const saved: LeadRow[] = [];
  const funnel: boolean[] = [];
  const marks: { id: string; sent: boolean; error: string | null }[] = [];

  const deps: EmailFlowDeps = {
    loadReport: async () =>
      overrides.report ?? { kind: 'ok', results: REPORT, expiresAt: '2026-08-30T00:00:00.000Z' },
    countLeads: async () => {
      calls.countLeads += 1;
      return overrides.counts ?? { kind: 'ok', counts: ZERO_COUNTS };
    },
    saveLead: async (row) => {
      calls.saveLead += 1;
      saved.push(row);
      return overrides.save ?? { kind: 'ok', id: 'lead-1' };
    },
    sendEmail: async () => {
      calls.sendEmail += 1;
      return overrides.send ?? { success: true };
    },
    markSendResult: async (id, sent, error) => {
      calls.markSendResult += 1;
      marks.push({ id, sent, error });
    },
    recordFunnel: async ({ sent }) => {
      calls.recordFunnel += 1;
      funnel.push(sent);
    },
    summarize: overrides.summarize ?? (() => SUMMARY),
    reportUrl: (token) => `https://www.hospitalblog.kr/clinic-check/r/${token}`,
    now: () => Date.parse('2026-07-27T05:00:00+09:00'),
  };

  return { deps, calls, saved, funnel, marks };
}

const INPUT = { rawToken: TOKEN, rawEmail: EMAIL, ipHash: 'iphash', limits: LIMITS };

/* ── [치명] 저장 실패를 성공으로 응답하지 않는다 ─────────── */

test('저장에 실패하면 메일을 보내지 않고 500 을 낸다', async () => {
  const r = makeDeps({ save: { kind: 'failed', message: 'relation does not exist' } });
  const result = await runDiagnosisEmailFlow(r.deps, INPUT);

  assert.equal(result.status, 500);
  assert.ok('error' in result.body);
  assert.equal(r.calls.sendEmail, 0, '저장 실패 시 메일이 나가면 안 된다(되돌릴 수 없다)');
  assert.equal(r.calls.recordFunnel, 0, '저장 실패는 퍼널에 세지 않는다');
});

test('저장 실패는 어떤 경우에도 200 이 아니다 (발송 성공 여부와 무관)', async () => {
  for (const send of [{ success: true }, { success: false, error: 'RESEND_API_KEY 미설정' }]) {
    const r = makeDeps({ save: { kind: 'failed', message: 'boom' }, send });
    const result = await runDiagnosisEmailFlow(r.deps, INPUT);
    assert.notEqual(result.status, 200);
  }
});

test('저장이 성공해야 발송한다 — 순서는 저장 → 발송', async () => {
  const order: string[] = [];
  const r = makeDeps();
  const deps: EmailFlowDeps = {
    ...r.deps,
    saveLead: async (row) => {
      order.push('save');
      return r.deps.saveLead(row);
    },
    sendEmail: async (m) => {
      order.push('send');
      return r.deps.sendEmail(m);
    },
  };
  const result = await runDiagnosisEmailFlow(deps, INPUT);
  assert.equal(result.status, 200);
  assert.deepEqual(order, ['save', 'send']);
});

/* ── [높음] 셀 수 없으면 발송하지 않는다 ─────────────────── */

test('리드 테이블이 없으면(마이그 미적용) 발송을 막는다', async () => {
  const r = makeDeps({ counts: { kind: 'blocked', reason: 'missing_table' } });
  const result = await runDiagnosisEmailFlow(r.deps, INPUT);

  assert.equal(result.status, 503);
  assert.equal(r.calls.saveLead, 0);
  assert.equal(r.calls.sendEmail, 0, '세지 못하는 상태에서 메일을 내보내는 게 제일 위험하다');
  assert.equal(r.calls.recordFunnel, 0);
});

test('캡 집계 조회가 실패해도 발송을 막는다', async () => {
  const r = makeDeps({ counts: { kind: 'blocked', reason: 'error' } });
  const result = await runDiagnosisEmailFlow(r.deps, INPUT);
  assert.equal(result.status, 503);
  assert.equal(r.calls.sendEmail, 0);
});

test('캡을 넘으면 429 이고 메일은 나가지 않는다', async () => {
  const r = makeDeps({
    counts: { kind: 'ok', counts: { ...ZERO_COUNTS, tokenOtherAddresses: 2 } },
  });
  const result = await runDiagnosisEmailFlow(r.deps, INPUT);
  assert.equal(result.status, 429);
  assert.equal(r.calls.saveLead, 0);
  assert.equal(r.calls.sendEmail, 0);
});

/* ── [보통] 만료·없는 토큰이 캡을 소비하지 않는다 ────────── */

test('만료된 토큰은 410 이고 캡 집계에 닿지 않는다', async () => {
  const r = makeDeps({
    report: { kind: 'ok', results: REPORT, expiresAt: '2026-07-01T00:00:00.000Z' },
  });
  const result = await runDiagnosisEmailFlow(r.deps, INPUT);

  assert.equal(result.status, 410);
  assert.equal(r.calls.countLeads, 0, '만료 요청이 캡을 소비하면 정상 원장이 횟수를 잃는다');
  assert.equal(r.calls.saveLead, 0);
  assert.equal(r.calls.sendEmail, 0);
});

test('없는 토큰은 404 이고 캡을 소비하지 않는다', async () => {
  const r = makeDeps({ report: { kind: 'not_found' } });
  const result = await runDiagnosisEmailFlow(r.deps, INPUT);
  assert.equal(result.status, 404);
  assert.equal(r.calls.countLeads, 0);
});

test('형식이 틀린 토큰·주소는 DB 를 건드리지 않고 400 이다', async () => {
  const r1 = makeDeps();
  const bad1 = await runDiagnosisEmailFlow(r1.deps, { ...INPUT, rawToken: 'nope' });
  assert.equal(bad1.status, 400);
  assert.equal(r1.calls.countLeads, 0);

  const r2 = makeDeps();
  const bad2 = await runDiagnosisEmailFlow(r2.deps, { ...INPUT, rawEmail: 'not-an-email' });
  assert.equal(bad2.status, 400);
  assert.equal(r2.calls.countLeads, 0);
  assert.equal(r2.calls.saveLead, 0);
});

/* ── [보통] 퍼널은 실패를 세지 않는다 ────────────────────── */

test('퍼널은 저장에 성공한 건만, 실제 발송 여부와 함께 기록한다', async () => {
  const ok = makeDeps();
  await runDiagnosisEmailFlow(ok.deps, INPUT);
  assert.deepEqual(ok.funnel, [true]);

  // 저장은 됐지만 발송 인프라가 없는 경우 — 리드는 남았으므로 기록하되 sent:false.
  const queued = makeDeps({ send: { success: false, error: 'RESEND_API_KEY 미설정' } });
  const result = await runDiagnosisEmailFlow(queued.deps, INPUT);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, sent: false });
  assert.deepEqual(queued.funnel, [false]);
  assert.deepEqual(queued.marks, [{ id: 'lead-1', sent: false, error: 'RESEND_API_KEY 미설정' }]);
});

/* ── [낮음] 옛 리포트 결측 방어 ──────────────────────────── */

test('clinic 필드가 없는 옛 리포트도 발송 전에 안전하게 처리된다', async () => {
  const r = makeDeps({ report: { kind: 'ok', results: { runAt: 'not-a-date' }, expiresAt: null } });
  const result = await runDiagnosisEmailFlow(r.deps, INPUT);

  assert.equal(result.status, 200);
  assert.equal(r.saved.length, 1);
  assert.equal(r.saved[0].mngNo, '');
  assert.equal(r.saved[0].clinicName, '');
  assert.equal(r.saved[0].diagnosedAt, null, '깨진 진단 시각은 null 로 저장한다');
});

test('요약 생성이 터져도 메일은 링크만 담아 나가고 리드는 남는다', async () => {
  const r = makeDeps({
    summarize: () => {
      throw new TypeError("Cannot read properties of undefined (reading 'findings')");
    },
  });
  const result = await runDiagnosisEmailFlow(r.deps, INPUT);

  assert.equal(result.status, 200);
  assert.equal(r.calls.sendEmail, 1);
  assert.equal(r.saved[0].summary, null);
});

test('저장한 리드에는 정규화된 주소와 IP 해시만 들어간다(원본 IP 없음)', async () => {
  const r = makeDeps();
  await runDiagnosisEmailFlow(r.deps, { ...INPUT, rawEmail: '  Doctor@Example.COM ' });
  assert.equal(r.saved[0].email, 'doctor@example.com');
  assert.equal(r.saved[0].ipHash, 'iphash');
  assert.equal(r.saved[0].shareUrl, `/clinic-check/r/${TOKEN}`);
});
