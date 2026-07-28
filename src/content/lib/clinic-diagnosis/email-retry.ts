/**
 * 진단 결과 메일 **재발송 판정** — 순수 로직(부작용 없음).
 *
 * ★ 왜 필요한가 (2026-07-28).
 *   진단 메일 발송이 실패하면 리드는 `sent=false` 로 저장된 뒤 **영구히 방치**됐다.
 *   재발송 경로가 아예 없어서, 인프라가 나중에 복구돼도 이미 실패한 리드는
 *   자동으로 다시 나가지 않았다. 실제로 2026-07-27 에 Resend 도메인 미검증으로
 *   2건이 실패했고 도메인이 복구된 뒤에도 그대로 남아 있었다.
 *
 *   영업상 이건 직접 손실이다 — 전화 아웃바운드의 목표 자체가 "이메일 주소 확보"인데,
 *   어렵게 받은 주소로 리포트가 안 나가면 그 리드는 죽는다.
 *
 * ★ 왜 순수 모듈인가.
 *   "무엇을 다시 보낼지" 는 규칙이고, "보내는 일" 은 부작용이다. 규칙을 라우트 안에
 *   두면 회귀 테스트를 쓸 수 없다. 여기서 판정만 하고 라우트가 실행한다.
 *
 * ⚠️ 재시도 상태 컬럼(attempts)을 두지 않는다. 마이그레이션은 Supabase SQL Editor
 *    수동 적용이라 대표의 손을 타야 하고, 그만한 이득이 없다. 대신 **기간 창**으로
 *    무한 재시도를 막는다 — 창을 벗어난 리드는 더 이상 대상이 아니다.
 */

/** 재발송을 시도하는 기간(일). 이보다 오래된 실패는 손대지 않는다. */
export const RETRY_WINDOW_DAYS = 7;

/**
 * 한 번의 실행에서 재발송할 최대 건수.
 *
 * ⚠️ 처음에 20으로 뒀다가 되물렸다(2026-07-28 교차검증). 신규 발송의 전역 일일
 *    한도가 200건인데(DEFAULT_EMAIL_GLOBAL_DAILY_LIMIT) 재시도가 하루 20건이면
 *    **유입보다 배출이 느리다** — 인프라 장애로 하루 200건이 실패하면 7일 창(=140건)
 *    안에 다 못 보내고 60건이 만료돼 영구 미발송이 된다. 리드를 살리려고 만든
 *    장치가 리드를 버리는 셈이다.
 *    → 유입 상한과 같은 200으로 맞춘다. 실제 발송량은 실패분에만 비례하므로
 *      평상시엔 0~수건이고, 이 값은 폭주 상한으로만 작동한다.
 */
export const MAX_RETRIES_PER_RUN = 200;

/**
 * 다시 보내도 소용없는 실패인가.
 *
 * 수신 주소가 잘못됐거나 차단된 경우는 며칠을 다시 보내도 같은 결과다.
 * 매일 같은 주소를 두드리면 발신 평판만 깎인다 — 그래서 건너뛴다.
 * 판단이 애매하면 **재시도하는 쪽**을 택한다(일시 장애를 영구로 오판하면
 * 리드가 죽고, 그 반대는 며칠 헛시도로 끝난다).
 */
export function isPermanentSendError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('invalid') ||
    m.includes('not a valid') ||
    m.includes('bounce') ||
    m.includes('suppress') ||
    m.includes('blocked') ||
    m.includes('unsubscrib')
  );
}

/** 재발송 후보 행 — 라우트가 DB 에서 읽어 넘긴다. */
export interface RetryCandidate {
  readonly id: string;
  readonly email: string;
  readonly clinicName: string | null;
  readonly shareToken: string | null;
  readonly summary: unknown;
  readonly diagnosedAt: string | null;
  readonly sendError: string | null;
  readonly createdAt: string;
}

export type SkipReason = 'permanent_error' | 'too_old' | 'no_token' | 'no_email';

export interface RetryPlan {
  readonly targets: readonly RetryCandidate[];
  readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: SkipReason }>;
  /** 창 안에 있으나 이번 실행 상한을 넘겨 다음으로 미룬 건수. */
  readonly deferred: number;
}

/**
 * 무엇을 다시 보낼지 정한다.
 *
 * 오래된 것부터 보낸다 — 먼저 기다린 리드가 먼저 받아야 하고, 창에서
 * 밀려날 위험이 큰 것부터 처리하는 것이 손실을 줄인다.
 */
export function planEmailRetries(
  rows: readonly RetryCandidate[],
  now: number = Date.now(),
  maxPerRun: number = MAX_RETRIES_PER_RUN,
): RetryPlan {
  const cutoff = now - RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const skipped: Array<{ id: string; reason: SkipReason }> = [];
  const eligible: RetryCandidate[] = [];

  for (const row of rows) {
    if (!row.email || !row.email.includes('@')) {
      skipped.push({ id: row.id, reason: 'no_email' });
      continue;
    }
    if (!row.shareToken) {
      // 토큰이 없으면 결과 주소를 만들 수 없다 — 빈 링크를 보내느니 건너뛴다.
      skipped.push({ id: row.id, reason: 'no_token' });
      continue;
    }
    const created = Date.parse(row.createdAt);
    if (!Number.isFinite(created) || created < cutoff) {
      skipped.push({ id: row.id, reason: 'too_old' });
      continue;
    }
    if (isPermanentSendError(row.sendError)) {
      skipped.push({ id: row.id, reason: 'permanent_error' });
      continue;
    }
    eligible.push(row);
  }

  eligible.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const targets = eligible.slice(0, Math.max(0, maxPerRun));
  return { targets, skipped, deferred: eligible.length - targets.length };
}

/** 실행 결과 요약 — 로그·알림 문구를 한 곳에서 만든다. */
export interface RetryRunSummary {
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped: number;
  readonly deferred: number;
}

export function buildRetrySummaryText(summary: RetryRunSummary): string {
  return (
    `진단 메일 재발송: 시도 ${summary.attempted}건 · 성공 ${summary.succeeded}건 · ` +
    `실패 ${summary.failed}건 · 건너뜀 ${summary.skipped}건 · 이월 ${summary.deferred}건`
  );
}
