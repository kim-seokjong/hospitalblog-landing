import Logo from '@/components/landing/Logo';

/**
 * /clinic-check 상단(색띠·헤더)과 히어로 문구 — 서버·클라이언트 공용.
 *
 * ⚠️ 2026-09-28 주간점검: ClinicCheckClient 가 useSearchParams 를 써서 가장 가까운
 *    <Suspense> 까지 클라이언트 렌더로 빠지는데, fallback 이 null 이라 서버 HTML 에
 *    h1·히어로 문구가 한 글자도 없었다(네이버 로봇이 받은 본문 1,253자 중 h1 0개).
 *    같은 마크업을 page.tsx 의 fallback 에도 넣어 초기 HTML 에 남긴다.
 *    두 곳이 이 파일 하나를 쓰므로 문구가 어긋날 일이 없다.
 */
export function ClinicCheckTopBar() {
  return (
    <>
      <div className="flex h-2">
        <i className="flex-1 bg-[#ff4628]" />
        <i className="flex-1 bg-[#202020]" />
        <i className="flex-1 bg-[#b8c8d7]" />
      </div>
      <header className="sticky top-0 z-40 border-b border-[#dbe2ea] bg-white/85 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between">
          <a href="/" aria-label="닥터포스트 홈" className="flex items-center min-w-0">
            <Logo variant="light" />
          </a>
          <span className="text-xs sm:text-sm font-bold text-[#4a4f55]">병원 온라인 노출 무료진단</span>
        </div>
      </header>
    </>
  );
}

export function ClinicCheckHeroText() {
  return (
    <div className="text-center">
      <p className="text-[13px] font-extrabold text-[#ff4628] tracking-[2px]">FREE CHECK</p>
      <h1 className="text-[26px] sm:text-[40px] font-black leading-tight mt-2.5" style={{ letterSpacing: '-0.5px' }}>
        병원 이름만 넣으면
        <br className="sm:hidden" /> 온라인 노출 성적을 알려드려요
      </h1>
      <p className="text-[#4a4f55] mt-3 text-[15px] sm:text-base leading-relaxed">
        네이버 플레이스·블로그·인스타·유튜브·홈페이지·AI 검색까지
        <br className="hidden sm:block" />
        공개된 자료로 실제로 조회해서 무료로 진단해 드려요.
      </p>
    </div>
  );
}

/** 클라이언트가 붙기 전 초기 HTML 에 들어가는 자리(검색 로봇이 읽는 부분). */
export function ClinicCheckShell() {
  return (
    <div className="min-h-screen bg-white text-[#202020]">
      <ClinicCheckTopBar />
      <main className="max-w-4xl mx-auto px-5 sm:px-6 py-10 sm:py-14">
        <ClinicCheckHeroText />
      </main>
    </div>
  );
}
