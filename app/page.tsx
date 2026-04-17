import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* 헤더 */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-6 h-[60px]"
        style={{
          borderBottom: "1px solid var(--border)",
          background: "rgba(10,12,16,0.9)",
          backdropFilter: "blur(12px)",
        }}
      >
        <a href="/" className="flex items-center gap-2 text-sm font-medium no-underline" style={{ color: "var(--text)" }}>
          <div
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sm"
            style={{
              background: "rgba(59,130,246,0.12)",
              border: "1px solid rgba(59,130,246,0.4)",
            }}
          >
            🏥
          </div>
          HospitalBlog
        </a>
        <nav className="flex items-center gap-6 text-sm" style={{ color: "var(--muted)" }}>
          <a href="#features" className="hover:text-white transition-colors hidden md:block">기능</a>
          <a href="#pricing" className="hover:text-white transition-colors hidden md:block">요금</a>
          <Link href="/terms" className="hover:text-white transition-colors hidden md:block">이용약관</Link>
          <a
            href="https://app.hospitalblog.kr"
            className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            무료 시작하기
          </a>
        </nav>
      </header>

      {/* 히어로 섹션 */}
      <section className="flex flex-col items-center justify-center text-center px-6 pt-24 pb-20">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-6"
          style={{
            background: "rgba(59,130,246,0.1)",
            border: "1px solid rgba(59,130,246,0.3)",
            color: "var(--accent)",
          }}
        >
          ✦ Claude AI · 네이버 SEO 최적화 · 의료광고법 준수
        </div>
        <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6" style={{ letterSpacing: "-0.03em" }}>
          병원 블로그,<br />
          <span style={{ color: "var(--accent)" }}>AI가 알아서</span> 써드립니다
        </h1>
        <p className="text-lg md:text-xl max-w-xl mb-10" style={{ color: "var(--muted)", lineHeight: "1.8" }}>
          키워드 하나만 입력하면 네이버 상위노출에 최적화된 블로그 글을
          자동으로 작성하고 발행까지 해드립니다.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <a
            href="https://app.hospitalblog.kr"
            className="px-8 py-3 rounded-xl font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--accent)" }}
          >
            무료로 시작하기
          </a>
          <a
            href="#features"
            className="px-8 py-3 rounded-xl font-semibold transition-colors"
            style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            기능 살펴보기
          </a>
        </div>
      </section>

      {/* 기능 섹션 */}
      <section id="features" className="max-w-5xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-center mb-4" style={{ letterSpacing: "-0.02em" }}>
          블로그 운영에 필요한 모든 것
        </h2>
        <p className="text-center mb-14 text-base" style={{ color: "var(--muted)" }}>
          키워드 분석부터 발행까지, 병원 마케팅의 모든 과정을 자동화합니다.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            {
              icon: "✍️",
              title: "AI 블로그 자동 작성",
              desc: "키워드를 입력하면 Claude AI가 네이버 C-Rank · D.I.A+ 알고리즘에 최적화된 블로그 글을 자동으로 작성합니다.",
            },
            {
              icon: "🖼️",
              title: "이미지 자동 생성",
              desc: "Flux.1 Pro AI로 병원 특화 카드뉴스와 이미지를 자동 생성합니다. 별도 디자이너 없이 전문적인 비주얼을 만들어드립니다.",
            },
            {
              icon: "📤",
              title: "네이버 블로그 자동발행",
              desc: "작성된 글을 네이버 블로그에 원클릭으로 자동 발행합니다. 계정 정보는 AES-256 암호화로 안전하게 보관됩니다.",
            },
            {
              icon: "🔍",
              title: "SEO 분석 & 최적화",
              desc: "9가지 SEO 체크리스트로 작성된 글의 검색 최적화 점수를 실시간으로 분석하고 개선 방향을 제시합니다.",
            },
            {
              icon: "⚖️",
              title: "의료광고법 자동 검수",
              desc: "의료법 제56조 기준으로 과장·허위 광고 문구를 자동으로 필터링합니다. 법적 리스크를 사전에 차단합니다.",
            },
            {
              icon: "📊",
              title: "네이버 트렌드 분석",
              desc: "네이버 DataLab 기반으로 키워드 검색 트렌드를 실시간 분석합니다. 지금 가장 많이 찾는 진료과목을 파악하세요.",
            },
          ].map(({ icon, title, desc }) => (
            <div
              key={title}
              className="p-6 rounded-2xl"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div className="text-3xl mb-4">{icon}</div>
              <h3 className="font-bold text-base mb-2">{title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 요금 섹션 */}
      <section id="pricing" className="max-w-4xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-center mb-4" style={{ letterSpacing: "-0.02em" }}>
          합리적인 요금제
        </h2>
        <p className="text-center mb-14 text-base" style={{ color: "var(--muted)" }}>
          병원 규모에 맞게 선택하세요. 언제든지 변경 가능합니다.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            {
              name: "베이직",
              desc: "블로그 자동 작성 시작",
              features: ["AI 블로그 작성 월 10건", "SEO 분석", "네이버 트렌드"],
              highlight: false,
            },
            {
              name: "스탠다드",
              desc: "이미지까지 한번에",
              features: ["AI 블로그 작성 월 30건", "카드뉴스 이미지 생성", "독창성 검사", "의료광고법 검수"],
              highlight: true,
            },
            {
              name: "프로",
              desc: "자동발행까지 완전 자동화",
              features: ["AI 블로그 작성 무제한", "네이버 블로그 자동발행", "우선 고객 지원", "모든 기능 포함"],
              highlight: false,
            },
          ].map(({ name, desc, features, highlight }) => (
            <div
              key={name}
              className="p-6 rounded-2xl flex flex-col"
              style={{
                background: highlight ? "rgba(59,130,246,0.08)" : "var(--surface)",
                border: highlight ? "1px solid rgba(59,130,246,0.4)" : "1px solid var(--border)",
              }}
            >
              {highlight && (
                <div
                  className="text-xs font-bold px-2 py-0.5 rounded-full self-start mb-3"
                  style={{ background: "rgba(59,130,246,0.2)", color: "var(--accent)" }}
                >
                  인기
                </div>
              )}
              <h3 className="text-xl font-bold mb-1">{name}</h3>
              <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>{desc}</p>
              <ul className="space-y-2 mb-8 flex-1">
                {features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
                    <span style={{ color: "var(--accent)" }}>✓</span> {f}
                  </li>
                ))}
              </ul>
              <a
                href="https://app.hospitalblog.kr"
                className="text-center py-2.5 rounded-xl text-sm font-bold transition-opacity hover:opacity-90"
                style={{
                  background: highlight ? "var(--accent)" : "transparent",
                  color: highlight ? "#fff" : "var(--muted)",
                  border: highlight ? "none" : "1px solid var(--border)",
                }}
              >
                시작하기
              </a>
            </div>
          ))}
        </div>
        <p className="text-center text-xs mt-6" style={{ color: "var(--muted)" }}>
          정확한 요금은 서비스 출시 시 안내됩니다. 사전 등록 시 첫 달 무료 혜택을 드립니다.
        </p>
      </section>

      {/* CTA 섹션 */}
      <section className="max-w-2xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl font-bold mb-4" style={{ letterSpacing: "-0.02em" }}>
          지금 바로 시작해보세요
        </h2>
        <p className="mb-8" style={{ color: "var(--muted)" }}>
          병원 마케팅의 가장 큰 고민, AI가 해결해드립니다.
        </p>
        <a
          href="https://app.hospitalblog.kr"
          className="inline-block px-10 py-3.5 rounded-xl font-bold text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--accent)" }}
        >
          무료로 시작하기
        </a>
      </section>

      {/* 푸터 */}
      <footer
        className="px-6 py-8 text-center text-xs"
        style={{ borderTop: "1px solid var(--border)", color: "var(--muted)" }}
      >
        <p className="mb-2">© 2026 광고, 진정성 · 대표: 김석종 · 대구광역시 수성구 청호로422 2층</p>
        <p className="mb-2">사업자등록번호: 570-60-00560 · contact@hospitalblog.kr · 010-2558-1115</p>
        <div className="flex justify-center gap-4 mt-3">
          <Link href="/terms" className="hover:text-white transition-colors">이용약관</Link>
          <Link href="/privacy" className="hover:text-white transition-colors">개인정보처리방침</Link>
        </div>
      </footer>
    </div>
  );
}
