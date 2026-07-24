/**
 * /admin 방문자·퍼널 — funnel_events 조회 헬퍼 (service role, 서버 전용).
 *
 * /admin 페이지(서버 컴포넌트, isAdmin 게이트 통과 후)에서만 호출한다 —
 * 새 공개 엔드포인트 없음. 읽기 전용이며 실패해도 throw 하지 않는다:
 * 퍼널 카드는 부가 지표라 조회 실패가 대시보드 전체를 깨면 안 된다.
 */

import { createAdminClient } from '@/dev/lib/supabase/server';
import {
  FUNNEL_DAILY_WINDOW_DAYS,
  funnelWindowStartUtcIso,
  type FunnelStatRow,
} from '@/content/lib/funnel-admin-stats';

/** Supabase 요청당 기본 행 상한(1000)에 맞춘 페이지 크기. */
const PAGE_SIZE = 1000;
/** 안전 상한 — 30페이지(3만 행) 초과분은 버린다(레이트리밋 전역 캡 2만/일 대비 여유). */
const MAX_PAGES = 30;

export interface FunnelRowsResult {
  /** false = 조회 실패(부분 데이터 가능성) — 화면에 안내 필요 */
  ok: boolean;
  /**
   * true = 안전 상한(MAX_PAGES)까지 전부 꽉 찬 페이지 = 뒤쪽(최신) 이벤트 누락 가능.
   * 조용한 과소 집계를 막기 위해 화면에 잘림 안내를 띄운다 (Codex 지적 반영).
   */
  truncated: boolean;
  rows: FunnelStatRow[];
}

/**
 * 최근 14일(KST 창) funnel_events 를 페이지네이션으로 전량 조회한다.
 * - 마이그 046 미적용(42P01) = 정상 빈 상태로 간주
 * - 그 외 실패 = ok:false 반환 (throw 안 함, 서버 로그만)
 * - 상한(3만 행) 도달 = truncated:true (부분 집계임을 화면에 표시)
 *
 * ⚠️ 한계(수용): offset 페이지네이션이라 조회 중 동시 insert 시 소량 중복/누락 가능,
 * 프로젝트 PostgREST max_rows 가 1000 미만으로 낮춰지면 조기 종료됨(현 프로젝트 기본 1000).
 * 트래픽이 커지면 DB 집계(RPC)로 교체한다 — 현 단계 과설계 금지.
 */
export async function fetchFunnelStatRows(now: number = Date.now()): Promise<FunnelRowsResult> {
  try {
    const admin = createAdminClient();
    const since = funnelWindowStartUtcIso(now, FUNNEL_DAILY_WINDOW_DAYS);
    const rows: FunnelStatRow[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { data, error } = await admin
        .from('funnel_events')
        .select('event,anon_id,user_id,created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) {
        // 테이블 없음(마이그 미적용) = 데이터 없음(정상 빈 상태)
        if (error.code === '42P01') return { ok: true, truncated: false, rows: [] };
        console.error('[admin funnel] funnel_events 조회 실패:', error.message);
        return { ok: false, truncated: false, rows: [] };
      }

      const batch = (data ?? []) as FunnelStatRow[];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) return { ok: true, truncated: false, rows };
    }

    // MAX_PAGES 전부 꽉 참 → 이후 행 존재 가능성 높음 = 부분 집계
    console.warn(`[admin funnel] 조회 상한 도달(${MAX_PAGES * PAGE_SIZE}행) — 부분 집계로 표시`);
    return { ok: true, truncated: true, rows };
  } catch (e) {
    console.error(
      '[admin funnel] funnel_events 조회 실패:',
      e instanceof Error ? e.message : String(e),
    );
    return { ok: false, truncated: false, rows: [] };
  }
}
