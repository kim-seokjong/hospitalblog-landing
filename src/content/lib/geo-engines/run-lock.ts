/**
 * GEO cron 주차 단위 실행 잠금 (순수 판정 로직).
 *
 * 왜 필요한가:
 *   "이번 주 기록이 있는지 먼저 조회하고 없으면 실행" 방식은 순차 재실행만 막는다.
 *   두 인스턴스가 동시에 시작하면 둘 다 "기록 없음"을 보고 통과해(TOCTOU)
 *   외부 API 비용이 이중 발생하고 같은 주차 데이터가 중복 삽입된다.
 *
 * 해법: geo_tracking_runs(week_start primary key) 에 **외부 API 호출 전에** insert 를 시도한다.
 *   단일 insert 문은 원자적이라 동시 실행에서도 정확히 하나만 성공한다.
 *   고유키 충돌(23505) = 이미 다른 실행이 선점 → 즉시 종료.
 *
 * ★ 잠금이 "부분 저장"을 영구 고정하면 안 된다:
 *   insert 오류나 저장 데드라인 중단이 있었는데 status='done' 으로 마감하면
 *   그 주는 영원히 locked 가 되어 반쪽 데이터가 최종 결과로 확정된다.
 *   (돈은 다 쓰고 데이터는 반만 남는다)
 *   그래서 완전 성공일 때만 'done', 아니면 'failed' 로 마감하고
 *   'failed' 주차는 재실행이 가능하도록 인계 대상에 포함한다.
 *   재실행이 중복을 만들지 않는 것은 회원 단위 중복 조회(이미 저장된 회원 skip)가 보장한다.
 *
 * 이 모듈은 DB 클라이언트를 모른다 — 상태코드 해석과 마감 상태 판정만 담당해
 * 단위 테스트가 가능하게 한다. 실제 쿼리는 게이트웨이 구현이 수행한다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지).
 */

/** 고유키 위반 — 이미 같은 주차 실행 레코드가 있다 */
export const PG_UNIQUE_VIOLATION = '23505';
/** 테이블 없음 — 마이그 048 미적용 DB */
export const PG_UNDEFINED_TABLE = '42P01';

/** 실행 레코드 상태. 'failed' 는 재실행 허용을 뜻한다 */
export type RunStatus = 'running' | 'done' | 'failed';

/**
 * 실행 잠금 상태.
 *  · acquired   : 이번 실행이 주차를 선점했다 (정상 진행)
 *  · locked     : 다른 실행이 진행 중이거나 정상 완료했다 (즉시 종료 — 비용 발생 금지)
 *  · unavailable: 잠금 테이블이 없다 (마이그 048 미적용). 잠금 없이 진행하되 응답에 명시
 *  · error      : 잠금 상태를 확인할 수 없다 → 진행하지 않는다(이중 과금 방지)
 */
export type RunLockMode = 'acquired' | 'locked' | 'unavailable' | 'error';

export interface RunLockDecision {
  readonly mode: RunLockMode;
  readonly reason: string | null;
  /** 진행해도 되는가 */
  readonly proceed: boolean;
  /** 마무리(update)로 잠금을 정리해야 하는가 — unavailable/locked 는 정리할 것이 없다 */
  readonly needsFinalize: boolean;
}

export interface DbErrorLike {
  readonly code?: string;
  readonly message?: string;
}

/**
 * 잠금 insert 결과를 해석한다.
 * takenOver = 인계 가능한 잠금(stale running 또는 failed)을 실제로 인계받았는지.
 */
export function interpretLockInsert(error: DbErrorLike | null, takenOver = false): RunLockDecision {
  if (!error) return { mode: 'acquired', reason: null, proceed: true, needsFinalize: true };

  if (error.code === PG_UNIQUE_VIOLATION) {
    if (takenOver) {
      return {
        mode: 'acquired',
        reason: '이전 실행이 비정상 종료(stale) 또는 실패(failed)로 남아 있어 인계받았습니다.',
        proceed: true,
        needsFinalize: true,
      };
    }
    return {
      mode: 'locked',
      reason: '이번 주 실행이 이미 진행 중이거나 정상 완료되었습니다 (중복 실행 차단).',
      proceed: false,
      needsFinalize: false,
    };
  }

  if (error.code === PG_UNDEFINED_TABLE) {
    return {
      mode: 'unavailable',
      reason:
        'geo_tracking_runs 테이블이 없습니다 (마이그레이션 048 미적용). 잠금 없이 진행합니다 — 동시 실행이 차단되지 않습니다.',
      proceed: true,
      needsFinalize: false,
    };
  }

  // 잠금 상태를 알 수 없으면 진행하지 않는다.
  // 폴백으로 진행하면 확인 불가 상황마다 이중 과금이 날 수 있다.
  return {
    mode: 'error',
    reason: `실행 잠금 확인 실패로 중단합니다(이중 과금 방지): ${error.message ?? '알 수 없는 오류'}`,
    proceed: false,
    needsFinalize: false,
  };
}

/** stale 판정 기준 — 함수 최대 실행시간(300초)의 두 배 이상 지난 'running' 레코드 */
export const STALE_LOCK_MS = 10 * 60 * 1000;

export function staleThresholdIso(nowMs: number = Date.now()): string {
  return new Date(nowMs - STALE_LOCK_MS).toISOString();
}

/** 이번 실행이 완전 성공이었는지 판정할 재료 */
export interface RunOutcomeFlags {
  readonly preflightAborted: boolean;
  readonly queryDeadlineReached: boolean;
  readonly matchAborted: boolean;
  readonly insertAborted: boolean;
  readonly insertErrorCount: number;
  readonly usersDroppedPartialFailure: number;
  readonly usersOverQueryBudget: number;
  readonly threw: boolean;
}

/**
 * 마감 상태 판정.
 *
 * 'done' 은 "이 주는 더 할 일이 없다"는 뜻이므로 **완전 성공에만** 붙인다.
 * 저장 실패·중단은 물론, 예산/데드라인으로 빠진 회원이 있어도 'failed' 로 두어
 * 수동 재실행 시 남은 회원만 이어서 처리되게 한다
 * (이미 저장된 회원은 중복 조회에서 걸러지므로 재과금되지 않는다).
 */
export function resolveFinalStatus(flags: RunOutcomeFlags): RunStatus {
  const clean =
    !flags.preflightAborted &&
    !flags.queryDeadlineReached &&
    !flags.matchAborted &&
    !flags.insertAborted &&
    !flags.threw &&
    flags.insertErrorCount === 0 &&
    flags.usersDroppedPartialFailure === 0 &&
    flags.usersOverQueryBudget === 0;
  return clean ? 'done' : 'failed';
}
