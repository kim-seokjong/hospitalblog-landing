/**
 * 실제 HTTP 시도 횟수 예산 (비용 상한의 정본).
 *
 * 왜 필요한가:
 *   "논리 호출 수" 상한만 두면 재시도가 상한 밖에 있게 된다. 논리 호출 1건이
 *   최대 2회 HTTP 요청을 보내므로 상한 300이 실제로는 최대 600 요청 = 비용 2배가 된다.
 *   외부 API 는 재시도든 아니든 요청 단위로 과금되므로, 비용 상한은
 *   **실제 HTTP 시도 수**에 걸어야 의미가 있다.
 *
 * 원자성: 자바스크립트는 단일 스레드라 tryConsume 안의 "검사 후 증가"가
 *   동기 블록으로 실행된다. await 없이 끝나므로 동시 실행 워커 사이에서도
 *   중간 끼어들기가 없다(경쟁 조건 없음).
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지).
 */

export interface AttemptBudget {
  /** 1회 시도를 예약한다. 예산이 남아 있으면 카운터를 올리고 true. */
  tryConsume(): boolean;
  /** 지금까지 실제로 발생한 HTTP 시도 수 */
  used(): number;
  remaining(): number;
  readonly limit: number;
}

export function createAttemptBudget(limit: number): AttemptBudget {
  const max = Math.max(0, limit);
  let used = 0;

  return {
    limit: max,
    tryConsume(): boolean {
      if (used >= max) return false;
      used++;
      return true;
    },
    used: () => used,
    remaining: () => Math.max(0, max - used),
  };
}

/**
 * 부모 예산에 위임하면서 자기 소비량만 따로 세는 자식 예산.
 *
 * 엔진별 시도 수를 "공용 카운터의 전후 차이"로 계산하면 동시 실행 중인
 * 다른 엔진의 소비가 섞여 들어가 과다 집계된다(엔진 A의 delta 안에 B의 소비가 포함).
 * 소비 시점에 자기 카운터를 함께 올려야 정확하다.
 * 상한 판정은 부모가 단독으로 하므로 전체 상한은 그대로 지켜진다.
 */
export function createChildBudget(parent: AttemptBudget): AttemptBudget {
  let used = 0;
  return {
    limit: parent.limit,
    tryConsume(): boolean {
      if (!parent.tryConsume()) return false;
      used++;
      return true;
    },
    used: () => used,
    remaining: () => parent.remaining(),
  };
}

/** 예산 소진 시 던지는 에러 — 재시도 대상이 아님을 호출부가 구분할 수 있게 한다 */
export class AttemptBudgetExhaustedError extends Error {
  constructor(label: string, limit: number) {
    super(`${label} 중단: 이번 실행 HTTP 시도 상한(${limit})을 소진했습니다.`);
    this.name = 'AttemptBudgetExhaustedError';
  }
}
