'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/dev/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import AuthModal from '@/hr/components/AuthModal';
import Logo from '@/components/landing/Logo';
import type { BlogCheckSimpleResult } from '@/content/lib/blog-check';
import BlogCheckScoreCards from './BlogCheckScoreCards';
import BlogCheckDetailView, { type BlogCheckDetail } from './BlogCheckDetailView';

/**
 * 네이버 블로그 무료진단 — 전용 페이지 (모바일 최적화).
 *
 * 흐름: 주소 입력 → 간단분석(비회원) → 점수표+장단점(심화 지적 1건 블러)
 *      → 회원가입/로그인 → 상세분석(키워드 전체·황금 키워드·GEO·컴플라이언스·품질·VOICE-DNA).
 * 규칙: 라이트 랜딩 테마 명시(bg-white·text-[#202020]) — 다크 루트 상속 가드.
 *      매출·방문자 추정 표시 금지, 타 병원 비교 금지("내 블로그 진단" 포지셔닝).
 */

export default function BlogCheckClient() {
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const [user, setUser] = useState<User | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BlogCheckSimpleResult | null>(null);
  const [detail, setDetail] = useState<BlogCheckDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('signup');
  /** 가입/로그인 완료 직후 상세분석 자동 실행 플래그. */
  const pendingDetailRef = useRef(false);
  /** 응답 경합 가드 — 연속 실행 시 이전 응답이 최신 결과를 덮지 않도록. */
  const reqRef = useRef(0);
  const autoRanRef = useRef(false);
  const detailSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  const runSimple = useCallback(async (blog: string) => {
    const value = blog.trim();
    if (!value) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    setResult(null);
    setDetail(null);
    setDetailError(null);
    try {
      const res = await fetch('/api/blog-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blog: value }),
      });
      const data = (await res.json()) as { result?: BlogCheckSimpleResult; error?: string };
      if (reqId !== reqRef.current) return;
      if (!res.ok || !data.result) {
        setError(data.error ?? '진단에 실패했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }
      setResult(data.result);
    } catch {
      if (reqId !== reqRef.current) return;
      setError('네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  }, []);

  const runDetail = useCallback(async (blogId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch('/api/blog-check/detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blog: blogId }),
      });
      const data = (await res.json()) as { detail?: BlogCheckDetail; error?: string };
      if (!res.ok || !data.detail) {
        setDetailError(data.error ?? '상세분석에 실패했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }
      setDetail(data.detail);
      // 상세 섹션으로 부드럽게 이동 (모바일 UX)
      setTimeout(() => detailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    } catch {
      setDetailError('네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ?blog= 프리필 + 자동 실행 (랜딩 진입 섹션에서 넘어온 경우)
  useEffect(() => {
    if (autoRanRef.current) return;
    const prefill = searchParams.get('blog')?.trim() ?? '';
    if (!prefill) return;
    autoRanRef.current = true;
    setInput(prefill);
    void runSimple(prefill);
  }, [searchParams, runSimple]);

  const handleUnlock = () => {
    if (!result) return;
    if (user) {
      void runDetail(result.blogId);
    } else {
      pendingDetailRef.current = true;
      setAuthMode('signup');
      setShowAuthModal(true);
    }
  };

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    if (pendingDetailRef.current && result) {
      pendingDetailRef.current = false;
      void runDetail(result.blogId);
    }
  };

  const inputClass =
    'w-full px-4 py-3.5 rounded-xl border border-[#dbe2ea] bg-white text-[#202020] placeholder-[#8a93a0] focus:outline-none focus:border-[#ff4628] text-[15px]';

  return (
    <div className="min-h-screen bg-white text-[#202020]">
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={handleAuthSuccess}
          initialMode={authMode}
        />
      )}

      {/* 상단 컬러 스와치 바 + 헤더 (랜딩 규칙: 솔리드 화이트, 그라데이션 금지) */}
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
          <span className="text-xs sm:text-sm font-bold text-[#4a4f55]">네이버 블로그 무료진단</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 sm:px-6 py-10 sm:py-14">
        {/* 입력 */}
        <div className="text-center">
          <p className="text-[13px] font-extrabold text-[#ff4628] tracking-[2px]">FREE CHECK</p>
          <h1 className="text-[26px] sm:text-[40px] font-black leading-tight mt-2.5" style={{ letterSpacing: '-0.5px' }}>
            우리 병원 블로그,
            <br className="sm:hidden" /> 지금 잘 되고 있을까요?
          </h1>
          <p className="text-[#4a4f55] mt-3 text-[15px] sm:text-base leading-relaxed">
            블로그 주소만 넣으면 검색량·노출 순위·문서수를 <b>실측</b>해서
            <br className="hidden sm:block" />
            SEO·AI검색(GEO)·의료광고법 위험 신호를 무료로 진단해 드려요.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSimple(input);
          }}
          className="mt-7 flex flex-col sm:flex-row gap-3 max-w-xl mx-auto"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="blog.naver.com/블로그아이디"
            className={inputClass}
            style={{ colorScheme: 'light' }}
            maxLength={300}
            required
          />
          <button
            type="submit"
            disabled={loading || input.trim() === ''}
            className="flex-shrink-0 px-7 py-3.5 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-bold rounded-xl transition-all shadow-[0_12px_30px_-14px_rgba(255,70,40,0.30)] hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            {loading ? '진단 중…' : '무료 진단하기'}
          </button>
        </form>
        <p className="text-[11px] text-[#8a93a0] text-center mt-2.5">
          공개 지표(RSS·네이버 검색·검색광고)만 실측해요 · 하루 3회 무료 · 결과는 특정 시점 기준이에요
        </p>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-14">
            <span className="w-5 h-5 border-2 border-[#ff4628] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-[#5b6573]">최근 글 수집·키워드 실측 중… (최대 1분)</span>
          </div>
        )}

        {error && !loading && (
          <div className="mt-8 max-w-xl mx-auto bg-yellow-50 border border-yellow-500/30 rounded-xl px-4 py-3.5 flex items-start gap-2">
            <span className="text-yellow-600 text-sm flex-shrink-0 mt-0.5">⚠</span>
            <p className="text-sm text-yellow-700">{error}</p>
          </div>
        )}

        {result && !loading && (
          <div className="mt-10 space-y-4 sm:space-y-5">
            <div className="text-center">
              <h2 className="text-lg sm:text-xl font-extrabold">
                “{result.blogTitle || result.blogId}” 진단 결과
              </h2>
              <p className="text-[11px] text-[#8a93a0] mt-1">
                최근 {result.totalPosts}편 기준 · {new Date(result.runAt).toLocaleDateString('ko-KR')} 실측
              </p>
            </div>

            <BlogCheckScoreCards result={result} />

            {/* 키워드 미리보기 */}
            {result.keywordPreview.length > 0 && (
              <div className="bg-white border border-[#b4bfce] rounded-2xl p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
                <h3 className="text-sm font-bold mb-3">타깃 키워드 실측 미리보기</h3>
                <ul className="space-y-1.5">
                  {result.keywordPreview.map((m) => (
                    <li key={m.keyword} className="flex items-center gap-3 bg-[#eef2f6] rounded-xl px-4 py-3 min-h-[44px] text-sm">
                      <span className="flex-1 min-w-0 font-semibold truncate">{m.keyword}</span>
                      <span className="text-[11px] text-[#5b6573] flex-shrink-0">
                        월 {m.volume ? m.volume.total.toLocaleString('ko-KR') : '—'}회
                      </span>
                      <span className="text-[11px] font-bold flex-shrink-0">
                        {m.rank !== null ? `${m.rank}위` : '100위 밖'}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-[#8a93a0] mt-2">전체 키워드 실측표는 상세분석에서 확인할 수 있어요.</p>
              </div>
            )}

            {/* 장점 / 부족한 점 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border border-[#b4bfce] rounded-2xl p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
                <h3 className="text-sm font-bold mb-3">👍 잘하고 있는 점</h3>
                <ul className="space-y-2">
                  {result.strengths.map((s, i) => (
                    <li key={i} className="text-[13px] text-[#4a4f55] leading-relaxed flex gap-2">
                      <span className="text-emerald-500 font-black flex-shrink-0">✓</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-white border border-[#b4bfce] rounded-2xl p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
                <h3 className="text-sm font-bold mb-3">⚠️ 아쉬운 점</h3>
                <ul className="space-y-2">
                  {result.weaknesses.map((w, i) => (
                    <li key={i} className="text-[13px] text-[#4a4f55] leading-relaxed flex gap-2">
                      <span className="text-[#e63a1c] font-black flex-shrink-0">!</span>
                      {w}
                    </li>
                  ))}
                  {result.lockedWeakness && (
                    <li className="relative rounded-xl border border-[#ffd9cf] bg-[#fff7f5] px-3 py-3 overflow-hidden">
                      <p className="text-[13px] text-[#4a4f55] blur-[5px] select-none" aria-hidden="true">
                        {result.lockedWeakness.teaser} 이 항목은 회원 전용 심화 지적으로, 실측 데이터 근거와 함께 제공됩니다.
                      </p>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[12px] font-bold text-[#e63a1c] bg-white/90 border border-[#ffd9cf] px-3 py-1.5 rounded-full">
                          🔒 심화 지적 1건 — 상세분석에서 공개
                        </span>
                      </div>
                    </li>
                  )}
                </ul>
              </div>
            </div>

            {/* 상세분석 게이트 */}
            <div ref={detailSectionRef} className="bg-[#202020] rounded-2xl p-6 sm:p-8 text-center">
              {detail ? null : (
                <>
                  <h3 className="text-white text-lg sm:text-2xl font-black">
                    상세분석 리포트 {user ? '실행' : '무료로 받기'}
                  </h3>
                  <p className="text-[#b9bdc2] text-[13px] sm:text-sm mt-2 leading-relaxed">
                    키워드 전체 실측표 · 황금 키워드 제안 · AI 크롤러 차단 증거 · 위험 문구 인용
                    <br className="hidden sm:block" />
                    + 기존 블로그 말투를 학습해 첫 글부터 반영(VOICE-DNA)
                  </p>
                  {detailError && <p className="text-[13px] text-[#ffb4a8] mt-3">{detailError}</p>}
                  <button
                    onClick={handleUnlock}
                    disabled={detailLoading}
                    className="mt-5 px-8 py-3.5 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-bold rounded-xl transition-all shadow-[0_12px_30px_-14px_rgba(255,70,40,0.40)] hover:brightness-105 disabled:opacity-50 min-h-[44px]"
                  >
                    {detailLoading
                      ? '상세분석 중… (최대 2분)'
                      : user
                        ? '상세분석 실행하기 →'
                        : '무료 가입하고 상세분석 보기 →'}
                  </button>
                  {!user && (
                    <p className="text-[11px] text-[#8a93a0] mt-3">
                      가입하면 블로그 글 2회 무료 생성 혜택도 함께 드려요 · 카드 등록 없음
                    </p>
                  )}
                </>
              )}
              {detail && (
                <p className="text-white text-sm font-bold">📋 상세분석 리포트가 준비됐어요 — 아래에서 확인하세요.</p>
              )}
            </div>

            {detail && <BlogCheckDetailView detail={detail} />}

            <p className="text-[11px] text-[#8a93a0] text-center leading-relaxed pt-2">
              본 진단은 네이버 공개 지표(RSS·검색 API·검색광고 API) 실측 기반이며 특정 시점의 참고 자료예요.
              매출·방문자 수치는 추정하지 않아요. 위험 표현 검출은 검수 참고용이며 법적 판단을 대신하지 않아요.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
