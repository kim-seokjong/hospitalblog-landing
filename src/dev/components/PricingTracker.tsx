'use client';

import { useEffect, useRef } from 'react';
import { trackEvent } from '@/dev/lib/meta-pixel';
import { trackFunnel } from '@/dev/lib/funnel';

/**
 * 요금제 페이지 계측 — Meta 픽셀(광고 최적화)과 자체 퍼널(우리 소유 지표)을 병행한다.
 *
 * ★ 자체 퍼널 pricing_view 를 여기서 쏘는 이유 (2026-07-29).
 *   /pricing 에는 자체 계측이 **한 건도 없었다.** 그래서 방문자가 요금을 보러 가지도
 *   않는 건지, 보고 나가는 건지, 보고 가입으로 가는 건지 구분할 수 없었다 —
 *   landing_view 와 signup_start 사이가 통째로 빈칸이었다.
 *   페이지(page.tsx)를 'use client' 로 바꾸지 않고 이미 마운트돼 있던 이 클라이언트
 *   컴포넌트에 얹는다: metadata·JSON-LD(요금/FAQ 구조화 데이터)를 그대로 서버에 남기기
 *   위해서다. SEO 를 건드리지 않는 가장 작은 변경이다.
 */
export default function PricingTracker() {
  /**
   * 1회 발사 가드. React StrictMode 는 개발에서 effect 를 두 번 실행하고, 리렌더로도
   * 다시 돌 수 있다 — 그대로 두면 요금 조회 수가 부풀어 전환율 분모가 망가진다.
   * ref 는 같은 컴포넌트 인스턴스에서 유지되므로 이중 실행에도 한 번만 나간다.
   */
  const funnelSentRef = useRef(false);

  useEffect(() => {
    if (funnelSentRef.current) return;
    funnelSentRef.current = true;
    // meta(path·source·referrer_host)는 trackFunnel 이 자동으로 붙인다.
    trackFunnel('pricing_view');
  }, []);

  useEffect(() => {
    // fbq 로딩 대기 후 이벤트 발송
    const sendEvent = () => {
      if (typeof window.fbq === 'function') {
        trackEvent('ViewContent', {
          content_name: '요금제 페이지',
          content_category: 'pricing',
          content_type: 'product_group',
        });
        return true;
      }
      return false;
    };

    // 즉시 시도
    if (sendEvent()) return;

    // 아직 fbq 안 됐으면 100ms 간격으로 최대 3초 대기
    let attempts = 0;
    const maxAttempts = 30;
    const interval = setInterval(() => {
      attempts++;
      if (sendEvent() || attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return null;
}
