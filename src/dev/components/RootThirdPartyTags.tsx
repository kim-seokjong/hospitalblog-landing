'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { Analytics } from '@vercel/analytics/next';
import MetaPixel from './MetaPixel';
import NotificationBellSlot from '@/hr/components/NotificationBellSlot';
import { isClinicSiteBrowserContext } from '@/content/lib/clinic-site/slug';
import { shouldRenderTag, type RootLayoutTag } from '@/content/lib/clinic-site/third-party';

/**
 * 루트 레이아웃의 서드파티 태그 묶음 — **클라이언트에서** 병원 블로그 여부를 판정한다.
 *
 * ★ 왜 클라이언트인가 (ISR):
 *   판정을 서버에서 하려면 headers() 를 읽어야 하고, 루트 레이아웃이 동적 API 를
 *   쓰는 순간 하위 세그먼트 전체가 동적으로 내려가 /clinic-site/* 의
 *   `revalidate = 3600` 이 무력화된다(고객 병원 블로그가 매 요청 서버 렌더).
 *   태그들은 전부 브라우저에서만 의미가 있으므로 판정도 브라우저로 내린다.
 *
 * ★ 어떤 태그를 왜 빼는지의 정책은 건드리지 않았다 —
 *   @/content/lib/clinic-site/third-party.ts (태그별 허용 여부 + 근거) 그대로 읽는다.
 *   메인 사이트에서는 shouldRenderTag 가 항상 true 라 기존 동작이 유지된다.
 *
 * ★ 마운트 전에는 아무것도 렌더하지 않는다:
 *   판정 입력(window.location.hostname)이 서버에는 없다. 서버에서 미리 그려두면
 *   "판정 전 1회"에 메타 픽셀이 병원 블로그 HTML 로 새어나간다 — 그 유출을 구조적으로
 *   막기 위해 판정이 가능한 시점(마운트 이후)에만 렌더한다. 하이드레이션 불일치도
 *   함께 사라진다(서버·클라이언트 첫 렌더가 모두 null).
 *   대가: JS 를 끈 브라우저에서는 메타 픽셀 noscript 픽셀이 뜨지 않는다.
 */
export default function RootThirdPartyTags() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const clinicSite = isClinicSiteBrowserContext(window.location.hostname, pathname);
  const showTag = (tag: RootLayoutTag): boolean => shouldRenderTag(tag, clinicSite);

  return (
    <>
      {/* 결제 SDK — 실사용처는 /pricing(BillingButton)뿐이고 그 페이지가 자체 로드한다.
          병원 블로그에는 결제 UI 가 없어 제외해도 기능 손실이 0 이다. */}
      {showTag('portone-browser-sdk') && <Script src="https://cdn.portone.io/v2/browser-sdk.js" strategy="lazyOnload" />}
      {/* 메타 광고 픽셀 — 병원 블로그 방문자(환자)를 우리 리타게팅에 수집하면 안 된다. */}
      {showTag('meta-pixel') && <MetaPixel />}
      {/* Vercel Web Analytics — 트래픽/방문자 측정(쿠키·개인식별 없음). ⚠️ Vercel 대시보드에서
          Web Analytics 를 켜야 데이터가 수집된다 (프로젝트 → Analytics → Enable).
          자체 퍼널(funnel_events)과 병행. 병원 블로그에서도 유지한다(third-party.ts 정책). */}
      {showTag('vercel-analytics') && <Analytics />}
      {/* 알림 벨 — 로그인 판정은 NotificationBellSlot 이 클라이언트에서 한다. */}
      {showTag('notification-bell') && <NotificationBellSlot />}
    </>
  );
}
