// Meta Pixel 이벤트 발송 유틸리티
// 사용법: import { trackEvent } from '@/lib/meta-pixel';

type MetaPixelEvent =
  | 'ViewContent'
  | 'CompleteRegistration'
  | 'Lead'
  | 'InitiateCheckout'
  | 'Subscribe'
  | 'Purchase'
  | 'AddToCart'
  | 'Search';

interface EventParams {
  content_name?: string;
  content_category?: string;
  content_ids?: string[];
  content_type?: string;
  value?: number;
  currency?: string;
  status?: string;
  [key: string]: any;
}

/**
 * Meta Pixel 표준 이벤트 발송
 * 브라우저에서만 작동 (서버사이드에서는 무시됨)
 */
export function trackEvent(eventName: MetaPixelEvent, params?: EventParams): void {
  if (typeof window === 'undefined') return;
  if (typeof window.fbq !== 'function') {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[MetaPixel] fbq not loaded. Event skipped: ${eventName}`, params);
    }
    return;
  }

  window.fbq('track', eventName, params);

  if (process.env.NODE_ENV === 'development') {
    console.log(`[MetaPixel] Event sent: ${eventName}`, params);
  }
}

/**
 * Meta Pixel 커스텀 이벤트 발송 (표준 이벤트에 없는 경우)
 */
export function trackCustomEvent(eventName: string, params?: EventParams): void {
  if (typeof window === 'undefined') return;
  if (typeof window.fbq !== 'function') return;

  window.fbq('trackCustom', eventName, params);

  if (process.env.NODE_ENV === 'development') {
    console.log(`[MetaPixel] Custom event sent: ${eventName}`, params);
  }
}
