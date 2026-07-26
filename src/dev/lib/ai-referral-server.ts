/**
 * AI 유입 집계 — 서버 적재 헬퍼 (service role RPC 호출).
 *
 * funnel-server.ts 와 동일한 계약: **절대 throw 하지 않는다.** 계측 실패가
 * 방문자 화면이나 다른 기능을 깨서는 안 된다. 마이그 051 미적용 환경(테이블·함수
 * 없음)에서도 조용히 no-op 한다.
 *
 * ★ 개인정보: 여기서 DB 로 나가는 값은 buildAiReferralRecord() 가 만든 4개 필드가
 *   전부다 (병원 slug · 출처 · 글 id · KST 일자). IP·UA·쿠키는 인자로 받지도 않는다.
 */

import { createAdminClient } from '@/dev/lib/supabase/server';
import {
  buildAiReferralRecord,
  isMissingSchemaErrorCode,
  type AiReferralBeacon,
} from '@/content/lib/ai-referral/request';

/**
 * 검증 완료된 비콘 1건을 일자별 집계에 반영한다.
 * 성공 여부를 boolean 으로 돌려주지만(테스트·로깅용) 실패해도 throw 하지 않는다.
 */
export async function recordAiReferralVisit(
  beacon: AiReferralBeacon,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const args = buildAiReferralRecord(beacon, now);
    const admin = createAdminClient();
    const { error } = await admin.rpc('record_clinic_ai_referral', args);
    if (error) {
      // 마이그 051 미적용(테이블·함수 없음)은 정상 상태로 간주하고 조용히 넘어간다.
      if (process.env.NODE_ENV === 'development' && !isMissingSchemaErrorCode(error.code)) {
        console.warn('[ai-referral] 집계 실패:', error.message);
      }
      return false;
    }
    return true;
  } catch {
    // createAdminClient 실패(env 미설정) 등 — 계측은 부가 기능이므로 조용히 무시
    return false;
  }
}
