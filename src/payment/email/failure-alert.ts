/**
 * 메일 발송 실패 → 텔레그램 알림 (단일 지점).
 *
 * ★ 왜 만들었나 (2026-07-27).
 *   Resend 도메인이 미검증 상태로 방치돼 **모든 메일이 실패하는 동안 아무도 몰랐다.**
 *   실패의 흔적은 진단 메일의 DB send_error 한 곳뿐이었고, 나머지 경로(결제 성공·실패,
 *   재시도, 해지, 사전고지, 월간 리포트, 체험 리포트)는 console.error 한 줄이 전부였다.
 *   sendEmail() 이 그 7개 경로가 전부 지나가는 유일한 문이라, 여기 한 곳만 막으면 된다.
 *
 * 지켜야 할 것:
 *   ① 개인정보 금지 — 수신 주소·병원명·회원 식별자를 알림에 싣지 않는다.
 *      오류 문구에 주소가 섞여 들어오는 경우가 있어 **보내기 전에 지운다**(redactPersonal).
 *   ② 폭주 금지 — 크론이 100명에게 보내다 전부 실패해도 텔레그램은 몇 통에서 멈춘다.
 *   ③ 절대 throw 금지 — 알림이 메일 발송 흐름을 깨면 안 된다.
 *
 * 폭주 차단의 한계(중요):
 *   서버리스라 카운터는 **인스턴스별로** 돈다. 다만 실제 폭주가 나오는 곳은
 *   "한 번의 크론 실행이 N명을 도는" 경로이고 그건 한 프로세스 안에서 일어나므로
 *   이 인메모리 게이트가 정확히 그 경우를 막는다. 사용자 트리거 경로(진단 메일)는
 *   인스턴스가 흩어질 수 있지만 애초에 하루 수 건 수준이다.
 *
 * 외부 의존 없는 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

import { sendTelegram, type TelegramSendResult, type TelegramSender } from '../../dev/lib/telegram.ts';

/** 어떤 기능의 메일인지. 호출부가 넘긴다(미전달 시 'other'). */
export type EmailFeature =
  | 'clinic-diagnosis'
  | 'billing-charge'
  | 'billing-retry'
  | 'billing-cancel'
  | 'billing-notify'
  | 'monthly-report'
  | 'trial-report'
  | 'trial-digest'
  | 'registry-health'
  | 'other';

/** 알림에 찍히는 사람이 읽는 이름. 개인정보가 아니라 **기능 이름**만 들어간다. */
const FEATURE_LABELS: Readonly<Record<EmailFeature, string>> = {
  'clinic-diagnosis': '무료 진단 결과 메일',
  'billing-charge': '정기결제 결과 알림',
  'billing-retry': '결제 재시도 알림',
  'billing-cancel': '구독 해지 안내',
  'billing-notify': '결제 사전 고지',
  'monthly-report': '월간 리포트',
  'trial-report': '체험 종료 리포트',
  'trial-digest': '체험 리포트 대표 다이제스트',
  'registry-health': '병원 조회 장애 알림',
  other: '미지정(호출부에서 기능명 미전달)',
};

export function featureLabel(feature: EmailFeature): string {
  return FEATURE_LABELS[feature] ?? FEATURE_LABELS.other;
}

// ─────────────────────────────── 개인정보 제거 ───────────────────────────────

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** 전화번호·회원 식별자처럼 보이는 긴 숫자열. HTTP 상태코드(3자리)는 남긴다. */
const LONG_DIGITS_PATTERN = /\d{7,}/g;
/** UUID(회원 id) */
const UUID_PATTERN = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

const REASON_MAX = 200;

/**
 * 알림에 실어도 되는 형태로 오류 문구를 다듬는다.
 * Resend 오류에는 수신 주소가 그대로 실려 오는 경우가 있다("Invalid `to` field: ...").
 */
export function redactPersonal(text: string): string {
  const cleaned = (text || '')
    .replace(EMAIL_PATTERN, '(주소생략)')
    .replace(UUID_PATTERN, '(식별자생략)')
    .replace(LONG_DIGITS_PATTERN, '(숫자생략)')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '사유 없음';
  return cleaned.length > REASON_MAX ? `${cleaned.slice(0, REASON_MAX)}…` : cleaned;
}

// ──────────────────────────────── 폭주 차단 ────────────────────────────────

export interface AlertGateOptions {
  /** 같은 (기능+사유)를 다시 알리기까지의 침묵 시간. */
  readonly dedupeWindowMs?: number;
  /** windowMs 동안 보낼 수 있는 알림 총량(모든 기능 합산). */
  readonly maxPerWindow?: number;
  readonly windowMs?: number;
  /** 키 무한 증식 방지용 상한. */
  readonly maxKeys?: number;
}

export interface AlertDecision {
  readonly send: boolean;
  readonly reason: 'first' | 'duplicate' | 'rate-limited';
  /** 직전 알림 이후 조용히 묶인 동일 오류 건수(보낼 때만 의미 있음). */
  readonly foldedCount: number;
}

export interface AlertGate {
  decide(key: string, nowMs: number): AlertDecision;
}

export const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6시간
export const RATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24시간
export const MAX_ALERTS_PER_WINDOW = 5;

interface GateEntry {
  /** null = 아직 한 번도 보내지 못한 키(상한에 걸려 묶이기만 한 상태). */
  lastSentAt: number | null;
  folded: number;
}

/**
 * 알림 게이트. 규칙 두 겹:
 *   ① 같은 (기능+사유)는 dedupeWindowMs 동안 1통만 — 100명 실패해도 1통이다.
 *   ② 그래도 서로 다른 오류가 쏟아지면 windowMs 안에서 maxPerWindow 통에서 끊는다.
 * 억제된 건수는 세어 두었다가 다음 알림에 "N건 묶임"으로 함께 알린다.
 */
export function createAlertGate(options: AlertGateOptions = {}): AlertGate {
  const dedupeWindowMs = options.dedupeWindowMs ?? DEDUPE_WINDOW_MS;
  const windowMs = options.windowMs ?? RATE_WINDOW_MS;
  const maxPerWindow = options.maxPerWindow ?? MAX_ALERTS_PER_WINDOW;
  const maxKeys = options.maxKeys ?? 200;

  const entries = new Map<string, GateEntry>();
  let sentAt: number[] = [];

  return {
    decide(key: string, nowMs: number): AlertDecision {
      sentAt = sentAt.filter((t) => nowMs - t < windowMs);
      const entry = entries.get(key);

      if (entry && entry.lastSentAt !== null && nowMs - entry.lastSentAt < dedupeWindowMs) {
        entry.folded += 1;
        return { send: false, reason: 'duplicate', foldedCount: entry.folded };
      }

      if (sentAt.length >= maxPerWindow) {
        // 상한에 걸려도 건수는 센다 — 상한이 풀리면 "그동안 N건" 으로 알린다.
        if (entry) entry.folded += 1;
        else entries.set(key, { lastSentAt: null, folded: 1 });
        return { send: false, reason: 'rate-limited', foldedCount: (entry?.folded ?? 1) };
      }

      const folded = entry?.folded ?? 0;
      entries.set(key, { lastSentAt: nowMs, folded: 0 });
      sentAt.push(nowMs);

      // 오래된 키부터 버린다(Map 은 삽입 순서를 유지한다).
      while (entries.size > maxKeys) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }

      return { send: true, reason: 'first', foldedCount: folded };
    },
  };
}

/** 프로세스 단위 기본 게이트 — 한 번의 크론 실행은 한 프로세스라 여기서 막힌다. */
const defaultGate = createAlertGate();

// ──────────────────────────────── 메시지 ────────────────────────────────

/** KST 표기(서버는 UTC로 돈다). */
export function formatKst(at: Date): string {
  const kst = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())} ` +
    `${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())} KST`
  );
}

export interface FailureAlertInput {
  readonly feature: EmailFeature;
  readonly reason: string;
  readonly at: Date;
  readonly foldedCount: number;
}

export function buildFailureAlertText(input: FailureAlertInput): string {
  const lines = [
    '🚨 [닥터포스트] 메일 발송 실패',
    `· 기능: ${featureLabel(input.feature)}`,
    `· 사유: ${redactPersonal(input.reason)}`,
    `· 시각: ${formatKst(input.at)}`,
  ];
  if (input.foldedCount > 0) {
    lines.push(`· 직전 알림 이후 같은 오류 ${input.foldedCount}건이 조용히 묶였습니다.`);
  }
  lines.push('※ 같은 오류는 6시간에 한 번만 알립니다.');
  return lines.join('\n');
}

// ──────────────────────────────── 진입점 ────────────────────────────────

export interface FailureAlertDeps {
  /** 테스트에서 실제 텔레그램을 쏘지 않기 위해 주입한다. */
  readonly send?: TelegramSender;
  readonly gate?: AlertGate;
  readonly now?: () => number;
}

export type FailureAlertOutcome = 'sent' | 'skipped' | 'suppressed' | 'failed';

/**
 * 메일 발송 실패 1건을 알린다.
 * **어떤 경우에도 throw 하지 않는다** — 호출부(sendEmail)의 흐름은 그대로 진행돼야 한다.
 */
export async function notifyEmailFailure(
  input: { readonly feature?: EmailFeature; readonly error?: string },
  deps: FailureAlertDeps = {},
): Promise<FailureAlertOutcome> {
  try {
    const feature = input.feature ?? 'other';
    const reason = redactPersonal(input.error ?? '');
    const gate = deps.gate ?? defaultGate;
    const nowMs = (deps.now ?? Date.now)();

    const decision = gate.decide(`${feature}|${reason}`, nowMs);
    if (!decision.send) return 'suppressed';

    const text = buildFailureAlertText({
      feature,
      reason,
      at: new Date(nowMs),
      foldedCount: decision.foldedCount,
    });

    const sender: TelegramSender = deps.send ?? ((t) => sendTelegram(t));
    const result: TelegramSendResult = await sender(text);
    return result === 'sent' ? 'sent' : result === 'skipped' ? 'skipped' : 'failed';
  } catch (e) {
    // 알림의 실패로 메일 흐름을 깨지 않는다.
    console.error('[email-alert] 알림 처리 실패(무시):', e instanceof Error ? e.message : e);
    return 'failed';
  }
}
