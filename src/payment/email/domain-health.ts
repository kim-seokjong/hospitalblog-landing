/**
 * Resend 발송 도메인 상태 주간 점검.
 *
 * ★ 왜 만들었나 (2026-07-27).
 *   Resend 에 hospitalblog.kr 이 **미검증(failed)** 으로 방치돼 있었고, 그 상태로
 *   모든 메일 발송이 실패했다. 실패 알림(failure-alert)은 "메일을 한 통이라도
 *   보내야" 울린다. 반면 이 점검은 **메일이 한 통도 없는 주에도** 울린다.
 *   이번 사고는 이 확인 한 번이면 첫날 잡혔다.
 *
 * 판정 기준(보수적으로 — 애매하면 알린다):
 *   · 호출 실패/비정상 응답 → 알린다 (키 만료·권한 변경도 곧 발송 실패다)
 *   · 등록된 도메인 0개 → 알린다 (보낼 수 있는 주소가 없다는 뜻)
 *   · status !== 'verified' 인 도메인이 하나라도 있으면 → 알린다
 *   · 전부 verified → **조용히 넘어간다** (정상 보고로 채널을 오염시키지 않는다)
 *
 * 개인정보 없음: 도메인 이름과 상태만 다룬다(우리 소유 자산).
 *
 * 외부 의존 없는 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

import { sendTelegram, type EnvLike, type TelegramSender } from '../../dev/lib/telegram.ts';
import { formatKst } from './failure-alert.ts';

export interface DomainStatusRow {
  readonly name: string;
  readonly status: string;
}

export interface DomainHealthVerdict {
  /** true 면 알릴 것이 없다. */
  readonly healthy: boolean;
  readonly checked: number;
  readonly problems: readonly DomainStatusRow[];
  readonly note: string;
}

const RESEND_DOMAINS_URL = 'https://api.resend.com/domains';
const TIMEOUT_MS = 8000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** Resend 응답에서 도메인 배열을 꺼낸다. `{ data: [...] }` 와 맨 배열 둘 다 받는다. */
function extractRows(payload: unknown): readonly Record<string, unknown>[] | null {
  if (Array.isArray(payload)) return payload.filter((v): v is Record<string, unknown> => asRecord(v) !== null);
  const root = asRecord(payload);
  if (!root) return null;
  const data = root.data;
  if (Array.isArray(data)) return data.filter((v): v is Record<string, unknown> => asRecord(v) !== null);
  return null;
}

/** 응답 본문 → 판정. 순수 함수(네트워크 없음). */
export function evaluateDomains(payload: unknown): DomainHealthVerdict {
  const rows = extractRows(payload);
  if (!rows) {
    return { healthy: false, checked: 0, problems: [], note: 'Resend 도메인 응답 형식을 해석하지 못했습니다.' };
  }
  if (rows.length === 0) {
    return { healthy: false, checked: 0, problems: [], note: 'Resend 에 등록된 발송 도메인이 없습니다.' };
  }

  const problems: DomainStatusRow[] = [];
  for (const row of rows) {
    const name = typeof row.name === 'string' && row.name ? row.name : '(이름 미상)';
    const status = typeof row.status === 'string' && row.status ? row.status : '(상태 미상)';
    if (status !== 'verified') problems.push({ name, status });
  }

  if (problems.length === 0) {
    return { healthy: true, checked: rows.length, problems: [], note: `도메인 ${rows.length}개 모두 verified` };
  }
  return {
    healthy: false,
    checked: rows.length,
    problems,
    note: `미검증 도메인 ${problems.length}개 — 이 상태에서는 메일이 전건 실패합니다.`,
  };
}

export function buildDomainAlertText(verdict: DomainHealthVerdict, at: Date): string {
  const lines = [
    '🚨 [닥터포스트] 메일 발송 도메인 점검 실패',
    `· 사유: ${verdict.note}`,
  ];
  for (const p of verdict.problems) {
    lines.push(`· ${p.name} → ${p.status}`);
  }
  lines.push(`· 시각: ${formatKst(at)}`);
  lines.push('※ resend.com/domains 에서 DNS 레코드를 확인해 재검증하세요.');
  return lines.join('\n');
}

export type DomainCheckOutcome =
  | { readonly ran: false; readonly skipped: 'no-api-key' | 'restricted-key' }
  | { readonly ran: true; readonly verdict: DomainHealthVerdict; readonly alerted: boolean };

/**
 * 발송 전용(restricted) 키 — 메일은 나가지만 `/domains` 조회 권한이 없다.
 *
 * ★ 2026-08-22: 401 을 "메일 죽음"으로 읽었는데, 같은 키로 8/21 진단 메일이 **실제로
 *   발송에 성공**해 있었다. 이걸 실패로 알리면 매주 헛경보가 울리고 그러면 진짜
 *   경고를 안 보게 된다. 잘못된 키는 400 으로 오고 401 은 권한 부족이다.
 */
export class RestrictedKeyError extends Error {
  constructor() {
    super('restricted-key');
    this.name = 'RestrictedKeyError';
  }
}

export interface DomainCheckDeps {
  readonly env?: EnvLike;
  /** 테스트 주입용. 기본값은 실제 Resend 호출. */
  readonly fetchDomains?: (apiKey: string) => Promise<unknown>;
  /** 테스트 주입용. 기본값은 실제 텔레그램 전송. */
  readonly send?: TelegramSender;
  readonly now?: () => number;
}

async function defaultFetchDomains(apiKey: string): Promise<unknown> {
  const res = await fetch(RESEND_DOMAINS_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new RestrictedKeyError();
  if (!res.ok) {
    // 본문은 읽지 않는다 — 키가 섞여 나올 여지를 만들지 않는다.
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as unknown;
}

/**
 * 도메인 점검 1회 실행. **throw 하지 않는다** — 호출한 크론의 본래 일을 막으면 안 된다.
 * RESEND_API_KEY 가 없으면 건너뛴다.
 */
export async function runResendDomainCheck(deps: DomainCheckDeps = {}): Promise<DomainCheckOutcome> {
  const env = deps.env ?? process.env;
  const apiKey = (env.RESEND_API_KEY ?? '').trim();
  if (!apiKey) return { ran: false, skipped: 'no-api-key' };

  const at = new Date((deps.now ?? Date.now)());
  let verdict: DomainHealthVerdict;

  try {
    const payload = await (deps.fetchDomains ?? defaultFetchDomains)(apiKey);
    verdict = evaluateDomains(payload);
  } catch (e) {
    if (e instanceof RestrictedKeyError) {
      console.warn('[email/domain-health] 발송 전용 키 — 도메인 상태는 확인하지 못합니다(발송은 별개).');
      return { ran: false, skipped: 'restricted-key' };
    }
    const reason = e instanceof Error ? e.message : '알 수 없는 오류';
    verdict = {
      healthy: false,
      checked: 0,
      problems: [],
      note: `Resend 도메인 상태를 확인하지 못했습니다 (${reason}).`,
    };
  }

  if (verdict.healthy) {
    console.warn(`[email/domain-health] ok — ${verdict.note}`);
    return { ran: true, verdict, alerted: false };
  }

  console.error(`[email/domain-health] 경고 — ${verdict.note}`);
  let alerted = false;
  try {
    const sender: TelegramSender = deps.send ?? ((t) => sendTelegram(t, env));
    alerted = (await sender(buildDomainAlertText(verdict, at))) === 'sent';
  } catch (e) {
    console.error('[email/domain-health] 알림 실패(무시):', e instanceof Error ? e.message : e);
  }
  return { ran: true, verdict, alerted };
}
