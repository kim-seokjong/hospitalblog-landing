// 자체 퍼널 이벤트 클라이언트 헬퍼.
// 사용법: import { trackFunnel } from '@/dev/lib/funnel';
//         trackFunnel('landing_view');  trackFunnel('signup_complete', { plan: 'free' });
//
// Meta 픽셀(trackEvent)과 병행한다 — Meta 는 광고 최적화, 이건 우리 소유 퍼널 데이터.
// 브라우저에서만 동작하고, 절대 예외를 던지지 않는다(계측이 UX 를 막지 않음).

import type { FunnelEvent } from '@/content/lib/funnel-events';

/** 퍼널 이벤트를 서버(/api/funnel-event)로 비차단 전송한다. 실패는 조용히 무시. */
export function trackFunnel(
  event: FunnelEvent,
  meta?: Record<string, string | number | boolean | null>,
): void {
  if (typeof window === 'undefined') return;
  try {
    const body = JSON.stringify(meta ? { event, meta } : { event });
    // keepalive: 페이지 전환(가입 후 리다이렉트 등) 중에도 전송이 취소되지 않도록.
    void fetch('/api/funnel-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {
      /* 계측 실패는 무시 */
    });
  } catch {
    /* 직렬화 등 실패 무시 */
  }
}
