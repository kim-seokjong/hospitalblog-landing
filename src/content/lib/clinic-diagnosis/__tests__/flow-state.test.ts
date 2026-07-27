import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIAGNOSIS_FAILED_MESSAGE,
  INITIAL_DIAGNOSIS_FLOW_STATE,
  LOOKUP_FAILED_MESSAGE,
  NAME_TOO_SHORT_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  diagnosisFlowReducer,
  isFlowBusy,
  startDiagnosisFlow,
  startLookupFlow,
  type ClinicLookupResponse,
  type DiagnosisFlowAction,
  type DiagnosisFlowDeps,
  type DiagnosisFlowState,
  type DiagnosisResponse,
} from '../flow-state.ts';
import { EMPTY_SITE_AXIS } from '../site-audit.ts';
import { EMPTY_AI_AXIS } from '../ai-citation.ts';
import { EMPTY_COMPLIANCE_AXIS } from '../compliance-scan.ts';
import type { BlogAxis, ClinicCandidate, DiagnosisReport } from '../types.ts';

/**
 * 회귀 테스트 — 2026-07-27 운영 버그.
 * 진단이 끝나도 "병원 찾는 중…" 버튼이 비활성으로 굳고 스피너가 영원히 돌아
 * 새로고침 없이는 두 번째 진단을 돌릴 수 없었다. 원인은 조회와 진단이
 * 요청 카운터를 공유해 조회의 뒷정리 조건이 영원히 불일치했던 것.
 */

/* ── 픽스처 ──────────────────────────────────────────────── */

function clinic(over: Partial<ClinicCandidate> = {}): ClinicCandidate {
  return {
    mngNo: 'MNG-1',
    name: '테스트의원',
    roadAddress: '대구광역시 수성구 청호로 422',
    lotAddress: '',
    region: '수성구',
    province: '대구광역시',
    subjects: ['피부과'],
    specialty: '피부과',
    institutionType: '의원',
    phone: '053-000-0000',
    active: true,
    statusLabel: '영업/정상',
    openedOn: '2020-01-01',
    closedOn: '',
    ...over,
  };
}

const EMPTY_BLOG: BlogAxis = {
  checked: true,
  source: 'auto',
  resolution: { kind: 'none' },
  blogId: null,
  blogTitle: null,
  postCount: null,
  latestPostAt: null,
  daysSinceLatest: null,
  postsPerWeek: null,
  keywords: [],
  rankChecked: false,
  postSeo: null,
};

function report(over: Partial<DiagnosisReport> = {}): DiagnosisReport {
  return {
    version: 1,
    runAt: '2026-07-27T00:00:00.000Z',
    clinic: clinic(),
    blog: EMPTY_BLOG,
    site: EMPTY_SITE_AXIS,
    ai: EMPTY_AI_AXIS,
    compliance: EMPTY_COMPLIANCE_AXIS,
    findings: [],
    unchecked: [],
    ...over,
  };
}

/** 결과를 밖에서 원할 때 풀 수 있는 약속 — 늦게 온 응답을 재현한다. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 마이크로태스크를 몇 번 흘려보낸다 — 중간 단계 상태를 관찰하기 위해. */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

interface Harness {
  readonly deps: DiagnosisFlowDeps;
  readonly state: () => DiagnosisFlowState;
  readonly actions: readonly DiagnosisFlowAction[];
  readonly counts: { lookupStarted: number; reportShown: number };
}

function harness(handlers: {
  lookupClinic: DiagnosisFlowDeps['lookupClinic'];
  requestDiagnosis: DiagnosisFlowDeps['requestDiagnosis'];
}): Harness {
  let state = INITIAL_DIAGNOSIS_FLOW_STATE;
  let seq = 0;
  const actions: DiagnosisFlowAction[] = [];
  const counts = { lookupStarted: 0, reportShown: 0 };
  return {
    deps: {
      nextFlowId: () => ++seq,
      currentFlowId: () => seq,
      dispatch: (action) => {
        actions.push(action);
        state = diagnosisFlowReducer(state, action);
      },
      lookupClinic: handlers.lookupClinic,
      requestDiagnosis: handlers.requestDiagnosis,
      onLookupStarted: () => {
        counts.lookupStarted += 1;
      },
      onReportShown: () => {
        counts.reportShown += 1;
      },
    },
    state: () => state,
    actions,
    counts,
  };
}

const okLookup = (c: ClinicCandidate): (() => Promise<ClinicLookupResponse>) => async () => ({
  outcome: { kind: 'resolved', clinic: c },
});

const okDiagnosis = (r: DiagnosisReport): (() => Promise<DiagnosisResponse>) => async () => ({
  report: r,
  shareToken: 'tok-1',
});

/* ── ★ 핵심: 조회 → 자동 진단 후 로딩이 반드시 풀린다 ──── */

test('조회→자동진단이 끝나면 두 로딩이 모두 풀린다 (버튼이 굳지 않는다)', async () => {
  const h = harness({ lookupClinic: okLookup(clinic()), requestDiagnosis: okDiagnosis(report()) });

  await startLookupFlow(h.deps, { name: '테스트의원', region: '' });

  assert.equal(h.state().lookupLoading, false);
  assert.equal(h.state().busyMngNo, null);
  assert.equal(isFlowBusy(h.state()), false);
  assert.ok(h.state().report);
  assert.equal(h.state().shareToken, 'tok-1');
  assert.equal(h.state().error, null);
  assert.equal(h.counts.reportShown, 1);
});

test('조회와 자동진단은 같은 흐름 번호를 쓴다 (진단이 조회의 뒷정리를 무효화하지 않는다)', async () => {
  const h = harness({ lookupClinic: okLookup(clinic()), requestDiagnosis: okDiagnosis(report()) });

  await startLookupFlow(h.deps, { name: '테스트의원', region: '' });

  const flowIds = h.actions
    .map((a) => ('flowId' in a ? a.flowId : null))
    .filter((id): id is number => id !== null);
  assert.deepEqual([...new Set(flowIds)], [1]);
});

test('버튼 문구가 병원 찾는 중 → 진단 중 → 원래 문구 로 이어진다', async () => {
  const lookupGate = deferred<ClinicLookupResponse>();
  const diagGate = deferred<DiagnosisResponse>();
  const h = harness({
    lookupClinic: () => lookupGate.promise,
    requestDiagnosis: () => diagGate.promise,
  });

  const done = startLookupFlow(h.deps, { name: '테스트의원', region: '' });

  // ① 병원 찾는 중
  assert.equal(h.state().lookupLoading, true);
  assert.equal(h.state().busyMngNo, null);

  lookupGate.resolve({ outcome: { kind: 'resolved', clinic: clinic() } });
  await flush();

  // ② 진단 중
  assert.equal(h.state().lookupLoading, false);
  assert.equal(h.state().busyMngNo, 'MNG-1');

  diagGate.resolve({ report: report(), shareToken: null });
  await done;

  // ③ 원래 문구
  assert.equal(isFlowBusy(h.state()), false);
});

/* ── 실패해도 로딩은 풀린다 ─────────────────────────────── */

test('진단이 네트워크 오류로 죽어도 로딩이 풀린다', async () => {
  const h = harness({
    lookupClinic: okLookup(clinic()),
    requestDiagnosis: async () => {
      throw new Error('boom');
    },
  });

  await startLookupFlow(h.deps, { name: '테스트의원', region: '' });

  assert.equal(isFlowBusy(h.state()), false);
  assert.equal(h.state().error, NETWORK_ERROR_MESSAGE);
  assert.equal(h.state().report, null);
  assert.equal(h.counts.reportShown, 0);
});

test('진단 API 가 실패 응답을 주어도 로딩이 풀린다', async () => {
  const h = harness({
    lookupClinic: okLookup(clinic()),
    requestDiagnosis: async () => ({ error: '' }),
  });

  await startLookupFlow(h.deps, { name: '테스트의원', region: '' });

  assert.equal(isFlowBusy(h.state()), false);
  assert.equal(h.state().error, DIAGNOSIS_FAILED_MESSAGE);
});

test('조회가 네트워크 오류로 죽어도 로딩이 풀린다', async () => {
  const h = harness({
    lookupClinic: async () => {
      throw new Error('boom');
    },
    requestDiagnosis: okDiagnosis(report()),
  });

  await startLookupFlow(h.deps, { name: '테스트의원', region: '' });

  assert.equal(isFlowBusy(h.state()), false);
  assert.equal(h.state().error, NETWORK_ERROR_MESSAGE);
});

test('조회가 outcome 을 주지 않아도 로딩이 풀린다', async () => {
  const h = harness({
    lookupClinic: async () => ({}),
    requestDiagnosis: okDiagnosis(report()),
  });

  await startLookupFlow(h.deps, { name: '테스트의원', region: '' });

  assert.equal(isFlowBusy(h.state()), false);
  assert.equal(h.state().error, LOOKUP_FAILED_MESSAGE);
});

test('이름이 2자 미만이면 흐름을 시작하지 않는다 (로딩도 켜지지 않는다)', async () => {
  const h = harness({ lookupClinic: okLookup(clinic()), requestDiagnosis: okDiagnosis(report()) });

  await startLookupFlow(h.deps, { name: ' 가 ', region: '' });

  assert.equal(h.state().error, NAME_TOO_SHORT_MESSAGE);
  assert.equal(isFlowBusy(h.state()), false);
  assert.equal(h.counts.lookupStarted, 0);
});

/* ── ★ 합격 기준: 연속 2회 실행 ─────────────────────────── */

test('연속으로 두 번 진단을 돌릴 수 있다', async () => {
  const reports = [report({ runAt: '1' }), report({ runAt: '2' })];
  let turn = 0;
  const h = harness({
    lookupClinic: okLookup(clinic()),
    requestDiagnosis: async () => ({ report: reports[turn++], shareToken: null }),
  });

  await startLookupFlow(h.deps, { name: '테스트의원', region: '' });
  assert.equal(isFlowBusy(h.state()), false);
  assert.equal(h.state().report?.runAt, '1');

  await startLookupFlow(h.deps, { name: '테스트의원', region: '' });
  assert.equal(isFlowBusy(h.state()), false);
  assert.equal(h.state().report?.runAt, '2');
  assert.equal(h.counts.reportShown, 2);
});

test('후보 선택 경로도 연속 실행 후 로딩이 풀린다', async () => {
  const h = harness({
    lookupClinic: async () => ({
      outcome: { kind: 'ambiguous', candidates: [clinic(), clinic({ mngNo: 'MNG-2' })], truncated: false },
    }),
    requestDiagnosis: okDiagnosis(report()),
  });

  await startLookupFlow(h.deps, { name: '테스트의원', region: '' });
  assert.equal(isFlowBusy(h.state()), false);
  assert.equal(h.state().lookup?.kind, 'ambiguous');

  await startDiagnosisFlow(h.deps, clinic({ mngNo: 'MNG-2' }));
  assert.equal(isFlowBusy(h.state()), false);

  await startDiagnosisFlow(h.deps, clinic({ mngNo: 'MNG-2' }), { blogId: 'b', siteUrl: '', body: '' });
  assert.equal(isFlowBusy(h.state()), false);
});

test('상세 진단(직접 입력)이 실패해도 로딩이 풀린다', async () => {
  const h = harness({
    lookupClinic: okLookup(clinic()),
    requestDiagnosis: async () => {
      throw new Error('boom');
    },
  });

  await startDiagnosisFlow(h.deps, clinic(), { blogId: 'b', siteUrl: '', body: '' });

  assert.equal(isFlowBusy(h.state()), false);
  assert.equal(h.state().error, NETWORK_ERROR_MESSAGE);
});

/* ── 경합 가드: 늦게 온 응답이 최신 결과를 덮지 않는다 ─── */

test('늦게 도착한 조회 응답은 최신 흐름의 결과를 덮지 않는다', async () => {
  const slow = deferred<ClinicLookupResponse>();
  const fast = deferred<ClinicLookupResponse>();
  const gates = [slow, fast];
  let call = 0;
  const h = harness({
    lookupClinic: () => gates[call++].promise,
    requestDiagnosis: okDiagnosis(report()),
  });

  const first = startLookupFlow(h.deps, { name: '첫번째의원', region: '' });
  const second = startLookupFlow(h.deps, { name: '두번째의원', region: '' });

  fast.resolve({ outcome: { kind: 'not_found' } });
  await second;
  assert.equal(h.state().lookup?.kind, 'not_found');
  // 자동 탐색이 불가능하므로 상세 입력창이 열린다.
  assert.equal(h.state().showDetail, true);

  slow.resolve({ outcome: { kind: 'resolved', clinic: clinic() } });
  await first;

  // 늦게 온 1번 응답이 2번 결과를 덮지 않았다.
  assert.equal(h.state().lookup?.kind, 'not_found');
  assert.equal(h.state().report, null);
  // 그리고 늦은 흐름의 뒷정리가 최신 흐름의 로딩을 건드리지도 않았다.
  assert.equal(isFlowBusy(h.state()), false);
});

test('늦게 도착한 진단 응답은 최신 리포트를 덮지 않는다', async () => {
  const slow = deferred<DiagnosisResponse>();
  const fast = deferred<DiagnosisResponse>();
  const gates = [slow, fast];
  let call = 0;
  const h = harness({
    lookupClinic: okLookup(clinic()),
    requestDiagnosis: () => gates[call++].promise,
  });

  const first = startDiagnosisFlow(h.deps, clinic());
  const second = startDiagnosisFlow(h.deps, clinic({ mngNo: 'MNG-2' }));

  fast.resolve({ report: report({ runAt: 'new' }), shareToken: 'new-tok' });
  await second;
  assert.equal(h.state().report?.runAt, 'new');

  slow.resolve({ report: report({ runAt: 'old' }), shareToken: 'old-tok' });
  await first;

  assert.equal(h.state().report?.runAt, 'new');
  assert.equal(h.state().shareToken, 'new-tok');
  assert.equal(isFlowBusy(h.state()), false);
  // 늦은 흐름은 화면 부수효과(퍼널 기록·스크롤)도 내지 않는다.
  assert.equal(h.counts.reportShown, 1);
});

test('늦은 흐름의 실패 메시지가 최신 화면에 뜨지 않는다', async () => {
  const slow = deferred<DiagnosisResponse>();
  const fast = deferred<DiagnosisResponse>();
  const gates = [slow, fast];
  let call = 0;
  const h = harness({
    lookupClinic: okLookup(clinic()),
    requestDiagnosis: () => gates[call++].promise,
  });

  const first = startDiagnosisFlow(h.deps, clinic());
  const second = startDiagnosisFlow(h.deps, clinic({ mngNo: 'MNG-2' }));

  fast.resolve({ report: report(), shareToken: null });
  await second;

  slow.resolve({ error: '옛 진단 실패' });
  await first;

  assert.equal(h.state().error, null);
});

/* ── 상태기 단위 규칙 ───────────────────────────────────── */

test('시작 액션은 두 로딩 플래그를 모두 확정한다 (플래그가 굳지 않는다)', () => {
  const stuck: DiagnosisFlowState = {
    ...INITIAL_DIAGNOSIS_FLOW_STATE,
    flowId: 7,
    lookupLoading: true,
    busyMngNo: 'MNG-STALE',
  };

  const afterLookup = diagnosisFlowReducer(stuck, { type: 'lookup:start', flowId: 8 });
  assert.equal(afterLookup.lookupLoading, true);
  assert.equal(afterLookup.busyMngNo, null);

  const afterDiagnosis = diagnosisFlowReducer(stuck, { type: 'diagnosis:start', flowId: 8, mngNo: 'MNG-9' });
  assert.equal(afterDiagnosis.lookupLoading, false);
  assert.equal(afterDiagnosis.busyMngNo, 'MNG-9');
});

test('진단 시작은 직전 리포트를 지우지 않는다 (상세 입력창이 병원을 계속 안다)', () => {
  const withReport: DiagnosisFlowState = {
    ...INITIAL_DIAGNOSIS_FLOW_STATE,
    flowId: 1,
    report: report(),
    shareToken: 'tok',
  };
  const next = diagnosisFlowReducer(withReport, { type: 'diagnosis:start', flowId: 2, mngNo: 'MNG-1' });
  assert.ok(next.report);
  assert.equal(next.shareToken, null);
});

test('조회 시작은 직전 리포트를 지운다', () => {
  const withReport: DiagnosisFlowState = {
    ...INITIAL_DIAGNOSIS_FLOW_STATE,
    flowId: 1,
    report: report(),
    lookup: { kind: 'not_found' },
    error: '이전 오류',
  };
  const next = diagnosisFlowReducer(withReport, { type: 'lookup:start', flowId: 2 });
  assert.equal(next.report, null);
  assert.equal(next.lookup, null);
  assert.equal(next.error, null);
});

test('상세 입력창 열기는 흐름 번호와 무관하게 동작한다', () => {
  const next = diagnosisFlowReducer(
    { ...INITIAL_DIAGNOSIS_FLOW_STATE, flowId: 5 },
    { type: 'detail:open' },
  );
  assert.equal(next.showDetail, true);
});

test('행안부 키 미설정(unavailable)이면 상세 입력창을 바로 연다', async () => {
  const h = harness({
    lookupClinic: async () => ({ outcome: { kind: 'unavailable', reason: 'not_configured' } }),
    requestDiagnosis: okDiagnosis(report()),
  });

  await startLookupFlow(h.deps, { name: '테스트의원', region: '' });

  assert.equal(h.state().showDetail, true);
  assert.equal(isFlowBusy(h.state()), false);
});
