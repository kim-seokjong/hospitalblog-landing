/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['oaidalleapiprodscus.blob.core.windows.net', 'image.pollinations.ai', 'images.pexels.com'],
  },
  experimental: {
    serverComponentsExternalPackages: ['playwright-core'],
  },
  async redirects() {
    return [
      // 전자책(크몽) 독자용 단축 경로 — 인쇄물에는 깔끔한 주소만 노출하고 UTM은 여기서 부착
      {
        source: '/ebook',
        destination: '/?utm_source=ebook&utm_medium=referral&utm_campaign=medical_ad_guide',
        permanent: false,
      },
      /**
       * /blog-check — 구 "네이버 블로그 무료진단" 진입 경로 (2026-07-27 은퇴).
       *
       * 무료진단은 랜딩 첫 화면의 **병원명 진단(/clinic-check)** 으로 일원화했다.
       * 경로를 죽이지 않고 메인으로 넘기는 이유: 영업 자료(영업툴/deck_product.html)와
       * 외부에 공유된 /blog-check 링크가 404 로 죽지 않게 하기 위함이다.
       * ⚠️ 이 리다이렉트를 지우면 배포된 영업 자료의 CTA 가 404 가 된다 — 삭제 금지.
       *
       * ★ 왜 페이지의 redirect() 가 아니라 여기인가 (2026-07-27).
       *   App Router 의 `redirect('/')` 는 RSC 페이로드(NEXT_REDIRECT)로 내려간다.
       *   브라우저는 정상 이동하지만 **curl·크롤러·링크 미리보기 봇처럼 JS 를 돌리지
       *   않는 클라이언트는 Location 헤더를 못 받아** 그 자리에 머문다. 검색엔진이
       *   리다이렉트를 인식하지 못하는 상태였다. next.config 의 redirects() 는
       *   라우팅 이전 단계에서 실제 HTTP 응답에 Location 헤더를 실어 준다.
       *
       * ★ 상태코드 판단 (2026-07-28 갱신 — 307 → 308).
       *   첫 화면 진단(/clinic-check)을 되돌리지 않기로 확정했다. 직전 주석이 걸어둔
       *   "확정되면 그 즉시 permanent:true" 조건이 충족되어 **308(영구)** 로 교체한다.
       *   근거 — (1) 구글이 /blog-check 를 색인 후보로 붙들지 않고 링크 신호를 / 로
       *   합친다(307 이면 색인 후보로 계속 남는다). (2) 실제로 Search Console 이
       *   2026-07-28 "리디렉션이 포함된 페이지" 로 이 경로를 신규 보고했다.
       *   → 되돌리는 조건: 첫 화면 진단을 롤백하기로 하면 308 은 브라우저가 영구
       *      캐시하므로(사용자 쪽에서 지우기 어렵다) 경로 재사용 대신 **새 경로**를
       *      쓴다. 이 줄을 307 로 되돌리는 것으로는 과거 방문자가 풀리지 않는다.
       *
       * ⚠️ 진단 엔진은 여전히 blog-check 계열 **모듈**(blog-check-input·limits·rss·
       *    keywords·serp)을 내부적으로 사용한다 — 이 진입 경로만 은퇴시킨 것이다.
       *    (구 /api/blog-check/* 라우트는 호출자가 없어 2026-07-28 삭제했다.)
       */
      {
        source: '/blog-check',
        destination: '/',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
