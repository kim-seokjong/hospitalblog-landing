import type { Metadata, Viewport } from 'next';
import './globals.css';
import RootThirdPartyTags from '@/dev/components/RootThirdPartyTags';
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TITLE, SITE_URL, parseVerificationCodes } from '@/dev/lib/seo/site';

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
    // ⚠️ 절대 URL(SITE_URL)로 고정하면 자체 openGraph 가 없는 모든 페이지의 og:url 이 홈이 된다.
    //    canonical 과 같은 상대경로 규칙을 태워 페이지별 자기 URL 로 해석되게 한다.
    //    (Next: openGraph.url 도 alternates.canonical 과 동일하게 pathname 기준으로 해석된다.)
    //    자체 openGraph 를 선언한 페이지(/clinic-check, /clinic-site/*)는 이 블록 전체를
    //    대체하므로 서브도메인 절대 URL 동작은 영향을 받지 않는다.
    url: './',
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
 * ★ 이 레이아웃은 **동적 API(headers()·cookies())를 쓰지 않는다.**
 *
 *   루트 레이아웃이 동적 API 를 하나라도 쓰면 하위 세그먼트 전체가 동적 렌더로
 *   내려가, 고객 병원 블로그(/clinic-site/*)가 선언한 `revalidate = 3600`(ISR)이
 *   무력화된다 — 매 요청 서버 렌더가 되어 느려지고 크롤러 대응·서버 비용이 나빠진다.
 *
 *   그래서 예전에 여기서 하던 두 가지를 아래로 내렸다:
 *    - 병원 블로그 판정(headers() 로 미들웨어 헤더 판독)
 *      → RootThirdPartyTags 가 브라우저 문맥(호스트명·경로)으로 판정한다.
 *        정책 자체는 third-party.ts 그대로다.
 *    - 로그인 조회(cookies() 기반 Supabase) → NotificationBellSlot 이 클라이언트에서.
 *    - 회사 구조화 데이터(Organization·SoftwareApplication JSON-LD) → 홈(app/page.tsx).
 *      회사 스키마는 홈에 한 번이면 충분하고, 병원 블로그로 샐 경로 자체가 사라진다.
 *
 *   ⚠️ 렌더 모드를 강제 선언(dynamic·revalidate 류)하지 않는다 — 동적 API 를 안 쓰면
 *      자동으로 정적이다. 여기에 동적 API 를 다시 들이면 ISR 이 조용히 죽는다
 *      (회귀 테스트: clinic-site/__tests__/third-party.test.ts).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-white text-[#202020] min-h-screen">
        {/* 서드파티 태그(결제 SDK·메타 픽셀·Vercel Analytics·알림 벨) —
            병원 블로그에서 무엇을 빼는지는 third-party.ts 정책 한 곳에서 정한다. */}
        <RootThirdPartyTags />
        {children}
      </body>
    </html>
  );
}
