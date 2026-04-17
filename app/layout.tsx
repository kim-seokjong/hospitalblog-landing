import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

export const metadata: Metadata = {
  title: "HospitalBlog — 병원 블로그 자동화",
  description: "AI가 네이버 SEO 최적화 블로그를 자동으로 작성하고 발행합니다. 의료광고법 준수, 독창성 검사, 카드뉴스 생성까지 원스톱으로 제공합니다.",
  keywords: "병원 블로그, 병원 마케팅, 네이버 블로그 자동화, 의료광고, SEO 최적화",
  openGraph: {
    title: "HospitalBlog — 병원 블로그 자동화",
    description: "AI 기반 병원 블로그 자동화 서비스",
    url: "https://hospitalblog.kr",
    siteName: "HospitalBlog",
    locale: "ko_KR",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${notoSansKr.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
