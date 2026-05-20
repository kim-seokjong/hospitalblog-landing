import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';
import MetaPixel from '@/dev/components/MetaPixel';
import NotificationBell from '@/hr/components/NotificationBell';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';

export const metadata: Metadata = {
  title: '닥터포스트',
  description: '의료광고법 준수 병원 블로그 콘텐츠 자동 생성 서비스',
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
