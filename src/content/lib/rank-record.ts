/**
 * post_rankings 기록 행 조립 + 스키마 미적용 폴백 판정 (순수).
 *
 * 마이그 052 는 사람이 Supabase SQL Editor 에서 수동 적용한다.
 * 적용 전에도 cron 이 죽으면 안 되므로, 새 컬럼(status/scanned_depth/error_code/checked_on)
 * 과 UPSERT(유니크 인덱스)를 쓰다 실패하면 구 스키마로 자동 폴백한다.
 * (기존 42703/42P01 폴백 패턴과 동일)
 */

import type { RankScanStatus } from './rank-scan.ts';

/** KST 기준 날짜 (YYYY-MM-DD) — 1일 1행 UPSERT 키. */
export function kstDateString(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export interface RankingRowInput {
  userId: string;
  postId: string;
  keyword: string;
  targetSite: string | null;
  status: RankScanStatus;
  rank: number | null;
  scannedDepth: number;
  errorCode?: string;
  checkedOn?: string;
  checkedAt?: string;
}

/** 마이그 052 적용 후 스키마용 행 (UPSERT 대상). */
export interface RankingRowFull {
  user_id: string;
  post_id: string;
  keyword: string;
  target_site: string;
  rank: number | null;
  status: RankScanStatus;
  scanned_depth: number;
  error_code: string | null;
  checked_on: string;
  /**
   * ★ UPSERT 갱신 시에도 측정 시각이 최신이 되도록 명시적으로 넣는다.
   *   DB default(now())는 INSERT 에만 걸려, 같은 날 재실행하면 최초 시각이 그대로 남는다.
   */
  checked_at: string;
}

/** 마이그 052 미적용 환경용 행 (구 스키마 컬럼만). */
export type RankingRowLegacy = Pick<
  RankingRowFull,
  'user_id' | 'post_id' | 'keyword' | 'target_site' | 'rank' | 'checked_at'
>;

/**
 * ★ rank 는 status==='ok' 일 때만 숫자다.
 *   실패/모호일 때 rank 에 값이 들어가면 다시 "실패=100위 밖" 혼동이 생긴다.
 */
export function buildRankingRow(input: RankingRowInput): RankingRowFull {
  return {
    user_id: input.userId,
    post_id: input.postId,
    keyword: input.keyword,
    // target_site 는 유니크 인덱스 구성요소 — NULL 이면 충돌 판정이 안 되므로 항상 채운다
    target_site: input.targetSite ?? 'naver',
    // ★ status='ok' 인데 rank 가 없으면 "측정은 됐는데 순위가 없다"는 모순이다.
    //   그런 입력은 failed 로 강등한다 (마이그 052 의 CHECK 제약과 동일한 규칙).
    rank: input.status === 'ok' && typeof input.rank === 'number' && Number.isFinite(input.rank)
      ? input.rank
      : null,
    status:
      input.status === 'ok' && !(typeof input.rank === 'number' && Number.isFinite(input.rank))
        ? 'failed'
        : input.status,
    scanned_depth: Number.isFinite(input.scannedDepth)
      ? Math.max(0, Math.floor(input.scannedDepth))
      : 0,
    error_code:
      input.errorCode ??
      (input.status === 'ok' && !(typeof input.rank === 'number' && Number.isFinite(input.rank))
        ? 'invalid_rank'
        : null),
    checked_on: input.checkedOn ?? kstDateString(),
    checked_at: input.checkedAt ?? new Date().toISOString(),
  };
}

/** UPSERT 충돌 대상 컬럼 (마이그 052 의 uq_post_rankings_daily 와 일치해야 한다). */
export const RANKING_CONFLICT_TARGET = 'post_id,keyword,target_site,checked_on';

export function toLegacyRow(row: RankingRowFull): RankingRowLegacy {
  return {
    user_id: row.user_id,
    post_id: row.post_id,
    keyword: row.keyword,
    target_site: row.target_site,
    rank: row.rank,
    checked_at: row.checked_at,
  };
}

interface PostgrestErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * 마이그 052 미적용 신호인가?
 *
 *  42703      undefined_column — status/scanned_depth/... 컬럼 없음
 *  42P01      undefined_table
 *  42P10      invalid_column_reference — ON CONFLICT 에 맞는 유니크 인덱스 없음
 *  PGRST204   PostgREST 스키마 캐시에 컬럼 없음
 *
 * ★ 일부러 좁게 잡는다. 넓게 잡으면 진짜 프로그래밍 오류(잘못된 본문, 권한,
 *   제약 위반)까지 구 스키마 폴백으로 우회해 측정 상태를 잃는다.
 *   - PGRST102(본문 파싱 오류)는 스키마 문제가 아니라 코드 버그 신호라 제외한다.
 *   - 'could not find the ...' 같은 자유 문구도 관계·함수 오류까지 삼켜서 제외한다.
 *   - 제약 위반(23xxx)은 절대 폴백 대상이 아니다.
 */
export function isMissingRankingSchema(error: PostgrestErrorLike | null | undefined): boolean {
  if (!error) return false;
  const code = typeof error.code === 'string' ? error.code : '';
  if (code === '42703' || code === '42P01' || code === '42P10' || code === 'PGRST204') return true;
  if (code) return false; // 코드가 있는데 위 목록이 아니면 다른 오류다
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  if (!message) return false;
  return (
    message.includes('no unique or exclusion constraint') ||
    (message.includes('column') && message.includes('does not exist'))
  );
}
