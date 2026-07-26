import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import Script from 'next/script';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import MetaPixel from '@/dev/components/MetaPixel';
import NotificationBell from '@/hr/components/NotificationBell';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import JsonLd from '@/dev/lib/seo/JsonLd';
import { buildOrganizationJsonLd, buildSoftwareApplicationJsonLd } from '@/dev/lib/seo/schemas';
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TITLE, SITE_URL, parseVerificationCodes } from '@/dev/lib/seo/site';
import { CLINIC_SITE_REQUEST_HEADER } from '@/content/lib/clinic-site/slug';
import { shouldRenderTag, type RootLayoutTag } from '@/content/lib/clinic-site/third-party';

// 네이버 서치어드바이저 / 구글 서치 콘솔 verification 코드 (미설정 시 meta 태그 미출력)
// 쉼표 구분 다중 코드 지원: 네이버는 속성(non-www/www)마다 다른 코드를 발급하므로 코드별 meta 태그를 각각 출력
// env 없는 쪽 키는 객체에 아예 넣지 않아 빈/undefined 메타 태그가 생기지 않도록 조건부 spread로 합성
const naverVerification = parseVerificationCodes(process.env.NEXT_PUBLIC_NAVER_SITE_VERIFICATION);
const googleVerification = parseVerificationCodes(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION);
const verification = {
  ...(googleVerification ? { google: googleVerification } : {}),
  ...(naverVerification ? { other: { 'naver-site-verification': naverVerification } } : {}),
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [...SITE_KEYWORDS],
  alternates: {
    // metadataBase 기준 현재 경로로 해석되어 페이지별 self-canonical 생성
    canonical: './',
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: 'ko_KR',
    type: 'website',
  },
  ...(Object.keys(verification).length > 0 ? { verification } : {}),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

/**
 * 병원 서브도메인 블로그(/clinic-site/*) 렌더링인지 판정한다.
 * 미들웨어가 붙인 요청 헤더를 읽는다(외부 위조 헤더는 미들웨어가 제거한다).
 * 판정 실패 시 false = 메인 사이트 기존 동작 유지.
 */
async function isClinicSiteRequest(): Promise<boolean> {
  try {
    const headerList = await headers();
    return headerList.get(CLINIC_SITE_REQUEST_HEADER) === '1';
  } catch {
    return false;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // ⚠️ 고객 병원 블로그(/clinic-site/*)에서 무엇을 빼는지는 한 곳에서 정한다 —
  //    @/content/lib/clinic-site/third-party.ts (태그별 허용 여부 + 근거).
  //    메인 사이트에서는 shouldRenderTag 가 항상 true 라 기존 동작이 그대로 유지된다.
  const clinicSite = await isClinicSiteRequest();
  const showTag = (tag: RootLayoutTag): boolean => shouldRenderTag(tag, clinicSite);

  let isLoggedIn = false;
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    isLoggedIn = !!user;
  } catch {
    isLoggedIn = false;
  }

  return (
    <html lang="ko">
      <body className="bg-white text-[#202020] min-h-screen">
        {showTag('saas-json-ld') && (
          <>
            <JsonLd data={buildOrganizationJsonLd()} />
            <JsonLd data={buildSoftwareApplicationJsonLd()} />
          </>
        )}
        {/* 결제 SDK — 실사용처는 /pricing(BillingButton)뿐이고 그 페이지가 자체 로드한다.
            병원 블로그에는 결제 UI 가 없어 제외해도 기능 손실이 0 이다. */}
        {showTag('portone-browser-sdk') && <Script src="https://cdn.portone.io/v2/browser-sdk.js" strategy="lazyOnload" />}
        {/* 메타 광고 픽셀 — 병원 블로그 방문자(환자)를 우리 리타게팅에 수집하면 안 된다. */}
        {showTag('meta-pixel') && <MetaPixel />}
        {/* Vercel Web Analytics — 트래픽/방문자 측정(쿠키·개인식별 없음). ⚠️ Vercel 대시보드에서
            Web Analytics 를 켜야 데이터가 수집된다 (프로젝트 → Analytics → Enable).
            자체 퍼널(funnel_events)과 병행. 병원 블로그에서도 유지한다(third-party.ts 정책). */}
        {showTag('vercel-analytics') && <Analytics />}
        {showTag('notification-bell') && isLoggedIn && (
          <div className="fixed top-3 right-3 sm:top-4 sm:right-4 z-40">
            <NotificationBell />
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
