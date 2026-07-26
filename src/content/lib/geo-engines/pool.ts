/**
 * 데드라인이 있는 소규모 워커 풀.
 *
 * 구 코드는 질의 사이 고정 sleep(THROTTLE_MS=500) 만 두고 전부 직렬 실행했다.
 * 엔진이 3종으로 늘면 직렬 실행으로는 maxDuration(300초) 안에 몇 명 처리하지 못한다.
 * 엔진마다 레이트리밋이 다르므로 동시 실행 수·최소 간격을 엔진별로 준다.
 *
 * 데드라인을 넘으면 남은 작업은 실행하지 않고 skipped 로 보고한다(침묵 실패 금지).
 * worker 가 throw 해도 풀은 멈추지 않는다 — 실패 격리는 호출부 책임이지만
 * 여기서도 한 번 더 막아 한 엔진의 예외가 전체를 중단시키지 않게 한다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지).
 */

// throttle 대기와 재시도 backoff 는 같은 취소 규칙을 따라야 하므로
// abortableSleep 구현을 http.ts 하나로 통일한다(구현이 갈리면 한쪽만 새기 시작한다).
import { abortableSleep } from './http.ts';

export interface PoolOptions {
  /** 동시에 실행할 작업 수 (최소 1) */
  readonly concurrency: number;
  /** 같은 워커가 다음 작업을 시작하기 전 최소 대기 (레이트리밋 방어) */
  readonly minIntervalMs: number;
  /** 이 시각(Date.now() 기준 ms)을 넘으면 새 작업을 시작하지 않는다 */
  readonly deadlineAt: number;
  /**
   * 데드라인 시그널. throttle 대기도 이 시그널로 즉시 깨운다 —
   * 취소되지 않는 sleep 이 남아 있으면 데드라인 뒤로 최대 minIntervalMs 만큼 새어 나간다.
   */
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly sleepImpl?: (ms: number) => Promise<void>;
}

export interface PoolResult {
  readonly completed: number;
  /** 데드라인 초과로 시작조차 못 한 작업 수 */
  readonly skipped: number;
}

export async function runPool<T>(
  items: readonly T[],
  worker: (item: T) => Promise<void>,
  options: PoolOptions,
): Promise<PoolResult> {
  const now = options.now ?? Date.now;
  const doSleep = options.sleepImpl ?? ((ms: number) => abortableSleep(ms, options.signal));
  const concurrency = Math.max(1, Math.min(options.concurrency, items.length || 1));

  let cursor = 0;
  let completed = 0;

  async function runWorker(): Promise<void> {
    let first = true;
    for (;;) {
      if (!first && options.minIntervalMs > 0) await doSleep(options.minIntervalMs);
      first = false;

      if (options.signal?.aborted) return;
      if (now() >= options.deadlineAt) return;
      const index = cursor;
      if (index >= items.length) return;
      cursor = index + 1;

      try {
        await worker(items[index]);
      } catch {
        // worker 는 자체적으로 실패를 기록해야 한다. 여기서는 풀 중단만 막는다.
      }
      completed++;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return { completed, skipped: items.length - completed };
}
