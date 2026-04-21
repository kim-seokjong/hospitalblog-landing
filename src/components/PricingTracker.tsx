'use client';

import { useEffect } from 'react';
import { trackEvent } from '@/lib/meta-pixel';

export default function PricingTracker() {
  useEffect(() => {
    trackEvent('ViewContent', {
      content_name: '요금제 페이지',
      content_category: 'pricing',
      content_type: 'product_group',
    });
  }, []);

  return null;
}
