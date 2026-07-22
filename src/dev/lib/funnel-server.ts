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
  shouldRecordOnceEvent,
  shouldRecordFirstPostEvent,
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
    const meta: SanitizedMeta = sanitizeMeta(input.meta, input.event);
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

/**
 * **계정 통산 1회만** 기록해야 하는 이벤트용 (first_post_generated 등).
 *
 * 호출부의 월 사용량 카운터(newCount===1)는 월초 리셋·유료 전환 시 다시 1이 되므로
 * "계정 첫 글" 판정으로 쓰면 전환율이 부풀려진다. 여기서 funnel_events 에 동일
 * (user_id, event) 가 이미 있는지 확인하고 없을 때만 적재한다(인덱스 조회 1회 — 저렴).
 *
 * - 조회 실패(테이블 없음 포함) 시 기록하지 않는다: 중복 기록이 미기록보다 해롭다
 *   (shouldRecordOnceEvent). 마이그 미적용 환경에선 insert 도 어차피 no-op.
 * - check-then-insert 는 비원자 — 동시 요청이 겹치면 드물게 중복 1건 가능(best-effort 수용).
 */
export async function recordFunnelEventOnce(
  input: RecordFunnelInput & { userId: string },
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from('funnel_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', input.userId)
      .eq('event', input.event);
    const priorCount = error ? null : (count ?? 0);
    if (!shouldRecordOnceEvent(priorCount)) return false;

    // 레거시 폴백: funnel_events 는 마이그 046부터 쌓이므로 "이벤트 없음 = 통산 첫 글"이
    // 아니다 — 그 이전부터 글을 만들던 기존 계정(예: 체험 중 14글)은 이벤트가 없어서
    // 월 카운터 리셋 후 허위 첫 글 이벤트가 기록된다. saved_posts 기존 행 존재를
    // head count 1회로 추가 확인해 기존 글이 있으면 기록을 생략한다(백필 마이그 대신
    // 코드 폴백 — 목적은 신규 계정 전환 측정이라 레거시 계정은 이벤트 없이 종료해도 됨).
    // 이벤트가 이미 있으면 위에서 끝나므로 이 쿼리는 상시 비용이 아니다.
    if (input.event === 'first_post_generated') {
      const { count: legacy, error: legacyErr } = await admin
        .from('saved_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', input.userId);
      const legacyCount = legacyErr ? null : (legacy ?? 0);
      if (!shouldRecordFirstPostEvent(priorCount, legacyCount)) return false;
    }

    return recordFunnelEvent(input);
  } catch {
    return false;
  }
}
