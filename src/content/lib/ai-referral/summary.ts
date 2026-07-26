/**
 * AI 유입 집계 — 순수 함수 (DB row → 화면 모델).
 *
 * 입력은 이미 일자별로 집계된 행(clinic_ai_referrals)이다. 여기서는 기간 창을
 * 자르고 출처별·일자별·글별로 다시 굴린다. 데이터가 0건이어도 항상 형태가
 * 온전한 결과를 돌려준다(마이그 미적용·신규 병원 = 정상 상태).
 */

import { aiReferralSourceLabel } from './sources.ts';

/** 마이페이지 기본 조회 창 (일). */
export const AI_REFERRAL_WINDOW_DAYS = 30;
/** 상위 글 표시 개수. */
export const AI_REFERRAL_TOP_POSTS = 5;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** yyyy-mm-dd 를 UTC 자정 epoch 로. 형식이 아니면 null. */
function dateKeyToEpoch(dateKey: string): number | null {
  if (!DATE_KEY_RE.test(dateKey)) return null;
  const epoch = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isNaN(epoch) ? null : epoch;
}

/** yyyy-mm-dd 에 일수를 더한 yyyy-mm-dd. 형식이 아니면 입력 그대로 반환. */
export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const epoch = dateKeyToEpoch(dateKey);
  if (epoch === null) return dateKey;
  return new Date(epoch + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 조회 창의 시작일(포함) — endDateKey 를 마지막 날로 하는 windowDays 일 구간.
 * 예: end=2026-07-26, days=30 → 2026-06-27.
 */
export function aiReferralWindowStart(
  endDateKey: string,
  windowDays: number = AI_REFERRAL_WINDOW_DAYS,
): string {
  const days = Number.isFinite(windowDays) && windowDays > 0 ? Math.floor(windowDays) : 1;
  return shiftDateKey(endDateKey, -(days - 1));
}

/** DB 에서 읽어온 행 (라우트가 카멜케이스로 정규화해 넘긴다). */
export interface AiReferralDbRow {
  visitDate: string;
  source: string;
  postId: string | null;
  /** 조인된 글 제목. 글이 없거나 홈 방문이면 null. */
  postTitle: string | null;
  visits: number;
}

export interface AiReferralSourceTotal {
  source: string;
  label: string;
  visits: number;
}

export interface AiReferralDailyPoint {
  date: string;
  visits: number;
}

export interface AiReferralTopPost {
  postId: string;
  title: string;
  visits: number;
}

export interface AiReferralSummary {
  /** 집계 창 길이(일). */
  windowDays: number;
  /** 창의 마지막 날 (KST yyyy-mm-dd). */
  endDate: string;
  /** 창 안의 총 방문 수. */
  totalVisits: number;
  /** 출처별 합계 — 많은 순. 0건 출처는 넣지 않는다. */
  bySource: AiReferralSourceTotal[];
  /** 일자별 합계 — 오래된 날 → 최신 날, 빈 날은 0 으로 채운다. */
  daily: AiReferralDailyPoint[];
  /** 방문이 많은 글 상위 N (홈 방문 제외). */
  topPosts: AiReferralTopPost[];
  /** 블로그 홈으로 들어온 방문 수 (글 상세가 아닌 유입). */
  homeVisits: number;
}

/** 유효한 방문 수인지 (음수·NaN·소수 방어). */
function normalizeVisits(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/** 빈 요약 — 데이터 0건·마이그 미적용 시 화면이 이 값으로 정상 렌더된다. */
export function emptyAiReferralSummary(
  endDate: string,
  windowDays: number = AI_REFERRAL_WINDOW_DAYS,
): AiReferralSummary {
  return summarizeAiReferrals([], { endDate, windowDays });
}

export interface SummarizeOptions {
  /** 창의 마지막 날 (KST yyyy-mm-dd). */
  endDate: string;
  windowDays?: number;
  topPosts?: number;
}

/**
 * 행들을 화면 모델로 집계한다.
 * 창 밖·형식 오류 행은 조용히 버린다(부분 오염이 전체를 깨지 않게).
 */
export function summarizeAiReferrals(
  rows: readonly AiReferralDbRow[],
  options: SummarizeOptions,
): AiReferralSummary {
  const windowDays =
    Number.isFinite(options.windowDays) && (options.windowDays ?? 0) > 0
      ? Math.floor(options.windowDays as number)
      : AI_REFERRAL_WINDOW_DAYS;
  const topPostLimit =
    Number.isFinite(options.topPosts) && (options.topPosts ?? 0) > 0
      ? Math.floor(options.topPosts as number)
      : AI_REFERRAL_TOP_POSTS;

  const endDate = DATE_KEY_RE.test(options.endDate)
    ? options.endDate
    : new Date().toISOString().slice(0, 10);
  const startDate = aiReferralWindowStart(endDate, windowDays);

  const dailyMap = new Map<string, number>();
  for (let i = 0; i < windowDays; i += 1) {
    dailyMap.set(shiftDateKey(startDate, i), 0);
  }

  const sourceMap = new Map<string, number>();
  const postMap = new Map<string, { title: string; visits: number }>();
  let totalVisits = 0;
  let homeVisits = 0;

  for (const row of rows) {
    const visits = normalizeVisits(row?.visits);
    if (visits === 0) continue;
    const date = typeof row.visitDate === 'string' ? row.visitDate.slice(0, 10) : '';
    if (!dailyMap.has(date)) continue; // 창 밖 또는 형식 오류

    dailyMap.set(date, (dailyMap.get(date) ?? 0) + visits);
    totalVisits += visits;

    const source = typeof row.source === 'string' && row.source.length > 0 ? row.source : 'unknown';
    sourceMap.set(source, (sourceMap.get(source) ?? 0) + visits);

    if (typeof row.postId === 'string' && row.postId.length > 0) {
      const prev = postMap.get(row.postId);
      const title = row.postTitle ?? prev?.title ?? '';
      postMap.set(row.postId, { title, visits: (prev?.visits ?? 0) + visits });
    } else {
      homeVisits += visits;
    }
  }

  const bySource: AiReferralSourceTotal[] = Array.from(sourceMap.entries())
    .map(([source, visits]) => ({ source, label: aiReferralSourceLabel(source), visits }))
    .sort((a, b) => (b.visits - a.visits) || a.source.localeCompare(b.source));

  const daily: AiReferralDailyPoint[] = Array.from(dailyMap.entries())
    .map(([date, visits]) => ({ date, visits }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const topPosts: AiReferralTopPost[] = Array.from(postMap.entries())
    .map(([postId, v]) => ({ postId, title: v.title, visits: v.visits }))
    .sort((a, b) => (b.visits - a.visits) || a.postId.localeCompare(b.postId))
    .slice(0, topPostLimit);

  return { windowDays, endDate, totalVisits, bySource, daily, topPosts, homeVisits };
}
