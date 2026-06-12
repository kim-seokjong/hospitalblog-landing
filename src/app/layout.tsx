import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';
import MetaPixel from '@/dev/components/MetaPixel';
import NotificationBell from '@/hr/components/NotificationBell';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import JsonLd from '@/dev/lib/seo/JsonLd';
import { buildOrganizationJsonLd, buildSoftwareApplicationJsonLd } from '@/dev/lib/seo/schemas';
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TITLE, SITE_URL } from '@/dev/lib/seo/site';

// 네이버 서치어드바이저 verification 코드 (미설정 시 meta 태그 미출력)
const naverVerification = process.env.NEXT_PUBLIC_NAVER_SITE_VERIFICATION;

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
  ...(naverVerification
    ? { verification: { other: { 'naver-site-verification': naverVerification } } }
    : {}),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
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
      <body className="bg-gradient-to-br from-blue-50 via-white to-indigo-50 min-h-screen">
        <JsonLd data={buildOrganizationJsonLd()} />
        <JsonLd data={buildSoftwareApplicationJsonLd()} />
        <Script
          src="https://cdn.portone.io/v2/browser-sdk.js"
          strategy="lazyOnload"
        />
        <MetaPixel />
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
