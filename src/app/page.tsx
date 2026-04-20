'use client';

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
      setUser(data.user);
      setAuthChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

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
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/30">
              <span className="text-white text-base">🏥</span>
            </div>
            <span className="font-bold text-white text-lg">HospitalBlog</span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm text-gray-400">
            <a href="#features" className="hover:text-white transition-colors">기능</a>
            <a href="#how" className="hover:text-white transition-colors">사용법</a>
            <a href="#pricing" className="hover:text-white transition-colors">요금제</a>
          </nav>
          <div className="flex items-center gap-3">
            {authChecked && (
              user ? (
                <>
                  <span className="text-sm text-gray-400 hidden md:block">{user.email}</span>
                  <button
                    onClick={() => router.push('/app')}
                    className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-bold rounded-lg transition-colors"
                  >
                    앱 열기
                  </button>
                  <button
                    onClick={handleLogout}
                    className="px-4 py-2 border border-white/20 text-gray-300 text-sm rounded-lg hover:bg-white/10 transition-colors"
                  >
                    로그아웃
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleLogin}
                    className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    로그인
                  </button>
                  <button
                    onClick={handleStart}
                    className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-bold rounded-lg transition-colors shadow-lg shadow-blue-500/30"
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
            </span>{' '}써드립니다
          </h1>

          <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            키워드 하나만 입력하면 네이버 상위노출에 최적화된<br className="hidden md:block" />
            블로그 글을 60초 안에 자동으로 작성해드립니다.
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
          <div className="mt-16 grid grid-cols-3 gap-6 max-w-2xl mx-auto">
            {[
              { num: '60초', label: '블로그 1편 작성' },
              { num: '9가지', label: 'SEO 자동 분석' },
              { num: '100%', label: '의료광고법 준수' },
            ].map(({ num, label }) => (
              <div key={label} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <p className="text-2xl font-extrabold text-blue-400 mb-1">{num}</p>
                <p className="text-xs text-gray-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 사용법 */}
      <section id="how" className="py-20 border-t border-white/5">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center text-white mb-4" style={{ letterSpacing: '-0.02em' }}>
            3단계로 끝납니다
          </h2>
          <p className="text-center text-gray-500 mb-14">복잡한 설정 없이 바로 사용하세요.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { step: '01', title: '키워드 입력', desc: '병원 시술명이나 질환명을 입력하세요. 예) 레이저 토닝, 허리디스크' },
              { step: '02', title: 'AI 자동 작성', desc: 'Claude AI가 네이버 알고리즘에 맞춘 제목·본문·태그를 자동 생성합니다.' },
              { step: '03', title: '복사 후 발행', desc: '생성된 글을 복사해서 네이버 블로그에 붙여넣기만 하면 끝입니다.' },
            ].map(({ step, title, desc }, i) => (
              <div key={step} className="relative bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-blue-500/30 transition-colors">
                {i < 2 && (
                  <div className="hidden md:block absolute top-1/2 -right-2 -translate-y-1/2 text-gray-700 text-lg z-10">→</div>
                )}
                <p className="text-4xl font-black text-blue-500/20 mb-3">{step}</p>
                <h3 className="font-bold text-white mb-2">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 기능 섹션 */}
      <section id="features" className="py-20 border-t border-white/5">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center text-white mb-4" style={{ letterSpacing: '-0.02em' }}>
            블로그 운영에 필요한 모든 것
          </h2>
          <p className="text-center text-gray-500 mb-14">
            키워드 분석부터 발행까지, 병원 마케팅의 모든 과정을 자동화합니다.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: "✍️", title: "AI 블로그 자동 작성", desc: "Claude AI가 네이버 C-Rank · D.I.A+ 최적화 블로그 글을 자동으로 작성합니다.", color: "blue" },
              { icon: "🖼️", title: "이미지 자동 생성", desc: "Flux.1 Pro AI로 병원 특화 카드뉴스와 실사 이미지를 자동 생성합니다.", color: "indigo" },
              { icon: "🔍", title: "SEO 분석 최적화", desc: "9가지 SEO 체크리스트로 검색 최적화 점수를 실시간으로 분석합니다.", color: "cyan" },
              { icon: "⚖️", title: "의료광고법 검수", desc: "의료법 제56조 기준으로 과장·허위 광고 문구를 자동 필터링합니다.", color: "emerald" },
              { icon: "📊", title: "네이버 트렌드", desc: "DataLab 기반으로 실시간 키워드 검색 트렌드를 분석합니다.", color: "violet" },
              { icon: "🎯", title: "독창성 검사", desc: "네이버 블로그 검색으로 중복 콘텐츠 여부를 자동으로 검사합니다.", color: "rose" },
            ].map(({ icon, title, desc, color }) => (
              <div key={title} className={`bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-${color}-500/30 hover:bg-white/[0.07] transition-all group`}>
                <div className="text-3xl mb-4">{icon}</div>
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
          <h2 className="text-3xl font-bold text-center text-white mb-4" style={{ letterSpacing: '-0.02em' }}>
            합리적인 요금제
          </h2>
          <p className="text-center text-gray-500 mb-14">
            병원 규모에 맞게 선택하세요. 언제든지 변경 가능합니다.
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
                  ? 'border-blue-500/50 bg-blue-500/10 shadow-2xl shadow-blue-500/10'
                  : 'border-white/10 bg-white/5'
              }`}>
                {highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold text-white bg-blue-500 px-3 py-1 rounded-full">
                    인기
                  </span>
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
      <section className="py-20 border-t border-white/5 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-blue-600/15 rounded-full blur-[100px]" />
        </div>
        <div className="relative max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-extrabold text-white mb-4" style={{ letterSpacing: '-0.02em' }}>
            지금 바로 시작해보세요
          </h2>
          <p className="text-gray-500 mb-8">병원 마케팅의 가장 큰 고민, AI가 해결해드립니다.</p>
          <button
            onClick={handlePricingClick}
            className="px-10 py-4 bg-blue-500 hover:bg-blue-400 text-white font-bold text-lg rounded-xl transition-all shadow-2xl shadow-blue-500/30 hover:-translate-y-0.5"
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
        </div>
      </footer>
    </div>
  );
}
