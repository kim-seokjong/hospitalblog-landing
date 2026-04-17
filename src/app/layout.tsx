import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '병원 마케팅 블로그 자동화',
  description: '의료광고법 준수 병원 블로그 콘텐츠 자동 생성 서비스',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gradient-to-br from-blue-50 via-white to-indigo-50 min-h-screen">
        {children}
      </body>
    </html>
  );
}
