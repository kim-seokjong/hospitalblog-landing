/**
 * AI 유입 집계 — 서버 DB 접근 (쓰기 RPC · 읽기 RPC).
 *
 * funnel-server.ts 와 동일한 계약: **절대 throw 하지 않는다.** 계측 실패가
 * 방문자 화면이나 마이페이지를 깨서는 안 된다. 마이그 051 미적용 환경(테이블·함수
 * 없음)에서도 조용히 no-op 한다.
 *
 * ★ 개인정보: 여기서 DB 로 나가는 값은 buildAiReferralRecord() 가 만든 4개 필드가
 *   전부다 (병원 slug · 출처 · 글 id · KST 일자). IP·UA·쿠키는 인자로 받지도 않는다.
 *
 * ★ 관측성: 모든 오류를 조용히 삼키면 "데이터가 아예 안 쌓이는데 아무도 모르는"
 *   상태가 될 수 있다. 마이그 미적용을 제외한 실제 오류는 운영 환경에서도
 *   경고를 남긴다 — 남기는 값은 **스코프 + 오류 코드 + Supabase 오류 메시지(200자
 *   절단)** 다. 메시지는 DB 가 준 문자열을 그대로 싣는다(방문자 식별자는 애초에
 *   이 경로에 존재하지 않지만, 병원 slug 같은 공개 식별자는 포함될 수 있다).
 *   같은 코드는 5분에 한 번만 남겨 로그 폭주를 막는다.
 */

import { createAdminClient, createServerSupabaseClient } from '@/dev/lib/supabase/server';
import {
  buildAiReferralRecord,
  isMissingSchemaErrorCode,
  kstDateKey,
  type AiReferralVisit,
} from '@/content/lib/ai-referral/request';
import {
  aiReferralWindowStart,
  emptyAiReferralSummary,
  normalizeAiReferralSummary,
  AI_REFERRAL_TOP_POSTS,
  AI_REFERRAL_WINDOW_DAYS,
  type AiReferralSummary,
} from '@/content/lib/ai-referral/summary';

/** 같은 오류 코드는 이 간격 안에 한 번만 경고한다 (로그 폭주 방지). */
const WARN_INTERVAL_MS = 5 * 60 * 1000;
const warnedAt = new Map<string, number>();

/**
 * 스코프 + 오류 코드 + DB 오류 메시지(200자 절단)를 남긴다.
 * 마이그 미적용은 정상 상태이므로 로그를 남기지 않는다.
 */
function warnOnce(scope: string, code: string | undefined, message: string): void {
  if (isMissingSchemaErrorCode(code)) return;
  const key = `${scope}:${code ?? 'unknown'}`;
  const now = Date.now();
  const last = warnedAt.get(key);
  if (last !== undefined && now - last < WARN_INTERVAL_MS) return;
  warnedAt.set(key, now);
  // 메시지는 길이를 제한해 로그 폭주와 예기치 못한 값 유출을 함께 막는다.
  console.warn(`[ai-referral] ${scope} 실패 (code=${code ?? 'unknown'}): ${message.slice(0, 200)}`);
}

/**
 * 검증 완료된 방문 1건을 일자별 집계에 반영한다.
 * 성공 여부를 boolean 으로 돌려주지만(호출부 로깅용) 실패해도 throw 하지 않는다.
 */
export async function recordAiReferralVisit(
  visit: AiReferralVisit,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const args = buildAiReferralRecord(visit, now);
    const admin = createAdminClient();
    const { error } = await admin.rpc('record_clinic_ai_referral', args);
    if (error) {
      warnOnce('record', error.code, error.message);
      return false;
    }
    return true;
  } catch (err) {
    // createAdminClient 실패(env 미설정) 등 — 계측은 부가 기능이므로 승격하지 않는다
    warnOnce('record', 'exception', err instanceof Error ? err.message : '알 수 없는 오류');
    return false;
  }
}

/**
 * 로그인 병원의 최근 기간 AI 유입 요약을 읽는다 (RLS 로 본인 데이터만).
 *
 * 집계는 DB 함수가 수행한다 — 앱이 원시 행을 끌어와 합산하면 행 수 상한에 걸리는
 * 순간 통계가 조용히 잘리기 때문이다(그래서 LIMIT 기반 조회를 쓰지 않는다).
 * 실패·마이그 미적용이면 빈 요약을 돌려줘 탭이 정상 렌더된다.
 */
export async function getAiReferralSummary(
  windowDays: number = AI_REFERRAL_WINDOW_DAYS,
  now: number = Date.now(),
): Promise<AiReferralSummary> {
  const endDate = kstDateKey(now);
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc('clinic_ai_referral_summary', {
      p_start: aiReferralWindowStart(endDate, windowDays),
      p_end: endDate,
      p_top_posts: AI_REFERRAL_TOP_POSTS,
    });
    if (error) {
      warnOnce('summary', error.code, error.message);
      return emptyAiReferralSummary(endDate, windowDays);
    }
    return normalizeAiReferralSummary(data, { endDate, windowDays });
  } catch (err) {
    warnOnce('summary', 'exception', err instanceof Error ? err.message : '알 수 없는 오류');
    return emptyAiReferralSummary(endDate, windowDays);
  }
}
