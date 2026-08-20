import type { DiagnosisLeadSummary } from './conversion.ts';
import {
  buildDiagnosisEmail,
  emailLimitMessage,
  evaluateEmailLeadQuota,
  extractLeadClinicFields,
  normalizeDiagnosedAt,
  normalizeLeadEmail,
  type EmailLeadCounts,
  type EmailLeadLimits,
} from './email-lead.ts';

/**
 * 진단 결과 메일 발송 — **실행 순서**와 실패 처리 (부작용 주입형 순수 로직).
 *
 * ★ 이 모듈이 존재하는 이유는 순서 자체가 이 기능의 안전장치이기 때문이다.
 *   되돌릴 수 없는 부작용(발송)을 되돌릴 수 있는 것(저장)보다 먼저 하면,
 *   저장이 깨졌을 때 메일은 이미 나가 있고 연락처만 유실된다 —
 *   사용자는 "메일로 보내드렸어요"를 보고, 서버 로그 한 줄만 남는다.
 *   그 순서를 라우트 안에 두면 아무도 회귀 테스트를 못 쓴다. 그래서 DB·메일·계측을
 *   전부 주입받아 여기서 순서만 결정한다.
 *
 * 불변식(테스트로 강제):
 *  1. 리드 저장에 실패하면 **메일을 보내지 않는다**(saveLead 실패 → sendEmail 미호출).
 *  2. 저장 실패는 절대 200 이 아니다. 발송 성공 여부와 무관하다.
 *  3. 캡을 셀 수 없으면(테이블 없음·조회 실패) **발송하지 않는다**(503).
 *  4. 만료·없는 토큰은 캡 집계에 닿지 않는다(countLeads 미호출) — 캡을 소비하지 않는다.
 *  5. 퍼널 이벤트는 저장에 성공한 건만 기록한다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

/** 공유 토큰 형식 — /clinic-check/r/[token] 과 동일 규칙. DB 조회 전에 형태부터 거른다. */
export const SHARE_TOKEN_PATTERN = /^[a-f0-9]{32,80}$/;

export type ReportLoad =
  | { readonly kind: 'ok'; readonly results: unknown; readonly expiresAt: string | null }
  /** 없음·조회 실패 — 어느 쪽이든 사용자에게는 같은 문구다(토큰 존재 여부를 흘리지 않는다). */
  | { readonly kind: 'not_found' };

export type CountLeadsResult =
  | { readonly kind: 'ok'; readonly counts: EmailLeadCounts }
  | { readonly kind: 'blocked'; readonly reason: 'missing_table' | 'error' };

/** 리드 테이블에 그대로 들어가는 행. */
export interface LeadRow {
  readonly email: string;
  readonly mngNo: string;
  readonly clinicName: string;
  readonly region: string;
  readonly specialty: string;
  readonly phone: string;
  readonly shareToken: string;
  readonly shareUrl: string;
  readonly summary: DiagnosisLeadSummary | null;
  readonly diagnosedAt: string | null;
  readonly ipHash: string;
}

export type SaveLeadResult =
  | { readonly kind: 'ok'; readonly id: string }
  | { readonly kind: 'failed'; readonly message: string };

export interface SendOutcome {
  readonly success: boolean;
  readonly error?: string;
}

export interface EmailFlowDeps {
  loadReport(token: string): Promise<ReportLoad>;
  countLeads(input: {
    readonly email: string;
    readonly ipHash: string;
    readonly token: string;
  }): Promise<CountLeadsResult>;
  saveLead(row: LeadRow): Promise<SaveLeadResult>;
  sendEmail(message: {
    readonly to: string;
    readonly subject: string;
    readonly html: string;
  }): Promise<SendOutcome>;
  /** 발송 결과를 저장된 행에 반영. 실패해도 응답을 바꾸지 않는다(연락처는 이미 남았다). */
  markSendResult(id: string, sent: boolean, error: string | null): Promise<void>;
  /** 퍼널 계측 — 저장 성공 건만 호출된다. */
  recordFunnel(input: { readonly sent: boolean }): Promise<void>;
  /** 저장된 리포트에서 요약 생성. 옛 리포트에서 throw 해도 여기서 흡수한다. */
  summarize(report: unknown): DiagnosisLeadSummary | null;
  /** 결과 절대 주소 생성 (요청 Host 를 쓰지 않기 위해 주입). */
  reportUrl(token: string): string;
  /** 경고 로그 (사유는 로그에만 남기고 사용자 문구는 통일한다). */
  logWarn?(message: string): void;
  logError?(message: string): void;
  now?(): number;
}

export interface EmailFlowInput {
  readonly rawToken: unknown;
  readonly rawEmail: unknown;
  readonly ipHash: string;
  readonly limits: EmailLeadLimits;
}

export type EmailFlowResult =
  | { readonly status: 200; readonly body: { readonly ok: true; readonly sent: boolean } }
  | { readonly status: 400 | 404 | 410 | 429 | 500 | 503; readonly body: { readonly error: string } };

const MSG = {
  badEmail: '이메일 주소를 확인해 주세요.',
  notFound: '진단 결과를 찾지 못했어요. 진단을 다시 실행해 주세요.',
  expired: '이 진단 결과는 만료됐어요. 진단을 다시 실행해 주세요.',
  unavailable:
    '지금은 메일을 보내드릴 수 없어요. 잠시 후 다시 시도하시거나 010-2558-1115 으로 연락 주세요.',
  saveFailed: '메일 발송을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
} as const;

/** 발송 실패 사유는 길이를 잘라 저장한다(로그·컬럼 폭주 방지). 빈 문자열은 null. */
function trimSendError(outcome: SendOutcome): string | null {
  if (outcome.success) return null;
  const value = (outcome.error ?? '').slice(0, 300);
  return value.length > 0 ? value : null;
}

export async function runDiagnosisEmailFlow(
  deps: EmailFlowDeps,
  input: EmailFlowInput,
): Promise<EmailFlowResult> {
  const email = normalizeLeadEmail(input.rawEmail);
  if (!email) return { status: 400, body: { error: MSG.badEmail } };

  const token = typeof input.rawToken === 'string' ? input.rawToken.trim() : '';
  if (!SHARE_TOKEN_PATTERN.test(token)) {
    return { status: 400, body: { error: MSG.notFound } };
  }

  // ① 리포트 확인이 캡보다 먼저다 — 만료·없는 토큰이 캡을 소비하면 안 된다.
  //    (30일 지난 링크로 다시 눌러본 원장이 하루 5회 중 1회를 잃는 것을 막는다.)
  const loaded = await deps.loadReport(token);
  if (loaded.kind !== 'ok' || loaded.results === null || loaded.results === undefined) {
    return { status: 404, body: { error: MSG.notFound } };
  }
  const now = deps.now ? deps.now() : Date.now();
  if (loaded.expiresAt) {
    const expiry = Date.parse(loaded.expiresAt);
    if (Number.isFinite(expiry) && expiry < now) {
      return { status: 410, body: { error: MSG.expired } };
    }
  }

  // ② 리포트에서 쓸 값을 **발송 전에** 전부 꺼낸다. 옛 리포트에 필드가 없어도
  //    여기서 빈 값이 될 뿐, 메일이 나간 뒤 TypeError 로 실패하는 일이 없다.
  const report = loaded.results as Record<string, unknown>;
  const clinic = extractLeadClinicFields(report.clinic);
  let summary: DiagnosisLeadSummary | null = null;
  try {
    summary = deps.summarize(loaded.results);
  } catch (e) {
    deps.logError?.(`요약 생성 실패(링크만 발송): ${e instanceof Error ? e.message : String(e)}`);
    summary = null;
  }

  // ③ 캡 — 저장된 리드로 센다. 셀 수 없으면 보내지 않는다.
  const counted = await deps.countLeads({ email, ipHash: input.ipHash, token });
  if (counted.kind === 'blocked') {
    deps.logError?.(
      counted.reason === 'missing_table'
        ? 'clinic_diagnosis_email_leads 없음 — 마이그 056 미적용. 발송을 막는다.'
        : '캡 집계 실패 — 발송을 막는다.',
    );
    return { status: 503, body: { error: MSG.unavailable } };
  }
  const decision = evaluateEmailLeadQuota(counted.counts, input.limits);
  if (!decision.allowed) {
    deps.logWarn?.(`캡 초과: ${decision.reason}`);
    return { status: 429, body: { error: emailLimitMessage(decision.reason) } };
  }

  // ④ ★ 리드 저장이 이 라우트의 본체다. 저장에 성공해야 메일을 보낸다.
  const saved = await deps.saveLead({
    email,
    mngNo: clinic.mngNo,
    clinicName: clinic.name,
    region: clinic.region,
    specialty: clinic.specialty,
    phone: clinic.phone,
    shareToken: token,
    shareUrl: `/clinic-check/r/${token}`,
    summary,
    diagnosedAt: normalizeDiagnosedAt(report.runAt),
    ipHash: input.ipHash,
  });
  if (saved.kind === 'failed') {
    deps.logError?.(`리드 적재 실패 — 발송하지 않음: ${saved.message}`);
    // 연락처를 남기지 못했으면 이 요청은 목적을 달성하지 못했다.
    // 200 으로 덮으면 "확보율 100%, 리드 0건"이 된다.
    return { status: 500, body: { error: MSG.saveFailed } };
  }

  // ⑤ 발송 — 인프라가 없으면(RESEND 미설정) 저장까지만 되고 대표가 수동 발송한다.
  const { subject, html } = buildDiagnosisEmail({
    clinicName: clinic.name,
    summary,
    reportUrl: deps.reportUrl(token),
    runAt: typeof report.runAt === 'string' ? report.runAt : '',
  });
  const outcome = await deps.sendEmail({ to: email, subject, html });

  await deps.markSendResult(saved.id, outcome.success, trimSendError(outcome));

  // ⑥ 계측 — 저장에 성공한 건만 센다(실패를 성공으로 세면 확보율이 거짓이 된다).
  await deps.recordFunnel({ sent: outcome.success });

  return { status: 200, body: { ok: true, sent: outcome.success } };
}
