import {
  consumeUserQuota,
  evaluateReservation,
  kstDayRangeUtc,
} from './blog-check-limits.ts';

/**
 * 무료진단 상세분석 — 회원당 일일 상한의 DB 원자 예약 흐름 (순수 로직).
 *
 * 저장소 접근은 ReservationStore 인터페이스로 추상화한다. 실제 구현은
 * detail 라우트가 **service-role 클라이언트**로 만든다:
 * - 예약 행(INSERT·COUNT·상태 전이 UPDATE)은 서버 전용 북키핑이며, user_id 는
 *   항상 서버 세션(auth.getUser)에서 오고 클라이언트 입력이 아니다. 따라서
 *   리드 백필(임의 blogId 입력으로 남의 리드를 귀속시킬 수 있어 제거)과 달리
 *   service-role 사용이 귀속 조작 여지를 만들지 않는다.
 * - 클라이언트(anon) 경로에는 update 정책 자체가 없어 run_at/status/results
 *   조작으로 캡을 우회할 수 없다 (마이그 045 참조).
 *
 * 흐름: ①예약 행 INSERT(pending) → ②오늘(KST) 본인 행 COUNT(자기 행 포함,
 * status 무관 — 실패도 소비=안전측) → ③초과면 자기 예약 행 'failed' 전이 후
 * denied. insert-then-count 라 동시 N요청도 "한도+ε" 바운드(evaluateReservation).
 * 저장소 사용 불가(테이블 미적용·service key 없음)면 인메모리 폴백.
 */

export type DetailReservation =
  | { mode: 'db'; id: string }
  | { mode: 'memory' }
  | { mode: 'denied'; limit: number };

/** 예약 저장소 추상화 — 실패는 null/false 로 표현하고 절대 throw 하지 않는다. */
export interface ReservationStore {
  /** 예약 행 INSERT(status='pending'). 성공 시 행 id, 실패(테이블 미적용 포함) 시 null. */
  insertPending(userId: string, blogId: string): Promise<string | null>;
  /** [startIso, endIso) 구간 본인 행 수(status 무관). 실패 시 null. */
  countToday(userId: string, startIso: string, endIso: string): Promise<number | null>;
  /** 예약 행 상태 전이. done 은 results 를 함께 저장. 성공 여부 반환. */
  mark(id: string, status: 'done' | 'failed', results?: unknown): Promise<boolean>;
}

/**
 * 예약 실행. store 가 null(service key 없음)이거나 INSERT 실패면 인메모리
 * 폴백(memoryStore 원자 소비)으로 강등한다. COUNT 실패는 진행(그레이스풀
 * — 예약 행 자체가 영속 하한을 유지).
 */
export async function reserveDetailSlot(input: {
  store: ReservationStore | null;
  /** 인메모리 폴백 카운터 (blog-check-limits.consumeUserQuota 규칙). */
  memoryStore: Map<string, number>;
  userId: string;
  blogId: string;
  limit: number;
  now?: number;
}): Promise<DetailReservation> {
  const { store, memoryStore, userId, blogId, limit } = input;

  const memoryFallback = (): DetailReservation => {
    const mem = consumeUserQuota(memoryStore, { userId, limit, now: input.now });
    return mem.allowed ? { mode: 'memory' } : { mode: 'denied', limit };
  };

  if (!store) return memoryFallback();

  // ① 예약 행 INSERT
  const reservationId = await store.insertPending(userId, blogId);
  if (!reservationId) return memoryFallback();

  // ② 오늘(KST) 본인 행 수 COUNT — status 필터 없음(실패도 소비)
  const range = kstDayRangeUtc(input.now);
  const count = await store.countToday(userId, range.startIso, range.endIso);

  // ③ 초과 판정 — 초과면 자기 예약 행 'failed' 전이 후 denied
  if (evaluateReservation(count, limit) === 'over_limit') {
    await store.mark(reservationId, 'failed');
    return { mode: 'denied', limit };
  }
  return { mode: 'db', id: reservationId };
}
