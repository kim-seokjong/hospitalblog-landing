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

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    router.push('/app');
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={handleAuthSuccess}
          initialMode={authMode}
        />
      )}

      {/* 헤더 */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-base">🏥</span>
            </div>
            <span className="font-bold text-gray-900 text-lg">HospitalBlog</span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm text-gray-600">
            <a href="#features" className="hover:text-blue-600 transition-colors">기능</a>
            <a href="#pricing" className="hover:text-blue-600 transition-colors">요금제</a>
            <a href="/terms" className="hover:text-blue-600 transition-colors">이용약관</a>
          </nav>
          <div className="flex items-center gap-3">
            {authChecked && (
              user ? (
                <>
                  <span className="text-sm text-gray-500 hidden md:block">{user.email}</span>
                  <button
                    onClick={() => router.push('/app')}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-colors"
                  >
                    앱 열기
                  </button>
                  <button
                    onClick={handleLogout}
                    className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    로그아웃
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleLogin}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-blue-600 transition-colors"
                  >
                    로그인
                  </button>
                  <button
                    onClick={handleStart}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-colors"
                  >
                    무료 시작하기
                  </button>
                </>
              )
            )}
          </div>
        </div>
      </header>

      {/* 히어로 */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-semibold mb-6 border border-blue-100">
          ✦ Claude AI · 네이버 SEO 최적화 · 의료광고법 준수
        </div>
        <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight mb-6" style={{ letterSpacing: '-0.03em' }}>
          병원 블로그,<br />
          <span className="text-blue-600">AI가 알아서</span> 써드립니다
        </h1>
        <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
          키워드 하나만 입력하면 네이버 상위노출에 최적화된 블로그 글을
          자동으로 작성하고 발행까지 해드립니다.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={handleStart}
            className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg rounded-xl transition-colors shadow-lg shadow-blue-200"
          >
            무료로 사용하기 →
          </button>
          <a
            href="#features"
            className="px-8 py-4 border border-gray-200 text-gray-600 font-semibold text-lg rounded-xl hover:bg-gray-50 transition-colors"
          >
            기능 살펴보기
          </a>
        </div>
        <p className="text-sm text-gray-400 mt-4">신용카드 불필요 · 즉시 시작 가능</p>
      </section>

      {/* 기능 섹션 */}
      <section id="features" className="bg-gray-50 py-20">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4" style={{ letterSpacing: '-0.02em' }}>
            블로그 운영에 필요한 모든 것
          </h2>
          <p className="text-center text-gray-500 mb-14">
            키워드 분석부터 발행까지, 병원 마케팅의 모든 과정을 자동화합니다.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: "✍️", title: "AI 블로그 자동 작성", desc: "Claude AI가 네이버 C-Rank · D.I.A+ 최적화 블로그 글을 자동으로 작성합니다." },
              { icon: "🖼️", title: "이미지 자동 생성", desc: "Flux.1 Pro AI로 병원 특화 카드뉴스와 이미지를 자동 생성합니다." },
              { icon: "📤", title: "네이버 자동발행", desc: "작성된 글을 네이버 블로그에 원클릭으로 자동 발행합니다." },
              { icon: "🔍", title: "SEO 분석 최적화", desc: "9가지 SEO 체크리스트로 검색 최적화 점수를 실시간 분석합니다." },
              { icon: "⚖️", title: "의료광고법 검수", desc: "의료법 제56조 기준으로 과장·허위 광고 문구를 자동 필터링합니다." },
              { icon: "📊", title: "네이버 트렌드", desc: "DataLab 기반으로 실시간 키워드 검색 트렌드를 분석합니다." },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="text-3xl mb-3">{icon}</div>
                <h3 className="font-bold text-gray-900 mb-2">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 요금 섹션 */}
      <section id="pricing" className="py-20">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4" style={{ letterSpacing: '-0.02em' }}>
            합리적인 요금제
          </h2>
          <p className="text-center text-gray-500 mb-14">
            병원 규모에 맞게 선택하세요. 언제든지 변경 가능합니다.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { name: "베이직", desc: "블로그 자동 작성 시작", features: ["AI 블로그 작성 월 10건", "SEO 분석", "네이버 트렌드"], highlight: false },
              { name: "스탠다드", desc: "이미지까지 한번에", features: ["AI 블로그 작성 월 30건", "카드뉴스 이미지 생성", "독창성 검사", "의료광고법 검수"], highlight: true },
              { name: "프로", desc: "완전 자동화", features: ["AI 블로그 작성 무제한", "네이버 블로그 자동발행", "우선 고객 지원", "모든 기능 포함"], highlight: false },
            ].map(({ name, desc, features, highlight }) => (
              <div key={name} className={`p-6 rounded-2xl border flex flex-col ${highlight ? 'border-blue-300 bg-blue-50 shadow-lg shadow-blue-100' : 'border-gray-100 bg-white'}`}>
                {highlight && <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full self-start mb-3">인기</span>}
                <h3 className="text-xl font-bold text-gray-900 mb-1">{name}</h3>
                <p className="text-sm text-gray-500 mb-5">{desc}</p>
                <ul className="space-y-2 mb-8 flex-1">
                  {features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="text-blue-500">✓</span> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={handleStart}
                  className={`w-full py-2.5 rounded-xl text-sm font-bold transition-colors ${highlight ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  시작하기
                </button>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-gray-400 mt-6">
            정확한 요금은 서비스 출시 시 안내됩니다. 사전 등록 시 첫 달 무료 혜택을 드립니다.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-blue-600 py-16">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">지금 바로 시작해보세요</h2>
          <p className="text-blue-100 mb-8">병원 마케팅의 가장 큰 고민, AI가 해결해드립니다.</p>
          <button
            onClick={handleStart}
            className="px-10 py-4 bg-white text-blue-600 font-bold text-lg rounded-xl hover:bg-blue-50 transition-colors shadow-lg"
          >
            무료로 시작하기 →
          </button>
        </div>
      </section>

      {/* 푸터 */}
      <footer className="border-t border-gray-100 py-8 text-center text-xs text-gray-400">
        <p className="mb-1">© 2026 광고, 진정성 · 대표: 김석종 · 대구광역시 수성구 청호로422 2층</p>
        <p className="mb-3">사업자등록번호: 570-60-00560 · contact@hospitalblog.kr · 010-2558-1115</p>
        <div className="flex justify-center gap-4">
          <a href="/terms" className="hover:text-gray-600 transition-colors">이용약관</a>
          <a href="/privacy" className="hover:text-gray-600 transition-colors">개인정보처리방침</a>
        </div>
      </footer>
    </div>
  );
}
