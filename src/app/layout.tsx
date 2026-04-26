import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';
import MetaPixel from '@/components/MetaPixel';

export const metadata: Metadata = {
  title: '닥터포스트',
  description: '의료광고법 준수 병원 블로그 콘텐츠 자동 생성 서비스',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gradient-to-br from-blue-50 via-white to-indigo-50 min-h-screen">
        <Script
          src="https://cdn.portone.io/v2/browser-sdk.js"
          strategy="lazyOnload"
        />
        <MetaPixel />
        {children}
      </body>
    </html>
  );
}
