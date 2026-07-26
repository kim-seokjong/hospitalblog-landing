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
}

/** 마이그 052 미적용 환경용 행 (구 스키마 컬럼만). */
export type RankingRowLegacy = Pick<
  RankingRowFull,
  'user_id' | 'post_id' | 'keyword' | 'target_site' | 'rank'
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
    rank: input.status === 'ok' ? input.rank : null,
    status: input.status,
    scanned_depth: Math.max(0, Math.floor(input.scannedDepth)),
    error_code: input.errorCode ?? null,
    checked_on: input.checkedOn ?? kstDateString(),
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
  };
}

interface PostgrestErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * 마이그 052 미적용 신호인가?
 *  42703      undefined_column     (status/scanned_depth/... 없음)
 *  42P01      undefined_table
 *  42P10      invalid_column_reference — ON CONFLICT 에 맞는 유니크 제약 없음
 *  PGRST204   PostgREST 스키마 캐시에 컬럼 없음
 *  PGRST102   요청 본문 파싱/컬럼 불일치
 */
export function isMissingRankingSchema(error: PostgrestErrorLike | null | undefined): boolean {
  if (!error) return false;
  const code = typeof error.code === 'string' ? error.code : '';
  if (code === '42703' || code === '42P01' || code === '42P10') return true;
  if (code === 'PGRST204' || code === 'PGRST102') return true;
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  if (!message) return false;
  return (
    message.includes('no unique or exclusion constraint') ||
    message.includes('could not find the') ||
    message.includes('column') && message.includes('does not exist')
  );
}
