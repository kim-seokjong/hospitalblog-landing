/**
 * GEO 엔진 공통 HTTP 헬퍼 — 타임아웃 + 제한적 재시도.
 *
 * 왜 fetch-timeout.ts 의 fetchJsonWithTimeout 을 재사용하지 않는가:
 *   그 유틸은 "그레이스풀" 설계라 실패 시 { ok:false } 만 돌려주고 사유를 버린다.
 *   GEO cron 은 엔진별 실패 사유를 응답 failures[] 에 남겨야 하므로(침묵 실패 금지)
 *   상태코드·본문 일부를 보존하는 별도 헬퍼가 필요하다.
 *   타임아웃 처리 방식(AbortController + finally clearTimeout)은 동일 패턴을 따른다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지).
 */

/** 재시도할 가치가 있는 상태코드 — 일시적 과부하·레이트리밋만 */
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Retry-After 헤더를 존중하되 대기 상한을 둔다(전체 실행 시간 방어) */
const MAX_RETRY_DELAY_MS = 5_000;
const BASE_RETRY_DELAY_MS = 800;

export interface PostJsonOptions {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly timeoutMs: number;
  /** 1 = 재시도 없음 */
  readonly maxAttempts: number;
  readonly fetchImpl: typeof fetch;
  /** 에러 메시지 접두어 (예: 'Perplexity') */
  readonly label: string;
  readonly sleepImpl?: (ms: number) => Promise<void>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  }
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(at - Date.now(), 0), MAX_RETRY_DELAY_MS);
}

/** 1회 시도 결과 — 성공 / 재시도 가능 실패 / 재시도 불가 실패 */
type AttemptOutcome =
  | { readonly kind: 'ok'; readonly data: unknown }
  | { readonly kind: 'retry'; readonly reason: string; readonly delayMs: number }
  | { readonly kind: 'fatal'; readonly reason: string };

async function attemptPostJson(options: PostJsonOptions, attempt: number): Promise<AttemptOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await options.fetchImpl(options.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: JSON.stringify(options.body),
      signal: controller.signal,
    });

    if (res.ok) return { kind: 'ok', data: await res.json() };

    const detail = await res.text().catch(() => '');
    const reason = `${options.label} API 실패 (${res.status}): ${detail.slice(0, 300)}`;
    if (!RETRYABLE_STATUS.has(res.status)) return { kind: 'fatal', reason };
    const delayMs = parseRetryAfterMs(res.headers.get('retry-after')) ?? BASE_RETRY_DELAY_MS * attempt;
    return { kind: 'retry', reason, delayMs };
  } catch (e) {
    // 네트워크 오류·타임아웃(Abort)·JSON 파싱 실패는 모두 일시적일 수 있어 재시도 대상
    const message = e instanceof Error ? e.message : String(e);
    return {
      kind: 'retry',
      reason: `${options.label} 네트워크 오류: ${message.slice(0, 300)}`,
      delayMs: BASE_RETRY_DELAY_MS * attempt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * JSON POST 를 타임아웃·재시도와 함께 수행하고 파싱된 body 를 반환한다.
 * 실패 시 throw (사유 문자열 포함) — 호출부가 엔진 단위로 격리한다.
 */
export async function postJsonWithRetry(options: PostJsonOptions): Promise<unknown> {
  const attempts = Math.max(1, options.maxAttempts);
  const doSleep = options.sleepImpl ?? sleep;
  let lastReason = `${options.label} 요청 실패`;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const outcome = await attemptPostJson(options, attempt);
    if (outcome.kind === 'ok') return outcome.data;
    if (outcome.kind === 'fatal') throw new Error(outcome.reason);

    lastReason = outcome.reason;
    if (attempt === attempts) break;
    await doSleep(outcome.delayMs);
  }

  throw new Error(lastReason);
}
