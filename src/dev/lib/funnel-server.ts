/**
 * 자체 퍼널 이벤트 — 서버 적재 헬퍼 (service role insert).
 *
 * 공개 엔드포인트(/api/funnel-event)와 서버 라우트(generate-content·billing confirm 등)가
 * 공통으로 쓴다. 절대 throw 하지 않는다 — 계측 실패가 본 기능(글 생성·결제)을 깨면 안 된다.
 * 마이그 046 미적용 환경(테이블 없음)에서도 조용히 no-op 한다(그레이스풀).
 */

import { createAdminClient } from '@/dev/lib/supabase/server';
import {
  type FunnelEvent,
  type SanitizedMeta,
  sanitizeMeta,
} from '@/content/lib/funnel-events';

export interface RecordFunnelInput {
  event: FunnelEvent;
  userId?: string | null;
  anonId?: string | null;
  /** 원시 meta — 내부에서 새니타이즈한다(호출부가 신뢰 불가 값을 넘겨도 안전). */
  meta?: unknown;
}

/**
 * 퍼널 이벤트 1건을 적재한다. 성공 여부를 boolean 으로 반환(로깅용) — 실패해도 throw 안 함.
 * 이미 화이트리스트 검증된 event 만 넘어온다는 전제(호출부에서 validateFunnelBody 또는
 * 리터럴 FunnelEvent 사용). meta 는 방어적으로 다시 새니타이즈한다.
 */
export async function recordFunnelEvent(input: RecordFunnelInput): Promise<boolean> {
  try {
    const meta: SanitizedMeta = sanitizeMeta(input.meta);
    const admin = createAdminClient();
    const { error } = await admin.from('funnel_events').insert({
      event: input.event,
      user_id: input.userId ?? null,
      anon_id: input.anonId ?? null,
      meta,
    });
    if (error) {
      // 42P01 = undefined_table (마이그 미적용) → 조용히 무시. 그 외도 계측이므로 승격 금지.
      if (process.env.NODE_ENV === 'development' && error.code !== '42P01') {
        console.warn('[funnel] insert 실패:', error.message);
      }
      return false;
    }
    return true;
  } catch {
    // createAdminClient 실패(env 미설정) 등 — 계측은 부가 기능이므로 조용히 무시
    return false;
  }
}
