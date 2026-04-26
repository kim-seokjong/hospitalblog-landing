'use client';

import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, Suspense } from 'react';

const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;


function PixelPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window.fbq !== 'function') return;
    // 경로 변경 시 PageView 이벤트 발송 (SPA 라우팅 대응)
    window.fbq('track', 'PageView');
  }, [pathname, searchParams]);

  return null;
}

export default function MetaPixel() {
  if (!META_PIXEL_ID) {
    // 개발 환경에서 픽셀 ID가 없으면 경고만 띄우고 렌더링 안 함
    if (process.env.NODE_ENV === 'development') {
      console.warn('[MetaPixel] NEXT_PUBLIC_META_PIXEL_ID가 설정되지 않았습니다.');
    }
    return null;
  }

  return (
    <>
      {/* Meta Pixel Base Code */}
      <Script
        id="meta-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${META_PIXEL_ID}');
            fbq('track', 'PageView');
          `,
        }}
      />
      {/* noscript fallback - JS 꺼진 브라우저용 */}
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>

      {/* 라우트 변경 감지용 */}
      <Suspense fallback={null}>
        <PixelPageView />
      </Suspense>
    </>
  );
}
