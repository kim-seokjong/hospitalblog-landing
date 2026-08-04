// 자체 퍼널 이벤트 클라이언트 헬퍼.
// 사용법: import { trackFunnel } from '@/dev/lib/funnel';
//         trackFunnel('landing_view');  trackFunnel('signup_start', { hospital_type: '치과' });
//
// Meta 픽셀(trackEvent)과 병행한다 — Meta 는 광고 최적화, 이건 우리 소유 퍼널 데이터.
// 브라우저에서만 동작하고, 절대 예외를 던지지 않는다(계측이 UX 를 막지 않음).

import type { PublicFunnelEvent } from '@/content/lib/funnel-events';
import { readOrCreateAnonId } from '@/content/lib/funnel-events';
import { buildPublicFunnelMeta } from '@/dev/lib/funnel-meta';

/** 32자리 소문자 hex — 서버 isValidAnonId 형식과 같아야 한다. */
function randomHex32(): string {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 브라우저 저장소를 순수 함수에 물린다. 접근 자체가 던지는 환경이 있어 감싼다. */
function getOrCreateAnonId(): string | undefined {
  try {
    return readOrCreateAnonId(window.localStorage, randomHex32);
  } catch {
    return undefined;
  }
}

/**
 * 퍼널 이벤트를 서버(/api/funnel-event)로 비차단 전송한다. 실패는 조용히 무시.
 *
 * 클라이언트에서 보낼 수 있는 이벤트는 **저신뢰 의도 이벤트(landing_view·signup_start)뿐**이다.
 * 전환 확정 이벤트(signup_complete·first_post_generated·payment_success)는 위조 방지를 위해
 * 서버 라우트에서만 기록한다 — 타입(PublicFunnelEvent)으로 컴파일 타임에 강제한다.
 *
 * 서버 화이트리스트가 허용하는 자동 meta(path·source·referrer_host)를 여기서 첨부한다
 * (funnel-meta.ts 에서 정규화 — 쿼리스트링·전체 리퍼러 URL 등 PII 가능 값은 애초에 안 보냄).
 * 호출부가 넘긴 meta(예: hospital_type)는 자동 meta 와 병합되며, 키 충돌 시 호출부 값 우선.
 */
export function trackFunnel(
  event: PublicFunnelEvent,
  meta?: Record<string, string | number | boolean | null>,
): void {
  if (typeof window === 'undefined') return;
  try {
    let autoMeta: Record<string, string> = {};
    try {
      autoMeta = buildPublicFunnelMeta(event, {
        pathname: window.location.pathname,
        search: window.location.search,
        referrer: document.referrer,
        ownHostname: window.location.hostname,
      });
    } catch {
      /* 자동 meta 수집 실패는 무시 — 이벤트 자체는 계속 보낸다 */
    }
    const merged = { ...autoMeta, ...meta };
    const anonId = getOrCreateAnonId();
    const payload: Record<string, unknown> = { event };
    if (Object.keys(merged).length > 0) payload.meta = merged;
    if (anonId) payload.anonId = anonId;
    const body = JSON.stringify(payload);
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
