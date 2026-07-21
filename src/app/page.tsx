'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/dev/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import AuthModal from '@/hr/components/AuthModal';
import { PLANS } from '@/payment/lib/plans';
import ClinicflixSection from '@/components/landing/ClinicflixSection';
import HomeFaqSection from '@/components/landing/HomeFaqSection';
import Logo from '@/components/landing/Logo';
import HeroMockup from '@/components/landing/HeroMockup';
import RevealInit from '@/components/landing/Reveal';
import FloatingCta from '@/components/landing/FloatingCta';
import BlindTestSection from '@/components/landing/BlindTestSection';
import WhyDoctorPostSection from '@/components/landing/WhyDoctorPostSection';
import EbookLeadSection from '@/components/landing/EbookLeadSection';
import BlogCheckSection from '@/components/landing/BlogCheckSection';
import JsonLd from '@/dev/lib/seo/JsonLd';
import { buildFaqPageJsonLd } from '@/dev/lib/seo/schemas';
import { HOME_FAQS } from '@/dev/lib/seo/homeFaq';

/**
 * `?clinic=` 쿼리 파라미터를 읽어 상위로 전달한다.
 * useSearchParams는 반드시 <Suspense> 경계 안에서만 사용해야 빌드가 깨지지 않으므로
 * 별도 컴포넌트로 분리해 Suspense로 감싼다.
 */
function ClinicParamReader({ onClinic }: { onClinic: (name: string) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    // useSearchParams는 이미 디코딩된 값을 반환한다(한글·공백·특수문자 안전).
    const raw = searchParams.get('clinic');
    const name = raw?.trim() ?? '';
    if (name) onClinic(name);
  }, [searchParams, onClinic]);
  return null;
}

export default function LandingPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('signup');
  const [clinicName, setClinicName] = useState('');
  const [clinicAutoOpened, setClinicAutoOpened] = useState(false);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      setAuthChecked(true);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  // 영업 딥링크(?clinic=병원명): 비로그인 방문자에게 병원명이 프리필된
  // 회원가입 모달을 자동으로 띄워 마찰을 없앤다. (로그인 상태/값 없음 → 기존 동작 유지)
  useEffect(() => {
    if (!authChecked || clinicAutoOpened || !clinicName || user) return;
    setAuthMode('signup');
    setShowAuthModal(true);
    setClinicAutoOpened(true);
  }, [authChecked, clinicAutoOpened, clinicName, user]);

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

  const handleAuthSuccess = (completedMode: 'login' | 'signup') => {
    setShowAuthModal(false);
    if (pendingPricingRedirect) {
      setPendingPricingRedirect(false);
      router.push('/pricing');
    } else if (completedMode === 'signup') {
      // 신규 가입: 무료 2회 크레딧(2026-07-04 정책)으로 바로 생성 경험 → 소진 시 결제 유도.
      // (구 퍼널: /pricing 직행 — 무료 2회 도입으로 사용자(대표) 지시에 따라 변경)
      router.push('/app?welcome=free');
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
    <div className="min-h-screen bg-white text-[#202020]">
      {/* 홈 FAQ FAQPage JSON-LD (GEO/AEO) — 화면 FAQ(HomeFaqSection)와 동일 데이터 사용 */}
      <JsonLd data={buildFaqPageJsonLd(HOME_FAQS)} />

      {/* 스크롤 리빌 자동 장착 (섹션 진입 모션 — 고급화) */}
      <RevealInit />

      <Suspense fallback={null}>
        <ClinicParamReader onClinic={setClinicName} />
      </Suspense>

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={handleAuthSuccess}
          initialMode={authMode}
          initialHospitalName={clinicName}
        />
      )}

      {/* 상단 컬러 스와치 바 */}
      <div className="flex h-2">
        <i className="flex-1 bg-[#ff4628]" />
        <i className="flex-1 bg-[#202020]" />
        <i className="flex-1 bg-[#b8c8d7]" />
      </div>

      {/* 헤더 — 솔리드 화이트 + blur (그라데이션 금지) */}
      <header className="sticky top-0 z-40 border-b border-[#dbe2ea] bg-white/85 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between">
          <a href="/" aria-label="닥터포스트 홈" className="flex items-center min-w-0">
            <Logo variant="light" />
          </a>
          <nav className="hidden md:flex items-center gap-7 text-sm font-semibold text-[#4a4f55]">
            <a href="#features" className="hover:text-[#ff4628] transition-colors">기능</a>
            <a href="#how" className="hover:text-[#ff4628] transition-colors">사용법</a>
            <a href="#clinicflix" className="hover:text-[#ff4628] transition-colors">클리닉픽스</a>
            <a href="#pricing" className="hover:text-[#ff4628] transition-colors">요금제</a>
          </nav>
          <div className="flex items-center gap-2 flex-shrink-0">
            {authChecked && (
              user ? (
                <>
                  <span className="text-xs text-[#8a93a0] hidden md:block">{user.email}</span>
                  <button
                    onClick={() => router.push('/app')}
                    className="px-3 py-1.5 md:px-4 md:py-2 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white text-xs md:text-sm font-bold rounded-lg transition-all hover:brightness-105 shadow-[0_8px_24px_-12px_rgba(255,70,40,0.5)]"
                  >
                    앱 열기
                  </button>
                  <button
                    onClick={handleLogout}
                    className="px-3 py-1.5 md:px-4 md:py-2 border border-[#dbe2ea] text-[#4a4f55] text-xs md:text-sm font-semibold rounded-lg hover:bg-[#eef2f6] transition-colors"
                  >
                    로그아웃
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleLogin}
                    className="px-3 py-1.5 md:px-4 md:py-2 text-xs md:text-sm font-semibold text-[#4a4f55] hover:text-[#ff4628] transition-colors"
                  >
                    로그인
                  </button>
                  <button
                    onClick={handleStart}
                    className="px-3 py-1.5 md:px-4 md:py-2 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white text-xs md:text-sm font-bold rounded-lg transition-all hover:brightness-105 shadow-[0_8px_24px_-12px_rgba(255,70,40,0.5)]"
                  >
                    회원가입하기
                  </button>
                </>
              )
            )}
          </div>
        </div>
      </header>

      {/* 히어로 — 데스크톱 2컬럼(카피+CTA | 제품 미니 목업), 모바일 세로 스택 */}
      <section
        className="relative overflow-hidden"
        style={{
          // 코랄 그레인 그라데이션 히어로 (flex.team 레퍼런스, 라이트 톤 유지 — 의료 신뢰 우선)
          background:
            'radial-gradient(900px 480px at 18% -10%, rgba(255,233,226,0.95), transparent 62%), ' +
            'radial-gradient(760px 420px at 88% 4%, rgba(255,214,200,0.6), transparent 60%), ' +
            'radial-gradient(680px 380px at 55% 110%, rgba(238,242,246,0.9), transparent 65%), ' +
            'linear-gradient(180deg,#fffdfc,#ffffff)',
        }}
      >
        {/* 필름 그레인 질감 레이어 (장식, 텍스트 아님) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-40 mix-blend-multiply"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 0.95 0 0 0 0 0.94 0 0 0 0 0.93 0 0 0 0.35 0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
        <div className="relative max-w-6xl mx-auto px-5 sm:px-6 pt-16 sm:pt-28 pb-16 sm:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] items-center gap-12 lg:gap-10">
            {/* 왼쪽: 기존 카피 + CTA (모바일 중앙, 데스크톱 좌측 정렬) */}
            <div className="text-center lg:text-left">
              <span className="inline-flex items-center gap-2 bg-white border border-[#dbe2ea] text-[#202020] font-bold text-[12px] sm:text-[13px] px-4 py-1.5 rounded-full shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
                <span className="w-[7px] h-[7px] rounded-full bg-[#ff4628]" />
                Claude AI · 네이버·구글 SEO · AI검색(GEO) 최적화
              </span>

              <h1 className="text-[38px] sm:text-[56px] md:text-[66px] font-black text-[#202020] leading-[1.08] mt-6 sm:mt-8" style={{ letterSpacing: '-1.5px' }}>
                잘 쓰는 건 기본,<br />
                <span className="text-[#ff4628]">안 걸리는 게</span> 실력입니다.
              </h1>

              <p className="text-base sm:text-lg md:text-[19px] text-[#4a4f55] max-w-2xl mx-auto lg:mx-0 mt-5 leading-relaxed">
                모든 글은 발행 전 의료광고법 3중 검수를 통과합니다.<br className="hidden sm:block" />
                금지 표현 필터 · AI 검사 · 주간 점검 — 잘 쓰는 AI는 많지만, 안전까지 책임지는 건 닥터포스트입니다.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start mt-8">
                <button
                  onClick={handleStart}
                  className="px-7 sm:px-8 py-3.5 sm:py-4 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-bold text-base sm:text-lg rounded-xl transition-all shadow-[0_12px_30px_-14px_rgba(255,70,40,0.30)] hover:brightness-105 hover:-translate-y-0.5"
                >
                  무료로 시작하기 →
                </button>
                <a
                  href="#features"
                  className="px-7 sm:px-8 py-3.5 sm:py-4 bg-white border border-[#dbe2ea] text-[#202020] font-semibold text-base sm:text-lg rounded-xl hover:bg-[#eef2f6] transition-colors text-center"
                >
                  기능 살펴보기
                </a>
              </div>
              {/* 가입 혜택 배지 — 상시 혜택(프로모 아님), "2회 무료 생성 + 카드 등록 없음" 강조 */}
              <p className="mt-4 flex justify-center lg:justify-start">
                <span className="inline-block bg-[#ff4628]/10 border border-[#ff4628]/25 text-[#e63a1c] font-semibold text-sm sm:text-[15px] leading-relaxed px-4 sm:px-5 py-2 rounded-full text-center">
                  🎁 가입하면 블로그 글 <b className="font-extrabold">2회 무료 생성</b> · 카드 등록 없음
                </span>
              </p>
            </div>

            {/* 오른쪽: 제품 미니 목업 (모바일에선 CTA 다음 순서) */}
            <div className="px-2 sm:px-0 pt-2 pb-2">
              <HeroMockup />
            </div>
          </div>

          {/* 스탯 3 */}
          <div className="mt-12 sm:mt-14 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-[760px] mx-auto">
            {[
              { num: '60초', label: '블로그 1편 작성' },
              { num: '네이버·구글·AI', label: '3대 검색 최적화' },
              { num: '의료광고법', label: '발행 전 3중 검수' },
            ].map(({ num, label }) => (
              <div key={num} className="dp-lift bg-white/85 backdrop-blur-sm border border-[#dbe2ea] rounded-2xl p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
                <b className="block text-2xl sm:text-[30px] font-black text-[#ff4628]">{num}</b>
                <span className="block text-sm font-semibold text-[#8a93a0] mt-1.5">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 섹션 1: 문제 제기 */}
      <section className="py-20 sm:py-[110px] bg-[#eef2f6]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6">
          <p className="text-center text-[13px] font-extrabold text-[#ff4628] tracking-[2px]">병원 블로그의 현실</p>
          <h2 className="text-center text-[30px] sm:text-[44px] font-black text-[#202020] mt-2.5 leading-tight" style={{ letterSpacing: '-0.5px' }}>
            이런 고민, 한 번쯤 있으셨죠?
          </h2>
          <p className="text-center text-[#4a4f55] mt-3 text-base">대부분의 원장님이 블로그 앞에서 똑같이 멈춰 섭니다.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-10 sm:mt-12">
            {[
              { icon: '⏳', title: '글 쓸 시간이 없어요', desc: '진료만으로도 하루가 빠듯한데, 블로그까지 직접 쓰기란 현실적으로 어렵죠.' },
              { icon: '⚖️', title: '의료광고법이 무서워요', desc: '어디까지 써도 되는지 몰라, 글 하나 올릴 때마다 마음이 불편합니다.' },
              { icon: '💸', title: '대행사는 비싸고 들쭉날쭉', desc: '월 수십~수백만 원인데 품질 편차가 크고, 우리 병원을 잘 모르고 씁니다.' },
              { icon: '🔍', title: '네이버에 글이 안 떠요', desc: '열심히 써도 노출이 안 되면 헛수고. C-Rank·D.I.A+를 모르면 막막하죠.' },
              { icon: '🧩', title: '뭘 써야 할지 막막해요', desc: '키워드·주제 선정부터 막혀서 시작조차 어렵습니다.' },
              { icon: '📉', title: '효과를 알 수가 없어요', desc: '글은 쌓이는데 실제로 환자 유입에 도움이 되는지 확인이 안 됩니다.' },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="bg-white border border-[#dbe2ea] border-l-[3px] border-l-[#ff4628] rounded-2xl p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)] dp-lift">
                <div className="w-11 h-11 rounded-xl bg-[#ffece7] text-[#ff4628] flex items-center justify-center text-xl mb-4">{icon}</div>
                <h3 className="font-extrabold text-[#202020] text-lg">{title}</h3>
                <p className="text-sm text-[#4a4f55] leading-relaxed mt-2">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 섹션 2: 비교표 */}
      <section className="py-20 sm:py-[110px] bg-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-6">
          <p className="text-center text-[13px] font-extrabold text-[#ff4628] tracking-[2px]">무엇이 다른가</p>
          <h2 className="text-center text-[30px] sm:text-[44px] font-black text-[#202020] mt-2.5 leading-tight" style={{ letterSpacing: '-0.5px' }}>
            직접 쓸까, 맡길까, 아니면 닥터포스트
          </h2>
          <p className="text-center text-[#4a4f55] mt-3 text-base">세 가지 방법을 한눈에 비교해보세요.</p>
          <div className="mt-10 sm:mt-12 -mx-5 sm:mx-0 px-5 sm:px-0 overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 bg-white border border-[#dbe2ea] rounded-2xl overflow-hidden shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
              <thead>
                <tr>
                  <th className="text-center text-sm font-extrabold text-[#202020] bg-[#eef2f6] px-5 py-4 border-b border-[#dbe2ea]">　</th>
                  <th className="text-center text-sm font-extrabold text-[#202020] bg-[#eef2f6] px-5 py-4 border-b border-[#dbe2ea]">원장님이 직접</th>
                  <th className="text-center text-sm font-extrabold text-[#202020] bg-[#eef2f6] px-5 py-4 border-b border-[#dbe2ea]">외주 대행사</th>
                  <th className="text-center text-sm font-extrabold text-white px-5 py-4 border-b border-[#dbe2ea] bg-gradient-to-br from-[#ff4628] to-[#e63a1c]">닥터포스트</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: '비용', a: '무료지만 시간 소모', b: '월 수십~수백만 원', dp: '월 구독, 합리적' },
                  { label: '1편 작성', a: '1~2시간', b: '외주 대기·소통', dp: '60초 초안' },
                  { label: '의료광고법', a: '직접 확인, 불안', b: '대행사 역량에 의존', dp: '발행 전 3중 검수' },
                  { label: '검색 최적화', a: '네이버 위주', b: '네이버 중심', dp: '네이버·구글 SEO' },
                  { label: 'AI 검색(GEO)', a: '대응 어려움', b: '거의 안 함', dp: 'GEO 자동 최적화' },
                  { label: '통제권', a: '있음', b: '낮음', dp: '직접 생성·수정' },
                ].map(({ label, a, b, dp }, i, arr) => {
                  const last = i === arr.length - 1;
                  const cellBorder = last ? '' : 'border-b border-[#dbe2ea]';
                  return (
                    <tr key={label}>
                      <td className={`text-left text-sm font-bold text-[#202020] bg-[#fafbfc] px-5 py-4 ${cellBorder}`}>{label}</td>
                      <td className={`text-center text-sm text-[#8a93a0] px-5 py-4 ${cellBorder}`}>{a}</td>
                      <td className={`text-center text-sm text-[#8a93a0] px-5 py-4 ${cellBorder}`}>{b}</td>
                      <td className={`text-center text-sm font-extrabold text-[#202020] bg-[#fff6f4] border-l border-r border-[#ffece7] px-5 py-4 ${cellBorder}`}>{dp}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 신뢰 섹션: 블라인드 비교 (다크 — 내부 요소 명시적 다크 스타일) */}
      <BlindTestSection />

      {/* 섹션 3: 해결 매핑 */}
      <section className="py-20 sm:py-[110px] bg-[#eef2f6]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6">
          <p className="text-center text-[13px] font-extrabold text-[#ff4628] tracking-[2px]">SOLUTION</p>
          <h2 className="text-center text-[30px] sm:text-[44px] font-black text-[#202020] mt-2.5 leading-tight" style={{ letterSpacing: '-0.5px' }}>
            닥터포스트는 이렇게 해결해요
          </h2>
          <p className="text-center text-[#4a4f55] mt-3 text-base">고민 하나하나에 정확히 답합니다.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-10 sm:mt-12">
            {[
              { problem: '시간이 없다', solution: '키워드 한 줄이면 60초 자동 초안' },
              { problem: '법이 불안하다', solution: '발행 전 3중 검수 — 금지 표현 필터·AI 검사·주간 점검' },
              { problem: '대행이 비싸다', solution: '월 구독으로 직접 운영, 통제권은 원장님께' },
              { problem: '노출이 안 된다', solution: '네이버·구글 SEO + AI검색(GEO)까지 구조 자동 반영' },
              { problem: '주제가 막막하다', solution: '시술명만 넣으면 제목·구성까지 제안' },
              { problem: '효과를 모르겠다', solution: '발행 이력·경쟁사 모니터링으로 흐름 파악' },
            ].map(({ problem, solution }) => (
              <div key={problem} className="flex items-center gap-3.5 bg-white border border-[#dbe2ea] rounded-2xl px-5 py-4 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
                <span className="flex-none bg-[#eef2f6] text-[#3f5468] font-bold text-[13px] px-3 py-2 rounded-lg min-w-[100px] sm:min-w-[110px] text-center">{problem}</span>
                <span className="text-[#ff4628] font-black text-lg flex-none">→</span>
                <span className="font-bold text-sm text-[#202020] leading-snug">{solution}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 사용법 */}
      <section id="how" className="py-20 sm:py-[110px] bg-white">
        <div className="max-w-4xl mx-auto px-5 sm:px-6">
          <p className="text-center text-[13px] font-extrabold text-[#ff4628] tracking-[2px] uppercase">How it works</p>
          <h2 className="text-center text-[30px] sm:text-[44px] font-black text-[#202020] mt-2.5 leading-tight" style={{ letterSpacing: '-0.5px' }}>
            3단계로 끝납니다
          </h2>
          <p className="text-center text-[#4a4f55] mt-3 mb-10 sm:mb-12 text-base">복잡한 설정 없이 바로 사용하세요.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { step: '1', title: '키워드 입력', desc: '병원 시술명이나 질환명을 입력하세요. 예) 레이저 토닝', iconClass: 'bg-[#ffece7] text-[#ff4628]' },
              { step: '2', title: 'AI 자동 작성', desc: 'Claude AI가 네이버 SEO에 맞춰 제목·본문·태그까지 생성해요.', iconClass: 'bg-[#eef2f6] text-[#3f5468]' },
              { step: '3', title: '검수 통과 후 발행', desc: '의료광고법 검수를 통과한 글을 복사해 네이버 블로그에 붙여넣으면 끝이에요.', iconClass: 'bg-[#ececec] text-[#202020]' },
            ].map(({ step, title, desc, iconClass }) => (
              <div key={step} className="bg-white border border-[#dbe2ea] rounded-2xl p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)] dp-lift">
                <div className={`w-11 h-11 rounded-xl ${iconClass} flex items-center justify-center text-xl font-extrabold mb-4`}>
                  {step}
                </div>
                <h3 className="font-extrabold text-[#202020] text-lg mb-2">{title}</h3>
                <p className="text-sm text-[#4a4f55] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* 사용법 시연 영상 */}
          <div className="mt-12 relative">
            <div className="relative rounded-2xl overflow-hidden border border-[#dbe2ea] shadow-[0_12px_30px_-14px_rgba(32,32,32,0.20)] bg-white">
              {/* 브라우저 상단 바 */}
              <div className="flex items-center gap-3 px-4 py-3 bg-[#eef2f6] border-b border-[#dbe2ea]">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-400" />
                  <span className="w-3 h-3 rounded-full bg-yellow-400" />
                  <span className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="flex items-center gap-2 px-3 py-1 bg-white rounded-md border border-[#dbe2ea] text-xs text-[#8a93a0]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#ff4628] animate-pulse" />
                    닥터포스트 · 실시간 시연
                  </div>
                </div>
                <div className="w-16" />
              </div>

              {/* 영상 — 실제 사용 화면(현행 UI 색감) 데모 */}
              <video
                src="/demo_2026.mp4"
                autoPlay
                loop
                muted
                playsInline
                className="w-full aspect-video object-cover"
              />
            </div>

            {/* 하단 캡션 */}
            <p className="mt-4 text-center text-xs text-[#8a93a0]">
              실제 사용 화면입니다 · 키워드 입력부터 발행까지 60초
            </p>
          </div>
        </div>
      </section>

      {/* 기능 섹션 */}
      <section id="features" className="py-20 sm:py-[110px] bg-[#eef2f6]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6">
          <p className="text-center text-[13px] font-extrabold text-[#ff4628] tracking-[2px] uppercase">Features</p>
          <h2 className="text-center text-[30px] sm:text-[44px] font-black text-[#202020] mt-2.5 leading-tight" style={{ letterSpacing: '-0.5px' }}>
            블로그 운영에 필요한 모든 것
          </h2>
          <p className="text-center text-[#4a4f55] mt-3 mb-10 sm:mb-12 text-base">
            병원 마케팅의 모든 과정을 자동화해요.
          </p>
          {/* 벤토 그리드 — 핵심 기능 2개(작성·검수)를 와이드 카드로 강조 (Attio 문법) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { icon: "🛡️", title: "의료광고법 3중 검수", desc: "금지 표현 필터 · AI 검사 · 주간 점검 — 3중 검수를 통과한 글만 발행 단계로 갑니다. 걸리고 나서가 아니라, 올리기 전에 잡는 게 닥터포스트의 기준입니다.", iconClass: "bg-[#eef2f6] text-[#3f5468]", span: true },
              { icon: "🖼️", title: "이미지 자동 생성", desc: "병원 특화 실사 이미지를 자동 생성해요.", iconClass: "bg-[#eef2f6] text-[#3f5468]", span: false },
              { icon: "✍️", title: "AI 블로그 자동 작성", desc: "네이버 C-Rank·D.I.A+ 로직에 맞춘 제목·본문·태그를 60초 안에 완성합니다. 병원 진료과목과 강점을 학습해 우리 병원 톤으로 씁니다.", iconClass: "bg-[#ffece7] text-[#ff4628]", span: true },
              { icon: "🔍", title: "SEO·GEO 최적화", desc: "네이버·구글 SEO와 AI 검색(GEO) 기준으로 점수를 분석·최적화해요.", iconClass: "bg-[#ececec] text-[#202020]", span: false },
              { icon: "📈", title: "네이버 트렌드", desc: "실시간 검색 트렌드를 분석해요.", iconClass: "bg-[#ffece7] text-[#ff4628]", span: false },
              { icon: "📑", title: "독창성 검사", desc: "중복 콘텐츠를 자동으로 검사해요.", iconClass: "bg-[#ececec] text-[#202020]", span: false },
            ].map(({ icon, title, desc, iconClass, span }) => (
              <div
                key={title}
                className={`bg-white border border-[#dbe2ea] rounded-2xl p-6 sm:p-7 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)] dp-lift ${
                  span ? 'md:col-span-2' : ''
                }`}
              >
                <div className={`w-11 h-11 rounded-xl ${iconClass} flex items-center justify-center text-xl mb-4`}>
                  {icon}
                </div>
                <h3 className={`font-extrabold text-[#202020] mb-2 ${span ? 'text-xl sm:text-2xl' : 'text-lg'}`}>{title}</h3>
                <p className={`text-[#4a4f55] leading-relaxed ${span ? 'text-[15px] max-w-xl' : 'text-sm'}`}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 클리닉픽스 멀티채널 쇼케이스 (상세페이지 수준) */}
      <ClinicflixSection onCtaClick={handlePricingClick} />

      {/* 왜 닥터포스트인가 — 이유 응집 섹션 */}
      <WhyDoctorPostSection />

      {/* 네이버 블로그 무료진단 — 실측 리드마그넷 (/blog-check 진입) */}
      <BlogCheckSection />

      {/* 의료광고법 요약판 무료 다운로드 — 리드마그넷 */}
      <EbookLeadSection />

      {/* 요금 섹션 */}
      <section id="pricing" className="py-20 sm:py-[110px] bg-white">
        <div className="max-w-4xl mx-auto px-5 sm:px-6">
          <p className="text-center text-[13px] font-extrabold text-[#ff4628] tracking-[2px] uppercase">Pricing</p>
          <h2 className="text-center text-[30px] sm:text-[44px] font-black text-[#202020] mt-2.5 leading-tight" style={{ letterSpacing: '-0.5px' }}>
            합리적인 요금제
          </h2>
          <p className="text-center text-[#4a4f55] mt-3 mb-6 text-base">
            병원 규모에 맞게 선택하세요<br />언제든지 변경 가능합니다.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 items-start">
            {[
              {
                plan: PLANS.standard, desc: "블로그 + 이미지",
                features: ["AI 블로그 작성 월 20건", "카드뉴스·이미지 자동 생성", "독창성 검사", "의료광고법 검수"],
                highlight: false,
              },
              {
                plan: PLANS.pro, desc: "블로그 무제한",
                features: ["AI 블로그 작성 무제한", "이미지 생성 무제한", "독창성 검사 무제한", "의료광고법 검수", "우선 고객 지원"],
                highlight: false,
              },
              {
                plan: PLANS.growth8_standard, desc: "블로그+영상+멀티채널",
                features: ["AI 블로그 월 20건", "AI 영상 월 6건", "멀티채널 세트 월 20건", "카드뉴스·이미지 자동 생성", "의료광고법 검수"],
                highlight: true,
              },
              {
                plan: PLANS.pro12_pro, desc: "올인원 무제한",
                features: ["AI 블로그 무제한", "AI 영상 월 10건", "멀티채널 세트 무제한 (공정사용 월 60세트)", "이미지 생성 무제한", "우선 고객 지원"],
                highlight: false,
              },
            ].map(({ plan, desc, features, highlight }) => {
              return (
              <div key={plan.id} className={`relative p-7 sm:p-8 rounded-2xl bg-white flex flex-col ${
                highlight
                  ? 'border-2 border-[#ff4628] shadow-[0_20px_46px_-16px_rgba(255,70,40,0.34)]'
                  : 'border border-[#dbe2ea] shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]'
              }`}>
                {highlight && (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-xs font-extrabold text-white bg-gradient-to-br from-[#ff4628] to-[#e63a1c] px-4 py-1.5 rounded-full">
                    가장 인기
                  </span>
                )}
                <h3 className="text-lg font-extrabold text-[#202020] mb-1">{plan.name}</h3>
                {/* 정상가 단일 표시 (2026-07 프로모 전면 종료) */}
                <p className="mt-2 mb-1 flex flex-wrap items-baseline gap-x-1">
                  <span className="text-2xl sm:text-3xl font-black text-[#202020]">
                    {plan.price.toLocaleString('ko-KR')}
                  </span>
                  <span className="text-[#202020] text-sm font-bold">원</span>
                  <span className="text-[#8a93a0] text-xs sm:text-sm">/ 월</span>
                </p>
                <p className="text-[11px] text-[#8a93a0] mb-1">매월 자동결제</p>
                <p className="text-sm text-[#4a4f55] mb-5">{desc}</p>
                <ul className="space-y-2.5 mb-8 flex-1">
                  {features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-[#4a4f55]">
                      <span className="text-[#ff4628] font-black flex-shrink-0">✓</span> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={handlePricingClick}
                  className={`w-full py-3 rounded-xl text-sm font-bold transition-all ${
                    highlight
                      ? 'bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white hover:brightness-105 shadow-[0_12px_30px_-14px_rgba(255,70,40,0.30)]'
                      : 'bg-white border border-[#dbe2ea] text-[#202020] hover:bg-[#eef2f6]'
                  }`}
                >
                  시작하기
                </button>
              </div>
              );
            })}
          </div>
          <p className="text-center text-xs text-[#8a93a0] mt-6">
            모든 플랜은 월 단위 구독이며, 언제든지 해지 가능합니다.
          </p>
        </div>
      </section>

      {/* 자주 묻는 질문 (FAQ) — 반론 대응 Q&A + FAQPage JSON-LD 단일 소스 */}
      <HomeFaqSection />

      {/* CTA — 블랙 띠 */}
      <section className="py-20 sm:py-[110px] bg-[#202020]">
        <div className="max-w-2xl mx-auto px-5 sm:px-6 text-center">
          <h2 className="text-[30px] sm:text-[44px] font-black text-white mb-4" style={{ letterSpacing: '-0.5px' }}>
            지금 바로 시작해보세요
          </h2>
          <p className="text-[#b9bdc2] mb-8 text-base">
            잘 쓰는 건 기본 — 발행 전 3중 검수로 안전까지 챙기세요.
          </p>
          <button
            onClick={handlePricingClick}
            className="px-9 sm:px-10 py-3.5 sm:py-4 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-bold text-base sm:text-lg rounded-xl transition-all shadow-[0_12px_30px_-14px_rgba(255,70,40,0.40)] hover:brightness-105 hover:-translate-y-0.5"
          >
            시작하기 →
          </button>
          {/* 가입 혜택 배지 — 히어로와 동일 문구(상시 혜택, 프로모 아님), 다크 배경용 톤 */}
          <p className="mt-5 flex justify-center">
            <span className="inline-block bg-[#ff4628]/15 border border-[#ff4628]/40 text-[#ffb4a8] font-semibold text-sm sm:text-[15px] leading-relaxed px-4 sm:px-5 py-2 rounded-full text-center">
              🎁 가입하면 블로그 글 <b className="text-white font-extrabold">2회 무료 생성</b> · 카드 등록 없음
            </span>
          </p>
        </div>
      </section>

      {/* 푸터 */}
      <footer className="bg-white border-t border-[#dbe2ea] py-9 text-center text-xs text-[#8a93a0] leading-relaxed px-4">
        <p className="mb-1">© 2026 광고진정성. All rights reserved.</p>
        <p className="mb-1">상호: 광고진정성 · 대표: 김석종 · 사업자등록번호: 570-60-00560</p>
        <p className="mb-1">주소: 대구광역시 수성구 청호로422 2층</p>
        <p className="mb-1">통신판매업 신고번호: 제2026-대구수성구-0497호</p>
        <p className="mb-3">연락처: 070-8095-3320 · 이메일: terro6936@naver.com</p>
        <div className="flex flex-wrap justify-center gap-4">
          <a href="/terms" className="hover:text-[#ff4628] transition-colors">이용약관</a>
          <a href="/privacy" className="hover:text-[#ff4628] transition-colors">개인정보처리방침</a>
          <a href="/refund" className="hover:text-[#ff4628] transition-colors">환불정책</a>
        </div>
      </footer>

      {/* 플로팅 CTA — 히어로 "회원가입하기"와 동일 핸들러 재사용 (랜딩 전용) */}
      <FloatingCta onClick={handleStart} />
    </div>
  );
}
