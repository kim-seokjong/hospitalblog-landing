/**
 * GEO 엔진 공통 HTTP 헬퍼 — 데드라인 인지 타임아웃 + 제한적 재시도 + 시도 예산.
 *
 * 왜 fetch-timeout.ts 의 fetchJsonWithTimeout 을 재사용하지 않는가:
 *   그 유틸은 "그레이스풀" 설계라 실패 시 { ok:false } 만 돌려주고 사유를 버린다.
 *   GEO cron 은 엔진별 실패 사유를 응답 failures[] 에 남겨야 하므로(침묵 실패 금지)
 *   상태코드·본문 일부를 보존하는 별도 헬퍼가 필요하다.
 *   타임아웃 처리 방식(AbortController + finally clearTimeout)은 동일 패턴을 따른다.
 *
 * ── 데드라인 규율 (Vercel maxDuration 300초 초과 방지)
 *  ① 요청 타임아웃 = min(기본 타임아웃, 데드라인까지 남은 시간)
 *     → 데드라인 직전에 시작한 요청이 60초를 더 쓰는 일이 없다.
 *  ② 외부 AbortSignal 을 함께 받아 데드라인 도달 시 **진행 중인 요청도 취소**한다.
 *  ③ 재시도는 (대기시간 + 최소 요청시간)이 남은 시간 안에 들어올 때만 한다.
 *  이 셋이 없으면 269초에 시작한 요청이 재시도까지 붙어 390초가 되고,
 *  플랫폼이 함수를 강제 종료해 **그 주 수집 결과가 DB 저장 전에 통째로 사라진다.**
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지).
 */

import { AttemptBudgetExhaustedError, type AttemptBudget } from './attempts.ts';

/** 재시도할 가치가 있는 상태코드 — 일시적 과부하·레이트리밋만 */
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Retry-After 헤더를 존중하되 대기 상한을 둔다(전체 실행 시간 방어) */
const MAX_RETRY_DELAY_MS = 5_000;
const BASE_RETRY_DELAY_MS = 800;

/** 재시도를 시작하려면 최소 이만큼의 시간은 남아 있어야 한다 */
export const MIN_RETRY_WINDOW_MS = 5_000;
/** 이보다 적게 남았으면 요청 자체를 시작하지 않는다 */
export const MIN_REQUEST_WINDOW_MS = 1_000;

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
  /** Date.now() 기준 절대 데드라인. 지정하면 타임아웃·재시도가 여기에 맞춰 좁혀진다 */
  readonly deadlineAt?: number;
  /** 실행 전체를 중단시키는 공통 시그널 (데드라인 도달 시 abort) */
  readonly signal?: AbortSignal;
  /** 실제 HTTP 시도 수 상한 — 재시도를 포함한 비용 상한의 정본 */
  readonly attemptBudget?: AttemptBudget;
  readonly now?: () => number;
  readonly sleepImpl?: (ms: number) => Promise<void>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null, now: () => number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  }
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(at - now(), 0), MAX_RETRY_DELAY_MS);
}

/** 1회 시도 결과 — 성공 / 재시도 가능 실패 / 재시도 불가 실패 */
type AttemptOutcome =
  | { readonly kind: 'ok'; readonly data: unknown }
  | { readonly kind: 'retry'; readonly reason: string; readonly delayMs: number }
  | { readonly kind: 'fatal'; readonly reason: string };

/**
 * 타임아웃 컨트롤러 + 외부 시그널 결합.
 * AbortSignal.any 는 런타임 버전에 따라 없을 수 있어 수동으로 연결한다.
 */
function createAttemptController(
  timeoutMs: number,
  external?: AbortSignal,
): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }

  return {
    controller,
    dispose: () => {
      clearTimeout(timer);
      if (external) external.removeEventListener('abort', onExternalAbort);
    },
  };
}

async function attemptPostJson(
  options: PostJsonOptions,
  attempt: number,
  timeoutMs: number,
  now: () => number,
): Promise<AttemptOutcome> {
  const { controller, dispose } = createAttemptController(timeoutMs, options.signal);
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
    const delayMs = parseRetryAfterMs(res.headers.get('retry-after'), now) ?? BASE_RETRY_DELAY_MS * attempt;
    return { kind: 'retry', reason, delayMs };
  } catch (e) {
    // 공통 시그널로 중단된 경우는 재시도해도 의미가 없다 → fatal
    if (options.signal?.aborted) {
      return { kind: 'fatal', reason: `${options.label} 중단: 실행 데드라인 도달로 요청이 취소되었습니다.` };
    }
    // 네트워크 오류·타임아웃(Abort)·JSON 파싱 실패는 일시적일 수 있어 재시도 대상
    const message = e instanceof Error ? e.message : String(e);
    return {
      kind: 'retry',
      reason: `${options.label} 네트워크 오류: ${message.slice(0, 300)}`,
      delayMs: BASE_RETRY_DELAY_MS * attempt,
    };
  } finally {
    dispose();
  }
}

/**
 * JSON POST 를 데드라인·재시도·시도 예산과 함께 수행하고 파싱된 body 를 반환한다.
 * 실패 시 throw (사유 문자열 포함) — 호출부가 엔진 단위로 격리한다.
 */
export async function postJsonWithRetry(options: PostJsonOptions): Promise<unknown> {
  const attempts = Math.max(1, options.maxAttempts);
  const now = options.now ?? Date.now;
  const doSleep = options.sleepImpl ?? sleep;
  const budget = options.attemptBudget;
  let lastReason = `${options.label} 요청 실패`;

  /** 데드라인이 없으면 Infinity — 남은 시간 계산을 단일 경로로 유지 */
  const remainingMs = (): number =>
    options.deadlineAt === undefined ? Number.POSITIVE_INFINITY : options.deadlineAt - now();

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) {
      throw new Error(`${options.label} 중단: 실행 데드라인 도달.`);
    }

    // ① 요청 타임아웃을 남은 데드라인으로 좁힌다
    const left = remainingMs();
    if (left < MIN_REQUEST_WINDOW_MS) {
      throw new Error(`${options.label} 중단: 실행 데드라인까지 남은 시간이 부족합니다.`);
    }
    const timeoutMs = Math.min(options.timeoutMs, left);

    // ② 재시도를 포함한 실제 HTTP 시도 수를 비용 상한에 반영
    if (budget && !budget.tryConsume()) {
      throw new AttemptBudgetExhaustedError(options.label, budget.limit);
    }

    const outcome = await attemptPostJson(options, attempt, timeoutMs, now);
    if (outcome.kind === 'ok') return outcome.data;
    if (outcome.kind === 'fatal') throw new Error(outcome.reason);

    lastReason = outcome.reason;
    if (attempt === attempts) break;

    // ③ 대기 + 최소 요청 시간이 남은 시간 안에 들어올 때만 재시도
    if (remainingMs() < outcome.delayMs + MIN_RETRY_WINDOW_MS) {
      lastReason = `${outcome.reason} (데드라인 임박으로 재시도 생략)`;
      break;
    }
    if (budget && budget.remaining() === 0) {
      lastReason = `${outcome.reason} (HTTP 시도 예산 소진으로 재시도 생략)`;
      break;
    }
    await doSleep(outcome.delayMs);
  }

  throw new Error(lastReason);
}
