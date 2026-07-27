/**
 * 병원명 무료진단 — 화면 흐름 상태기(순수 모듈).
 *
 * ★ 왜 컴포넌트에서 떼어냈나 (2026-07-27 운영 버그).
 *   조회(lookup)와 진단(diagnosis)이 **하나의 요청 카운터를 공유**하고 있었다.
 *   조회가 1건으로 특정되면 그 자리에서 진단을 이어 실행했는데, 진단이 카운터를
 *   한 칸 올려 버려 조회 쪽 `finally` 의 "내가 최신인가" 비교가 **영원히 불일치**했다.
 *   그 결과 결과가 다 렌더된 뒤에도 "병원 찾는 중…" 버튼이 비활성으로 굳고
 *   스피너가 계속 돌아, 새로고침 없이는 두 번째 진단을 돌릴 수 없었다.
 *
 * 그래서 카운터를 **흐름(flow) 번호** 하나로 통일하되, 규칙을 바꿨다.
 *   · 흐름 번호는 **사용자가 새로 시작한 동작**에서만 발급된다.
 *   · 조회 → 자동 진단으로 이어지는 구간은 **같은 흐름 번호를 물려받는다**
 *     (진단이 조회의 뒷정리를 무효화하지 않는다).
 *   · 시작 액션(`lookup:start`·`diagnosis:start`)은 두 로딩 플래그를 **둘 다** 확정한다.
 *     한쪽이 켜진 채 다른 흐름이 시작돼도 남은 플래그가 굳지 않는다 — 구조적 보증.
 *   · 그 외 액션은 `flowId` 가 현재 흐름과 같을 때만 반영된다
 *     (늦게 도착한 응답이 최신 결과를 덮지 않는다 — 경합 가드는 그대로 유지).
 *
 * 외부 의존 없는 순수 모듈(@/ alias·React import 금지) — node:test 러너로 직접 검증한다.
 */

import type { ClinicCandidate, ClinicLookupOutcome, DiagnosisReport } from './types.ts';

/* ── 화면 문구·상수 ──────────────────────────────────────── */

/** 병원 이름 최소 길이 — 이보다 짧으면 조회를 시작하지 않는다. */
export const MIN_CLINIC_NAME_LENGTH = 2;

export const NAME_TOO_SHORT_MESSAGE = '병원 이름을 2자 이상 입력해 주세요.';
export const LOOKUP_FAILED_MESSAGE = '병원을 찾지 못했어요. 잠시 후 다시 시도해 주세요.';
export const DIAGNOSIS_FAILED_MESSAGE = '진단에 실패했어요. 잠시 후 다시 시도해 주세요.';
export const NETWORK_ERROR_MESSAGE = '네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.';

/* ── 상태 ────────────────────────────────────────────────── */

export interface DiagnosisFlowState {
  /** 현재 살아 있는 흐름 번호. 0 = 아직 아무것도 시작하지 않음. */
  readonly flowId: number;
  /** 병원 특정(행안부 조회) 진행 중. */
  readonly lookupLoading: boolean;
  /** 진단 진행 중인 병원의 행안부 관리번호. null = 진단 중 아님. */
  readonly busyMngNo: string | null;
  readonly lookup: ClinicLookupOutcome | null;
  readonly report: DiagnosisReport | null;
  readonly shareToken: string | null;
  readonly error: string | null;
  readonly showDetail: boolean;
}

export const INITIAL_DIAGNOSIS_FLOW_STATE: DiagnosisFlowState = {
  flowId: 0,
  lookupLoading: false,
  busyMngNo: null,
  lookup: null,
  report: null,
  shareToken: null,
  error: null,
  showDetail: false,
};

export type DiagnosisFlowAction =
  /** 조회 시작 — 새 흐름을 연다. */
  | { readonly type: 'lookup:start'; readonly flowId: number }
  | { readonly type: 'lookup:resolved'; readonly flowId: number; readonly outcome: ClinicLookupOutcome }
  | { readonly type: 'lookup:failed'; readonly flowId: number; readonly message: string }
  /** 조회 뒷정리 — 성공·실패 무관하게 항상 한 번 온다. */
  | { readonly type: 'lookup:settled'; readonly flowId: number }
  /** 진단 시작 — 조회에서 이어질 때는 조회의 flowId 를 그대로 물려받는다. */
  | { readonly type: 'diagnosis:start'; readonly flowId: number; readonly mngNo: string }
  | {
      readonly type: 'diagnosis:succeeded';
      readonly flowId: number;
      readonly report: DiagnosisReport;
      readonly shareToken: string | null;
    }
  | { readonly type: 'diagnosis:failed'; readonly flowId: number; readonly message: string }
  /** 진단 뒷정리 — 성공·실패 무관하게 항상 한 번 온다. */
  | { readonly type: 'diagnosis:settled'; readonly flowId: number }
  /** 상세 진단 입력창 열기 (흐름과 무관한 화면 조작). */
  | { readonly type: 'detail:open' }
  /** 입력값이 조회 조건을 못 맞춤 — 흐름을 시작하지 않고 안내만 띄운다. */
  | { readonly type: 'input:invalid'; readonly message: string };

/**
 * 자동 탐색이 불가능한 결과 — 사용자가 직접 넣어야 진단이 가능하므로
 * 상세 입력창을 바로 펼친다.
 */
function needsManualInput(outcome: ClinicLookupOutcome): boolean {
  return outcome.kind === 'unavailable' || outcome.kind === 'not_found';
}

export function diagnosisFlowReducer(
  state: DiagnosisFlowState,
  action: DiagnosisFlowAction,
): DiagnosisFlowState {
  switch (action.type) {
    case 'detail:open':
      return state.showDetail ? state : { ...state, showDetail: true };

    case 'input:invalid':
      return { ...state, error: action.message };

    /**
     * 시작 액션 — 새 흐름을 연다.
     * 두 로딩 플래그를 **둘 다** 명시적으로 확정하는 것이 핵심이다.
     * 이전 흐름이 남긴 플래그는 뒷정리 액션이 무시돼도 여기서 반드시 꺼진다.
     */
    case 'lookup:start':
      return {
        ...state,
        flowId: action.flowId,
        lookupLoading: true,
        busyMngNo: null,
        lookup: null,
        report: null,
        shareToken: null,
        error: null,
      };

    case 'diagnosis:start':
      return {
        ...state,
        flowId: action.flowId,
        lookupLoading: false,
        busyMngNo: action.mngNo,
        // report 는 지우지 않는다 — 상세 진단 입력창이 직전 병원을 계속 알아야 한다.
        shareToken: null,
        error: null,
      };

    default:
      break;
  }

  // 늦게 도착한 응답 — 최신 결과를 덮지 않는다.
  if (action.flowId !== state.flowId) return state;

  switch (action.type) {
    case 'lookup:resolved':
      return {
        ...state,
        lookup: action.outcome,
        showDetail: needsManualInput(action.outcome) ? true : state.showDetail,
      };

    case 'lookup:failed':
      return { ...state, error: action.message };

    case 'lookup:settled':
      return state.lookupLoading ? { ...state, lookupLoading: false } : state;

    case 'diagnosis:succeeded':
      return {
        ...state,
        report: action.report,
        shareToken: action.shareToken,
        showDetail: false,
        error: null,
      };

    case 'diagnosis:failed':
      return { ...state, error: action.message };

    case 'diagnosis:settled':
      return state.busyMngNo === null ? state : { ...state, busyMngNo: null };
  }
}

/** 조회든 진단이든 뭔가 돌고 있는가 — 버튼 비활성·스피너 판단의 단일 기준. */
export function isFlowBusy(state: DiagnosisFlowState): boolean {
  return state.lookupLoading || state.busyMngNo !== null;
}

/* ── 흐름 실행기 ─────────────────────────────────────────── */

export interface ClinicLookupResponse {
  readonly outcome?: ClinicLookupOutcome;
  readonly error?: string;
}

export interface DiagnosisResponse {
  readonly report?: DiagnosisReport;
  readonly shareToken?: string | null;
  readonly error?: string;
}

/** 상세 진단에서 원장이 직접 넣은 값 (전부 선택). */
export interface DiagnosisDetailInput {
  readonly blogId: string;
  readonly siteUrl: string;
  readonly body: string;
}

/**
 * 실행기가 바깥에서 받는 것 — 네트워크·부수효과·흐름 번호 발급을 전부 주입받아
 * 이 모듈 자체는 React·fetch 없이 테스트된다.
 */
export interface DiagnosisFlowDeps {
  /** 새 흐름 번호를 발급하고 그것을 최신으로 만든다. */
  readonly nextFlowId: () => number;
  /** 지금 최신인 흐름 번호 — 부수효과를 낼지 판단한다. */
  readonly currentFlowId: () => number;
  readonly dispatch: (action: DiagnosisFlowAction) => void;
  readonly lookupClinic: (input: { readonly name: string; readonly region: string }) => Promise<ClinicLookupResponse>;
  readonly requestDiagnosis: (input: {
    readonly clinic: ClinicCandidate;
    readonly detail?: DiagnosisDetailInput;
  }) => Promise<DiagnosisResponse>;
  /** 조회를 실제로 시작했을 때 (퍼널 기록). */
  readonly onLookupStarted?: () => void;
  /** 최신 흐름의 결과가 화면에 올라갔을 때 (퍼널 기록·스크롤). */
  readonly onReportShown?: () => void;
}

/**
 * 서버가 준 문구를 쓰되, 비어 있으면 기본 문구로 대체한다.
 * `?? ` 만 쓰면 `error: ''` 응답에서 **빈 노란 박스**가 뜬다 — 실제로 걸렸던 자리다.
 */
function messageOr(raw: string | undefined, fallback: string): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed === '' ? fallback : trimmed;
}

async function runDiagnosisInFlow(
  deps: DiagnosisFlowDeps,
  flowId: number,
  clinic: ClinicCandidate,
  detail?: DiagnosisDetailInput,
): Promise<void> {
  deps.dispatch({ type: 'diagnosis:start', flowId, mngNo: clinic.mngNo });
  let shown = false;
  try {
    const data = await deps.requestDiagnosis({ clinic, detail });
    if (!data.report) {
      deps.dispatch({
        type: 'diagnosis:failed',
        flowId,
        message: messageOr(data.error, DIAGNOSIS_FAILED_MESSAGE),
      });
      return;
    }
    deps.dispatch({
      type: 'diagnosis:succeeded',
      flowId,
      report: data.report,
      shareToken: typeof data.shareToken === 'string' ? data.shareToken : null,
    });
    shown = deps.currentFlowId() === flowId;
  } catch {
    deps.dispatch({ type: 'diagnosis:failed', flowId, message: NETWORK_ERROR_MESSAGE });
  } finally {
    // 성공·실패·경합 무관하게 이 흐름의 진단 로딩은 반드시 여기서 풀린다.
    deps.dispatch({ type: 'diagnosis:settled', flowId });
  }
  if (shown) deps.onReportShown?.();
}

/** 사용자가 병원을 직접 골라(후보 선택·블로그 교체·상세 입력) 시작하는 진단. */
export function startDiagnosisFlow(
  deps: DiagnosisFlowDeps,
  clinic: ClinicCandidate,
  detail?: DiagnosisDetailInput,
): Promise<void> {
  return runDiagnosisInFlow(deps, deps.nextFlowId(), clinic, detail);
}

/**
 * 병원 이름으로 조회 → 정확히 1건이면 **같은 흐름 안에서** 진단까지 이어간다.
 * 버튼 문구는 `병원 찾는 중… → 진단 중… → 원래 문구` 로 이어진다.
 */
export async function startLookupFlow(
  deps: DiagnosisFlowDeps,
  input: { readonly name: string; readonly region: string },
): Promise<void> {
  const name = input.name.trim();
  if (name.length < MIN_CLINIC_NAME_LENGTH) {
    deps.dispatch({ type: 'input:invalid', message: NAME_TOO_SHORT_MESSAGE });
    return;
  }

  deps.onLookupStarted?.();
  const flowId = deps.nextFlowId();
  deps.dispatch({ type: 'lookup:start', flowId });

  let autoDiagnose: ClinicCandidate | null = null;
  try {
    const data = await deps.lookupClinic({ name, region: input.region.trim() });
    if (!data.outcome) {
      deps.dispatch({
        type: 'lookup:failed',
        flowId,
        message: messageOr(data.error, LOOKUP_FAILED_MESSAGE),
      });
      return;
    }
    deps.dispatch({ type: 'lookup:resolved', flowId, outcome: data.outcome });
    // 정확히 1건일 때만 자동으로 진단까지 이어간다.
    if (data.outcome.kind === 'resolved' && deps.currentFlowId() === flowId) {
      autoDiagnose = data.outcome.clinic;
    }
  } catch {
    deps.dispatch({ type: 'lookup:failed', flowId, message: NETWORK_ERROR_MESSAGE });
  } finally {
    // 성공·실패·경합 무관하게 이 흐름의 조회 로딩은 반드시 여기서 풀린다.
    deps.dispatch({ type: 'lookup:settled', flowId });
  }

  /**
   * 진단은 조회의 뒷정리가 끝난 **뒤에**, 같은 tick 안에서 시작한다.
   * (React 는 이 구간의 dispatch 들을 한 번의 렌더로 묶으므로 스피너가 깜빡이지 않는다.)
   */
  if (autoDiagnose) await runDiagnosisInFlow(deps, flowId, autoDiagnose);
}
