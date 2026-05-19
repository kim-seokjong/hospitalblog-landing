'use client';

import { useEffect } from 'react';
import { trackEvent } from '@/dev/lib/meta-pixel';

export default function PricingTracker() {
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
