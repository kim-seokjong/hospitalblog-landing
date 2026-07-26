/**
 * AI 유입 요약 — 순수 함수 (DB 집계 결과 → 화면 모델).
 *
 * 집계 자체는 DB 함수(clinic_ai_referral_summary)가 한다. 앱이 원시 행을 끌어와
 * 합산하면 행 수 상한에 걸리는 순간 통계가 조용히 잘리기 때문이다.
 * 이 모듈은 DB 가 준 jsonb(신뢰 불가 형태로 취급)를 **검증·정규화**하고,
 *  - 방문이 없는 날을 0 으로 채우고(그래프 축 고정)
 *  - 소수 셀(글별 1회)을 화면에서 숨기는 최소 집계 규칙을 적용한다.
 *
 * 데이터가 0건이거나 마이그 051 미적용이어도 항상 형태가 온전한 결과를 돌려준다.
 */

import { aiReferralSourceLabel } from './sources.ts';

/** 마이페이지 기본 조회 창 (일). */
export const AI_REFERRAL_WINDOW_DAYS = 30;
/** 상위 글 표시 개수. */
export const AI_REFERRAL_TOP_POSTS = 5;

/**
 * 글별 최소 표시 집계치 (k-익명성 성격의 완충).
 *
 * 병원이 특정 환자에게만 안내한 글의 방문이 1이면 "그 사람이 봤다"는 추론이
 * 이론상 가능하다. AI 유입은 정의상 공개된 AI 답변을 거쳐 들어온 트래픽이라
 * 그 시나리오와는 거리가 있지만, 비용이 거의 들지 않는 완충이므로 적용한다.
 * 숨긴 글은 개수·합계로만 묶어 보여줘 정보가 사라지지는 않게 한다.
 * (총합·출처별 수치는 글 단위가 아니라 영향을 받지 않는다.)
 */
export const AI_REFERRAL_MIN_POST_CELL = 2;

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
  /** 출처별 합계 — 많은 순. */
  bySource: AiReferralSourceTotal[];
  /** 일자별 합계 — 오래된 날 → 최신 날, 빈 날은 0. */
  daily: AiReferralDailyPoint[];
  /** 방문이 많은 글 (최소 집계치 이상만). */
  topPosts: AiReferralTopPost[];
  /** 블로그 홈으로 들어온 방문 수. */
  homeVisits: number;
  /** 목록에 개별 표시되지 않은 글 수 (최소 집계치 미만 + 상위 N 밖). */
  hiddenPostCount: number;
  /** 그 글들의 방문 합계. */
  hiddenPostVisits: number;
}

/** jsonb 숫자 필드를 안전하게 읽는다 (numeric 이 문자열로 와도 처리). */
function toCount(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function toRecordArray(value: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item),
  );
}

export interface NormalizeOptions {
  /** 창의 마지막 날 (KST yyyy-mm-dd). */
  endDate: string;
  windowDays?: number;
  /** 글별 최소 표시 집계치. */
  minPostCell?: number;
}

/**
 * DB 집계 결과(jsonb)를 화면 모델로 정규화한다.
 * raw 가 null·형태 불일치면 빈 요약을 돌려준다 — 마이그 미적용·0건과 같은 결과다.
 */
export function normalizeAiReferralSummary(
  raw: unknown,
  options: NormalizeOptions,
): AiReferralSummary {
  const windowDays =
    Number.isFinite(options.windowDays) && (options.windowDays ?? 0) > 0
      ? Math.floor(options.windowDays as number)
      : AI_REFERRAL_WINDOW_DAYS;
  const minPostCell =
    Number.isFinite(options.minPostCell) && (options.minPostCell ?? 0) > 0
      ? Math.floor(options.minPostCell as number)
      : AI_REFERRAL_MIN_POST_CELL;
  const endDate = DATE_KEY_RE.test(options.endDate)
    ? options.endDate
    : new Date().toISOString().slice(0, 10);
  const startDate = aiReferralWindowStart(endDate, windowDays);

  // 창 전체를 0 으로 채운 뒤 DB 가 준 날짜만 덮어쓴다 (그래프 축 고정)
  const dailyMap = new Map<string, number>();
  for (let i = 0; i < windowDays; i += 1) {
    dailyMap.set(shiftDateKey(startDate, i), 0);
  }

  const payload =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  for (const item of toRecordArray(payload.daily)) {
    const date = typeof item.date === 'string' ? item.date.slice(0, 10) : '';
    if (!dailyMap.has(date)) continue; // 창 밖·형식 오류는 버린다
    dailyMap.set(date, toCount(item.visits));
  }

  const bySource: AiReferralSourceTotal[] = toRecordArray(payload.by_source)
    .map((item) => {
      const source = typeof item.source === 'string' && item.source.length > 0
        ? item.source
        : 'unknown';
      return { source, label: aiReferralSourceLabel(source), visits: toCount(item.visits) };
    })
    .filter((s) => s.visits > 0)
    .sort((a, b) => (b.visits - a.visits) || a.source.localeCompare(b.source));

  const allPosts: AiReferralTopPost[] = toRecordArray(payload.top_posts)
    .map((item) => ({
      postId: typeof item.post_id === 'string' ? item.post_id : '',
      title: typeof item.title === 'string' ? item.title : '',
      visits: toCount(item.visits),
    }))
    .filter((p) => p.postId.length > 0 && p.visits > 0)
    .sort((a, b) => (b.visits - a.visits) || a.postId.localeCompare(b.postId));

  // 소수 셀 숨김 — 개별 표시는 최소 집계치 이상만, 나머지는 묶어서 개수·합계로.
  const topPosts = allPosts.filter((p) => p.visits >= minPostCell);
  const shownVisits = topPosts.reduce((sum, p) => sum + p.visits, 0);
  const postVisits = toCount(payload.post_visits);
  const postCount = toCount(payload.post_count);

  const hiddenPostVisits = Math.max(0, postVisits - shownVisits);
  const hiddenPostCount = Math.max(0, postCount - topPosts.length);

  return {
    windowDays,
    endDate,
    totalVisits: toCount(payload.total_visits),
    homeVisits: toCount(payload.home_visits),
    bySource,
    daily: Array.from(dailyMap.entries())
      .map(([date, visits]) => ({ date, visits }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    topPosts,
    hiddenPostCount,
    hiddenPostVisits,
  };
}

/** 빈 요약 — 데이터 0건·마이그 미적용 시 화면이 이 값으로 정상 렌더된다. */
export function emptyAiReferralSummary(
  endDate: string,
  windowDays: number = AI_REFERRAL_WINDOW_DAYS,
): AiReferralSummary {
  return normalizeAiReferralSummary(null, { endDate, windowDays });
}
