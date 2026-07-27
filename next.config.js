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
       * 경로를 죽이지 않고 메인으로 넘기는 이유: 영업 메일·블로그 등 외부에 공유된
       * /blog-check 링크와 검색 유입이 404 로 죽지 않게 하기 위함이다.
       *
       * ★ 왜 페이지의 redirect() 가 아니라 여기인가 (2026-07-27).
       *   App Router 의 `redirect('/')` 는 RSC 페이로드(NEXT_REDIRECT)로 내려간다.
       *   브라우저는 정상 이동하지만 **curl·크롤러·링크 미리보기 봇처럼 JS 를 돌리지
       *   않는 클라이언트는 Location 헤더를 못 받아** 그 자리에 머문다. 검색엔진이
       *   리다이렉트를 인식하지 못하는 상태였다. next.config 의 redirects() 는
       *   라우팅 이전 단계에서 실제 HTTP 응답에 Location 헤더를 실어 준다.
       *
       * ★ 상태코드 판단 (2026-07-27):
       *   지금은 **307(임시=permanent:false)** 을 유지한다. 근거 —
       *   (1) 첫 화면 진단 전환은 배포 2일 차 실험이고, 되돌리면 랜딩의 BlogCheckSection 과
       *       함께 이 경로가 다시 살아나야 한다.
       *   (2) 308 은 브라우저가 영구 캐시한다(무기한, 사용자 쪽에서 지우기 어렵다).
       *       되돌렸을 때 과거 방문자만 조용히 옛 리다이렉트에 갇히는 실패 모드가 생긴다.
       *   (3) 반대편 손실(구글이 /blog-check 를 색인 후보로 유지해 링크 신호가 / 로
       *       합쳐지지 않는 것)은 이 URL 의 실제 트래픽·피링크가 미미해 지금은 작다.
       *   → 뒤집는 조건: **첫 화면 진단을 되돌리지 않기로 확정되면 그 즉시**
       *      `permanent: true`(308)로 교체한다. 그때는 링크 신호 합류가 이득이다.
       *
       * ⚠️ 진단 엔진은 여전히 blog-check 계열 모듈(blog-check-rss·keywords·serp)과
       *    /api/blog-check/* 를 내부적으로 사용한다 — 이 진입 경로만 은퇴시킨 것이다.
       *    source 는 정확히 '/blog-check' 라서 /api/blog-check/* 는 걸리지 않는다.
       */
      {
        source: '/blog-check',
        destination: '/',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
