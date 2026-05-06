'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import AuthModal from '@/components/AuthModal';

export default function LandingPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('signup');
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setAuthChecked(true);
        router.push('/app');
        return;
      }
      setUser(data.user);
      setAuthChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) {
        router.push('/app');
      } else {
        setUser(null);
        setAuthChecked(true);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase, router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const handleStart = () => {
    if (user) {
      router.push('/app');
    } else {
      setAuthMode('signup');
      setShowAuthModal(true);
    }
  };

  const handleLogin = () => {
    setAuthMode('login');
    setShowAuthModal(true);
  };

  const [pendingPricingRedirect, setPendingPricingRedirect] = useState(false);

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    if (pendingPricingRedirect) {
      setPendingPricingRedirect(false);
      router.push('/pricing');
    } else {
      router.push('/app');
    }
  };

  const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? 'terro6936@naver.com').split(',');
  const isAdmin = user ? ADMIN_EMAILS.includes(user.email ?? '') : false;

  const handlePricingClick = () => {
    if (user) {
      router.push(isAdmin ? '/app' : '/pricing');
    } else {
      setAuthMode('signup');
      setPendingPricingRedirect(true);
      setShowAuthModal(true);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-white">
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={handleAuthSuccess}
          initialMode={authMode}
        />
      )}

      {/* 헤더 */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b0f1a]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-7 h-7 flex-shrink-0 bg-blue-500 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/30">
              <span className="text-white text-sm">🏥</span>
            </div>
            <span className="font-bold text-white text-sm md:text-lg truncate">닥터포스트</span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm text-gray-400">
            <a href="#features" className="hover:text-white transition-colors">기능</a>
            <a href="#how" className="hover:text-white transition-colors">사용법</a>
            <a href="#pricing" className="hover:text-white transition-colors">요금제</a>
          </nav>
          <div className="flex items-center gap-2 flex-shrink-0">
            {authChecked && (
              user ? (
                <>
                  <span className="text-xs text-gray-400 hidden md:block">{user.email}</span>
                  <button
                    onClick={() => router.push('/app')}
                    className="px-3 py-1.5 md:px-4 md:py-2 bg-blue-500 hover:bg-blue-400 text-white text-xs md:text-sm font-bold rounded-lg transition-colors"
                  >
                    앱 열기
                  </button>
                  <button
                    onClick={handleLogout}
                    className="px-3 py-1.5 md:px-4 md:py-2 border border-white/20 text-gray-300 text-xs md:text-sm rounded-lg hover:bg-white/10 transition-colors"
                  >
                    로그아웃
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleLogin}
                    className="px-3 py-1.5 md:px-4 md:py-2 text-xs md:text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    로그인
                  </button>
                  <button
                    onClick={handleStart}
                    className="px-3 py-1.5 md:px-4 md:py-2 bg-blue-500 hover:bg-blue-400 text-white text-xs md:text-sm font-bold rounded-lg transition-colors shadow-lg shadow-blue-500/30"
                  >
                    회원가입하기
                  </button>
                </>
              )
            )}
          </div>
        </div>
      </header>

      {/* 히어로 */}
      <section className="relative overflow-hidden">
        {/* 배경 글로우 */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-blue-600/20 rounded-full blur-[120px]" />
          <div className="absolute top-[100px] left-[10%] w-[300px] h-[300px] bg-indigo-600/10 rounded-full blur-[80px]" />
        </div>

        <div className="relative max-w-4xl mx-auto px-6 pt-24 pb-20 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded-full text-xs font-semibold mb-8 border border-blue-500/20">
            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
            Claude AI · 네이버 SEO 최적화 · 의료광고법 준수
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold text-white leading-tight mb-6" style={{ letterSpacing: '-0.03em' }}>
            병원 블로그,<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
              AI가 대신
            </span><br />
            써드립니다.
          </h1>

          <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            60초 안에<br />
            자동으로 작성 해드립니다.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-6">
            <button
              onClick={handleStart}
              className="px-8 py-4 bg-blue-500 hover:bg-blue-400 text-white font-bold text-lg rounded-xl transition-all shadow-2xl shadow-blue-500/30 hover:shadow-blue-400/40 hover:-translate-y-0.5"
            >
              회원가입하기 →
            </button>
            <a
              href="#features"
              className="px-8 py-4 border border-white/20 text-gray-300 font-semibold text-lg rounded-xl hover:bg-white/10 transition-colors"
            >
              기능 살펴보기
            </a>
          </div>

          {/* 스탯 */}
          <div className="mt-16 grid grid-cols-3 gap-4 max-w-2xl mx-auto">
            {[
              { num: '60초', line1: '블로그', line2: '1편 작성' },
              { num: '9가지', line1: 'SEO', line2: '자동분석' },
              { num: '100%', line1: '의료광고법', line2: '준수' },
            ].map(({ num, line1, line2 }) => (
              <div key={num} className="relative bg-gradient-to-b from-blue-500/10 to-white/5 border border-blue-500/20 rounded-2xl p-4 md:p-5 text-center overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none" />
                <p className="relative text-xl md:text-2xl font-extrabold text-blue-400 mb-1">{num}</p>
                <p className="relative text-xs text-gray-400 leading-snug">{line1}<br />{line2}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 사용법 */}
      <section id="how" className="py-20 border-t border-white/5">
        <div className="max-w-4xl mx-auto px-6">
          <p className="text-center text-xs font-bold text-blue-400 tracking-widest mb-3 uppercase">How it works</p>
          <h2 className="text-3xl font-bold text-center text-white mb-4" style={{ letterSpacing: '-0.02em' }}>
            3단계로 끝납니다
          </h2>
          <p className="text-center text-gray-500 mb-14">복잡한 설정 없이 바로 사용하세요.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { step: '1', title: '키워드 입력', desc: '병원 시술명이나 질환명을 입력하세요. 예) 레이저 토닝, 허리디스크' },
              { step: '2', title: 'AI 자동 작성', desc: 'Claude AI가 네이버 알고리즘에 맞춘 제목·본문·태그를 자동 생성합니다.' },
              { step: '3', title: '복사 후 발행', desc: '생성된 글을 복사해서 네이버 블로그에 붙여넣기만 하면 끝입니다.' },
            ].map(({ step, title, desc }, i) => (
              <div key={step} className="relative bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-blue-500/40 hover:bg-white/[0.07] transition-all">
                {i < 2 && (
                  <div className="hidden md:block absolute top-8 -right-3 text-blue-500/40 text-xl z-10">→</div>
                )}
                <div className="w-9 h-9 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center mb-4">
                  <span className="text-sm font-extrabold text-blue-400">{step}</span>
                </div>
                <h3 className="font-bold text-white mb-2">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* 사용법 시연 영상 */}
          <div className="mt-12 relative">
            {/* 배경 글로우 */}
            <div className="absolute inset-0 bg-blue-600/10 rounded-3xl blur-2xl scale-105 pointer-events-none" />

            <div className="relative rounded-2xl overflow-hidden border border-blue-500/30 shadow-2xl shadow-blue-500/20 bg-[#0d1120]">
              {/* 브라우저 상단 바 */}
              <div className="flex items-center gap-3 px-4 py-3 bg-white/5 border-b border-white/10">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-500/70" />
                  <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
                  <span className="w-3 h-3 rounded-full bg-green-500/70" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-md border border-white/10 text-xs text-gray-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    닥터포스트 · 실시간 시연
                  </div>
                </div>
                <div className="w-16" />
              </div>

              {/* 영상 */}
              <video
                src="/0503.mp4"
                autoPlay
                loop
                muted
                playsInline
                className="w-full aspect-video object-cover"
              />
            </div>

            {/* 하단 캡션 */}
            <p className="mt-4 text-center text-xs text-gray-500">
              실제 사용 화면입니다 · 키워드 입력부터 발행까지 60초
            </p>
          </div>
        </div>
      </section>

      {/* 기능 섹션 */}
      <section id="features" className="py-20 border-t border-white/5">
        <div className="max-w-5xl mx-auto px-6">
          <p className="text-center text-xs font-bold text-cyan-400 tracking-widest mb-3 uppercase">Features</p>
          <h2 className="text-3xl font-bold text-center text-white mb-4" style={{ letterSpacing: '-0.02em' }}>
            블로그 운영에 필요한<br />모든 것
          </h2>
          <p className="text-center text-gray-500 mb-14">
            병원 마케팅의<br />모든 과정을 자동화합니다.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: "✍️", title: "AI 블로그 자동 작성", desc: "Claude AI가 네이버 C-Rank · D.I.A+ 최적화 블로그 글을 자동으로 작성합니다.", iconBg: "bg-blue-500/20", iconBorder: "border-blue-500/30" },
              { icon: "🖼️", title: "이미지 자동 생성", desc: "Flux.1 Pro AI로 병원 특화 카드뉴스와 실사 이미지를 자동 생성합니다.", iconBg: "bg-indigo-500/20", iconBorder: "border-indigo-500/30" },
              { icon: "🔍", title: "SEO 분석 최적화", desc: "9가지 SEO 체크리스트로 검색 최적화 점수를 실시간으로 분석합니다.", iconBg: "bg-cyan-500/20", iconBorder: "border-cyan-500/30" },
              { icon: "⚖️", title: "의료광고법 검수", desc: "의료법 제56조 기준으로 과장·허위 광고 문구를 자동 필터링합니다.", iconBg: "bg-emerald-500/20", iconBorder: "border-emerald-500/30" },
              { icon: "📊", title: "네이버 트렌드", desc: "DataLab 기반으로 실시간 키워드 검색 트렌드를 분석합니다.", iconBg: "bg-violet-500/20", iconBorder: "border-violet-500/30" },
              { icon: "🎯", title: "독창성 검사", desc: "네이버 블로그 검색으로 중복 콘텐츠 여부를 자동으로 검사합니다.", iconBg: "bg-rose-500/20", iconBorder: "border-rose-500/30" },
            ].map(({ icon, title, desc, iconBg, iconBorder }) => (
              <div key={title} className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-white/20 hover:bg-white/[0.07] transition-all group">
                <div className={`w-11 h-11 rounded-xl ${iconBg} border ${iconBorder} flex items-center justify-center text-xl mb-4`}>
                  {icon}
                </div>
                <h3 className="font-bold text-white mb-2 group-hover:text-blue-300 transition-colors">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 요금 섹션 */}
      <section id="pricing" className="py-20 border-t border-white/5">
        <div className="max-w-4xl mx-auto px-6">
          <p className="text-center text-xs font-bold text-emerald-400 tracking-widest mb-3 uppercase">Pricing</p>
          <h2 className="text-3xl font-bold text-center text-white mb-4" style={{ letterSpacing: '-0.02em' }}>
            합리적인 요금제
          </h2>
          <p className="text-center text-gray-500 mb-14">
            병원 규모에 맞게 선택하세요<br />언제든지 변경 가능합니다.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                name: "베이직", price: "99,000원", desc: "블로그 자동 작성 시작",
                features: ["AI 블로그 작성 월 10건", "SEO 분석", "네이버 트렌드"],
                highlight: false,
              },
              {
                name: "스탠다드", price: "199,000원", desc: "이미지까지 한번에",
                features: ["AI 블로그 작성 월 20건", "카드뉴스·이미지 자동 생성", "독창성 검사", "의료광고법 검수"],
                highlight: true,
              },
              {
                name: "프로", price: "399,000원", desc: "모든 기능 무제한",
                features: ["AI 블로그 작성 무제한", "이미지 생성 무제한", "독창성 검사 무제한", "의료광고법 검수", "우선 고객 지원"],
                highlight: false,
              },
            ].map(({ name, price, desc, features, highlight }) => (
              <div key={name} className={`relative p-6 rounded-2xl border flex flex-col ${
                highlight
                  ? 'border-blue-400/60 bg-gradient-to-b from-blue-500/15 to-blue-500/5 shadow-2xl shadow-blue-500/20'
                  : 'border-white/10 bg-white/5'
              }`}>
                {highlight && (
                  <>
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-blue-400/5 to-transparent pointer-events-none" />
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-xs font-bold text-white bg-gradient-to-r from-blue-500 to-cyan-500 px-4 py-1 rounded-full shadow-lg shadow-blue-500/30">
                      가장 인기
                    </span>
                  </>
                )}
                <h3 className="text-xl font-bold text-white mb-1">{name}</h3>
                <p className="text-2xl font-extrabold text-white mt-1 mb-1">{price}<span className="text-sm font-normal text-gray-500"> / 월</span></p>
                <p className="text-sm text-gray-500 mb-5">{desc}</p>
                <ul className="space-y-2.5 mb-8 flex-1">
                  {features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-300">
                      <span className="text-blue-400 flex-shrink-0">✓</span> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={handlePricingClick}
                  className={`w-full py-2.5 rounded-xl text-sm font-bold transition-colors ${
                    highlight
                      ? 'bg-blue-500 hover:bg-blue-400 text-white shadow-lg shadow-blue-500/30'
                      : 'border border-white/20 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  시작하기
                </button>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-gray-600 mt-6">
            모든 플랜은 월 단위 구독이며, 언제든지 해지 가능합니다.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 border-t border-white/5 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-blue-600/20 rounded-full blur-[120px]" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[200px] bg-cyan-600/10 rounded-full blur-[80px]" />
        </div>
        <div className="relative max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4 whitespace-nowrap" style={{ letterSpacing: '-0.02em' }}>
            지금 바로 시작해보세요
          </h2>
          <p className="text-gray-400 mb-8">
            병원 마케팅의 가장 큰 고민<br />AI가 해결해 드립니다.
          </p>
          <button
            onClick={handlePricingClick}
            className="px-10 py-4 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-400 hover:to-cyan-400 text-white font-bold text-lg rounded-xl transition-all shadow-2xl shadow-blue-500/30 hover:-translate-y-0.5"
          >
            시작하기 →
          </button>
        </div>
      </section>

      {/* 푸터 */}
      <footer className="border-t border-white/5 py-8 text-center text-xs text-gray-600">
        <p className="mb-1">© 2026 광고, 진정성 · 대표: 김석종 · 대구광역시 수성구 청호로422 2층</p>
        <p className="mb-3">사업자등록번호: 570-60-00560 · contact@hospitalblog.kr · 010-2558-1115</p>
        <div className="flex justify-center gap-4">
          <a href="/terms" className="hover:text-gray-400 transition-colors">이용약관</a>
          <a href="/privacy" className="hover:text-gray-400 transition-colors">개인정보처리방침</a>
          <a href="/refund" className="hover:text-gray-400 transition-colors">환불정책</a>
        </div>
      </footer>
    </div>
  );
}
