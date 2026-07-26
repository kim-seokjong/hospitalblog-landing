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
  // ⚠️ 고객 병원 블로그에는 닥터포스트 SaaS 의 Organization·SoftwareApplication
  //    JSON-LD(회사명·상품·가격)를 절대 넣지 않는다. 병원 블로그에는 그 병원의
  //    MedicalClinic·Article 스키마만 있어야 한다(각 페이지에서 주입).
  const clinicSite = await isClinicSiteRequest();

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
        {!clinicSite && (
          <>
            <JsonLd data={buildOrganizationJsonLd()} />
            <JsonLd data={buildSoftwareApplicationJsonLd()} />
          </>
        )}
        <Script
          src="https://cdn.portone.io/v2/browser-sdk.js"
          strategy="lazyOnload"
        />
        <MetaPixel />
        {/* Vercel Web Analytics — 트래픽/방문자 측정. ⚠️ Vercel 대시보드에서 Web Analytics 를
            켜야 데이터가 수집된다 (프로젝트 → Analytics → Enable). 자체 퍼널(funnel_events)과 병행. */}
        <Analytics />
        {isLoggedIn && (
          <div className="fixed top-3 right-3 sm:top-4 sm:right-4 z-40">
            <NotificationBell />
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
