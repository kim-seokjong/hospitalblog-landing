/**
 * /admin 방문자·퍼널 집계 — 순수 로직 모듈 (외부 의존 없음, node:test 로 직접 검증 가능).
 *
 * funnel_events 원시 행(이벤트·anon_id·user_id·created_at)을 받아 KST 기준으로
 * 집계한다. DB 조회(service role)는 src/dev/lib/funnel-admin-server.ts 가 담당하고,
 * 화면 표시는 src/components/admin/FunnelPanel.tsx 가 담당한다.
 *
 * 날짜 귀속은 전부 KST(UTC+9) — funnel-events.ts 의 funnelKstDayKey 와 동일 기준.
 */

import { FUNNEL_EVENTS, isFunnelEvent, funnelKstDayKey, type FunnelEvent } from './funnel-events.ts';

/** 일별 방문자 추이 창 (일). */
export const FUNNEL_DAILY_WINDOW_DAYS = 14;
/** 퍼널 단계 집계 창 (일). */
export const FUNNEL_WEEKLY_WINDOW_DAYS = 7;
/** 측정 시작일(마이그 046 배포) — 이전 구간 데이터가 없다는 빈 상태 안내용. */
export const FUNNEL_MEASUREMENT_START = '2026-07-22';

const DAY_MS = 24 * 60 * 60 * 1000;

/** funnel_events 조회 행 (집계에 필요한 컬럼만). event 는 DB 원시값 — 화이트리스트 외 값은 무시된다. */
export interface FunnelStatRow {
  event: string;
  anon_id: string | null;
  user_id: string | null;
  created_at: string;
}

export interface FunnelDailyPoint {
  /** yyyy-mm-dd (KST) */
  day: string;
  /** 차트 축 라벨 (M/D) */
  label: string;
  /** 고유 방문자 수 (anon_id 기준) */
  visitors: number;
  /** landing_view 이벤트 수 */
  views: number;
}

export interface FunnelStageCount {
  stage: FunnelEvent;
  label: string;
  /** 고유 주체 수 (user_id 우선, 없으면 anon_id) */
  count: number;
}

export interface FunnelStats {
  /** 오늘(KST) 고유 방문자 — landing_view 의 고유 anon_id */
  todayVisitors: number;
  /** 오늘(KST) 방문 수 — landing_view 이벤트 수 */
  todayViews: number;
  /** 최근 14일 일별 방문자 추이 (과거→오늘 순) */
  daily: FunnelDailyPoint[];
  /** 최근 7일 퍼널 단계별 고유 카운트 (FUNNEL_EVENTS 순서 = 방문→진단 4단계→가입시작→가입완료→첫 글→결제) */
  weekly: FunnelStageCount[];
  /** 창(14일) 안에서 인식된 퍼널 이벤트 총수 — 0이면 빈 상태 */
  totalEvents: number;
}

/** 퍼널 단계 표시 라벨 (FUNNEL_EVENTS 순서 = 퍼널 순서). */
export const FUNNEL_STAGE_LABELS: Record<FunnelEvent, string> = {
  landing_view: '방문',
  diagnosis_input_start: '진단 입력',
  diagnosis_submit: '진단 제출',
  diagnosis_run: '진단 실행',
  diagnosis_report_view: '진단 결과',
  diagnosis_email_submitted: '진단 메일 신청',
  diagnosis_cta_view: '진단 CTA 노출',
  diagnosis_cta_click: '진단 CTA 클릭',
  pricing_view: '요금 확인',
  signup_start: '가입 시작',
  signup_complete: '가입 완료',
  first_post_generated: '첫 글 생성',
  payment_success: '결제',
};

/**
 * 조회 시작점 — 오늘(KST) 포함 days 일 창의 첫 날 KST 자정을 UTC ISO 로 반환.
 * DB created_at(timestamptz) gte 필터에 그대로 쓴다. KST 는 DST 가 없어 고정 오프셋 안전.
 */
export function funnelWindowStartUtcIso(
  now: number = Date.now(),
  days: number = FUNNEL_DAILY_WINDOW_DAYS,
): string {
  const firstDay = funnelKstDayKey(now - (days - 1) * DAY_MS);
  return new Date(`${firstDay}T00:00:00+09:00`).toISOString();
}

/**
 * 퍼널 단계의 고유 주체 키 — 로그인 이벤트는 user_id, 익명 이벤트는 anon_id.
 * 접두사로 두 네임스페이스 충돌을 막는다. 둘 다 없으면 null(고유 집계에서 제외).
 */
function subjectKey(row: FunnelStatRow): string | null {
  if (row.user_id) return `u:${row.user_id}`;
  if (row.anon_id) return `a:${row.anon_id}`;
  return null;
}

/**
 * funnel_events 행들을 KST 기준으로 집계한다 (순수 함수 — now 주입 가능).
 *
 * - 일별 방문자: landing_view 의 **고유 anon_id** (anon_id 없는 행은 방문 수에만 포함)
 * - 주간 퍼널: 최근 7일(KST) 각 단계의 **고유 주체**(user_id 우선, 없으면 anon_id) —
 *   단계별 독립 dedup 이라 익명→가입 전환 시 주체 키가 바뀌는 한계는 수용(자체 계측 근사치)
 * - 창 밖·미래·파싱 불가·화이트리스트 외 이벤트는 조용히 무시 (지표 오염 방지)
 */
export function aggregateFunnelStats(
  rows: readonly FunnelStatRow[],
  now: number = Date.now(),
): FunnelStats {
  const dayKeys: string[] = [];
  for (let i = FUNNEL_DAILY_WINDOW_DAYS - 1; i >= 0; i -= 1) {
    dayKeys.push(funnelKstDayKey(now - i * DAY_MS));
  }
  const dayIndex = new Map<string, number>(dayKeys.map((d, i) => [d, i]));
  const weeklyDays = new Set(dayKeys.slice(-FUNNEL_WEEKLY_WINDOW_DAYS));

  const visitorsPerDay: Array<Set<string>> = dayKeys.map(() => new Set());
  const viewsPerDay: number[] = dayKeys.map(() => 0);
  const weeklySubjects = new Map<FunnelEvent, Set<string>>(
    FUNNEL_EVENTS.map((e) => [e, new Set<string>()]),
  );
  let totalEvents = 0;

  for (const row of rows) {
    if (!isFunnelEvent(row.event)) continue;
    const ts = Date.parse(row.created_at);
    if (!Number.isFinite(ts)) continue;
    const day = funnelKstDayKey(ts);
    const idx = dayIndex.get(day);
    if (idx === undefined) continue; // 창 밖(과거·미래) 이벤트 무시

    totalEvents += 1;

    if (row.event === 'landing_view') {
      viewsPerDay[idx] += 1;
      if (row.anon_id) visitorsPerDay[idx].add(row.anon_id);
    }

    if (weeklyDays.has(day)) {
      const key = subjectKey(row);
      if (key) weeklySubjects.get(row.event)?.add(key);
    }
  }

  const daily: FunnelDailyPoint[] = dayKeys.map((day, i) => ({
    day,
    label: `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`,
    visitors: visitorsPerDay[i].size,
    views: viewsPerDay[i],
  }));

  const weekly: FunnelStageCount[] = FUNNEL_EVENTS.map((stage) => ({
    stage,
    label: FUNNEL_STAGE_LABELS[stage],
    count: weeklySubjects.get(stage)?.size ?? 0,
  }));

  const todayIdx = dayKeys.length - 1;
  return {
    todayVisitors: visitorsPerDay[todayIdx].size,
    todayViews: viewsPerDay[todayIdx],
    daily,
    weekly,
    totalEvents,
  };
}
