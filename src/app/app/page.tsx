'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import KeywordInput from '@/components/KeywordInput';
import TitleSelector from '@/components/TitleSelector';
import ContentPreview from '@/components/ContentPreview';
import ImageGallery from '@/components/ImageGallery';
import CardNewsDesigner from '@/components/CardNewsDesigner';
import AnalysisModal from '@/components/AnalysisModal';
import TagPanel from '@/components/TagPanel';
import NaverPublisher from '@/components/NaverPublisher';
import AuthModal from '@/components/AuthModal';
import type { BlogTitle, BlogContent, GeneratedImage, TagResult, CardNewsData, WritingStyle, OptimizationMode } from '@/types';
import { PLANS, isPaidPlanId } from '@/lib/payment/plans';

type ViewStep = 'input' | 'content';

const CLIENT_ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? 'terro6936@naver.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isClientAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return CLIENT_ADMIN_EMAILS.includes(email.toLowerCase());
}

function getPlanUsageLimit(plan: string | null | undefined, isAdminUser: boolean): number | null {
  if (isAdminUser) return Infinity;
  if (!isPaidPlanId(plan)) return 0;
  const limit = PLANS[plan].usageLimit;
  return limit === -1 ? Infinity : limit;
}

const KAKAO_CHANNEL_URL = 'https://pf.kakao.com/_xefMRX';
const CONTACT_DISMISSED_KEY = 'dp_contact_dismissed';

function ContactFloatingButton() {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    setDismissed(localStorage.getItem(CONTACT_DISMISSED_KEY) === '1');

    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        localStorage.removeItem(CONTACT_DISMISSED_KEY);
        setDismissed(false);
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  if (dismissed !== false) return null;

  const handleDismiss = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    localStorage.setItem(CONTACT_DISMISSED_KEY, '1');
    setDismissed(true);
  };

  return (
    <a
      href={KAKAO_CHANNEL_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-30 flex items-center gap-2 pl-4 pr-2 py-2.5 rounded-full text-sm font-bold no-underline shadow-2xl transition-transform hover:scale-105"
      style={{
        background: 'linear-gradient(135deg, #fee500, #ffd900)',
        color: '#3c1e1e',
        boxShadow: '0 8px 24px rgba(254, 229, 0, 0.35), 0 4px 12px rgba(0,0,0,0.25)',
      }}
    >
      <span className="text-base">💬</span>
      <span>문의하기</span>
      <button
        onClick={handleDismiss}
        aria-label="문의하기 버튼 닫기"
        className="ml-1 w-6 h-6 flex items-center justify-center rounded-full bg-black/15 hover:bg-black/25 transition-colors text-base leading-none"
      >
        ×
      </button>
    </a>
  );
}

function HospitalMarketingBanner() {
  return (
    <a
      href="http://www.hospitalmarketing.kr/"
      target="_blank"
      rel="noopener noreferrer"
      className="ad-banner-hm relative block w-full rounded-2xl overflow-hidden no-underline cursor-pointer"
    >
      <span className="ad-pulse-dot absolute top-3 right-3 w-2 h-2 rounded-full bg-red-500 z-10" />
      <img
        src="/ads/hospitalmarketing-banner.png"
        alt="병원 마케팅 풀세팅 — 인스타그램·유튜브·네이버 스마트플레이스·전광판·버스 택시 랩핑·택배 광고"
        width={989}
        height={1590}
        className="ad-banner-hm-img block w-full h-auto"
        loading="lazy"
        decoding="async"
      />
    </a>
  );
}

function AdBanner({ side }: { side: 'left' | 'right' }) {
  return (
    <div className={`hidden xl:flex flex-col flex-shrink-0 ${side === 'left' ? 'mr-4' : 'ml-4'}`} style={{ width: '320px' }}>
      <div className="sticky top-24 space-y-4">
        {side === 'left' ? <HospitalMarketingBanner /> : <div className="w-full" style={{ height: '410px' }} />}
        <div className="w-full" style={{ height: '410px' }} />
      </div>
    </div>
  );
}

const GEN_STEPS = ['경쟁 블로그 분석', '구조·키워드 설계', '본문 초안 작성', '의료광고법 검토', '태그 최적화'];

function GeneratingSpinner() {
  return (
    <div className="flex items-center justify-center py-16 sm:py-24">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-[#4f6ef7] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-white font-semibold">본문 + 태그 생성 중...</p>
        <p className="text-xs text-[#8891bd] mt-1">Claude AI · 약 20~30초 소요</p>
        <div className="mt-4 space-y-2 text-left inline-block">
          {GEN_STEPS.map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-[#8891bd]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4f6ef7] animate-pulse flex-shrink-0" style={{ animationDelay: `${i * 0.4}s` }} />
              {step}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AppPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [userPlan, setUserPlan] = useState<{ plan: string; usage_count: number; hospital_type?: string | null } | null>(null);
  const [hospitalName, setHospitalName] = useState('');
  const [profileRegion, setProfileRegion] = useState('');

  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [viewStep, setViewStep] = useState<ViewStep>('input');
  const [keyword, setKeyword] = useState<string>('');
  const [hospitalType, setHospitalType] = useState<string>('피부과');
  const [additionalInfo, setAdditionalInfo] = useState<string>('');
  const [writingStyle, setWritingStyle] = useState<WritingStyle>('전문가');
  const [optimizationMode, setOptimizationMode] = useState<OptimizationMode>('seo+geo');
  const [titles, setTitles] = useState<BlogTitle[]>([]);
  const [selectedTitle, setSelectedTitle] = useState<BlogTitle | null>(null);
  const [content, setContent] = useState<BlogContent | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [tags, setTags] = useState<TagResult | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const [loadingTitles, setLoadingTitles] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [loadingImages, setLoadingImages] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingSlides, setLoadingSlides] = useState(false);
  const [lastImageCount] = useState(6);
  const [imageStyle, setImageStyle] = useState<'photo' | 'cardnews' | 'upload'>('cardnews');
  const [cardNewsData, setCardNewsData] = useState<CardNewsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<'titles' | 'content' | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthChecked(true);
      if (!data.user) setShowAuthModal(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) setShowAuthModal(true);
      else setShowAuthModal(false);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  // 플랜/사용량/병원정보 fetch
  useEffect(() => {
    if (!user) { setUserPlan(null); setHospitalName(''); setProfileRegion(''); return; }
    supabase.from('profiles')
      .select('plan, usage_count, hospital_type, hospital_name, hospital_address')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          const profile = data as {
            plan: string; usage_count: number; hospital_type?: string | null;
            hospital_name?: string | null; hospital_address?: string | null;
          };
          setUserPlan({ plan: profile.plan, usage_count: profile.usage_count, hospital_type: profile.hospital_type });
          if (profile.hospital_type) setHospitalType(profile.hospital_type);
          if (profile.hospital_name) setHospitalName(profile.hospital_name);
          if (profile.hospital_address) {
            const parts = profile.hospital_address.trim().split(/\s+/);
            const gu = parts.find((p: string) => p.endsWith('구') || p.endsWith('군'));
            const si = parts.find((p: string) => p.endsWith('시') && p !== '광역시');
            setProfileRegion(gu || si || '');
          }
        }
      });
  }, [user, supabase]);

  const refreshUsage = () => {
    if (!user) return;
    supabase.from('profiles').select('plan, usage_count, hospital_type').eq('id', user.id).single()
      .then(({ data }) => {
        if (data) setUserPlan(data as { plan: string; usage_count: number; hospital_type?: string | null });
      });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const handleKeywordSubmit = async (kw: string, ht: string, ai: string, ws: WritingStyle, inputRegion: string, om: OptimizationMode) => {
    setKeyword(kw);
    setHospitalType(ht);
    setAdditionalInfo(ai);
    setWritingStyle(ws);
    setOptimizationMode(om);
    setTitles([]);
    setSelectedTitle(null);
    setContent(null);
    setImages([]);
    setTags(null);
    setError(null);
    setRetryAction(null);
    setViewStep('input');
    setLoadingTitles(true);

    const effectiveRegion = inputRegion || profileRegion;

    try {
      const res = await fetch('/api/generate-titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw, hospitalType: ht, region: effectiveRegion }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '제목 생성에 실패했습니다.');
      setTitles(data.titles);
      setRetryAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
      setRetryAction('titles');
    } finally {
      setLoadingTitles(false);
    }
  };

  const handleGenerateContent = async () => {
    if (!selectedTitle) return;
    setContent(null);
    setImages([]);
    setTags(null);
    setCardNewsData(null);
    setError(null);
    setRetryAction(null);
    setLoadingContent(true);

    try {
      const effectiveRegion = profileRegion;

      const [contentRes, tagRes] = await Promise.all([
        fetch('/api/generate-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: selectedTitle.title, keyword, hospitalType, additionalInfo,
            titleFormat: selectedTitle.seoDetails?.format, writingStyle,
            region: effectiveRegion, hospitalName, optimizationMode,
          }),
        }),
        fetch('/api/generate-tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword, title: selectedTitle.title, hospitalType }),
        }),
      ]);

      const [contentData, tagData] = await Promise.all([contentRes.json(), tagRes.json()]);
      if (!contentRes.ok) {
        const reason = contentData.reason as string | undefined;
        const isBlocked = reason === 'plan_required' || reason === 'plan_expired' || reason === 'limit_exceeded';
        const err = new Error(contentData.error || '본문 생성에 실패했습니다.');
        if (isBlocked) (err as Error & { _blocked?: boolean })._blocked = true;
        throw err;
      }
      setContent(contentData);
      if (tagRes.ok) setTags(tagData);
      setViewStep('content');
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
      const isBlocked = err instanceof Error && (err as Error & { _blocked?: boolean })._blocked === true;
      setBlocked(isBlocked);
      setRetryAction(isBlocked ? null : 'content');
    } finally {
      refreshUsage();
      setLoadingContent(false);
    }
  };

  const handleRetry = () => {
    const action = retryAction;
    setError(null);
    setRetryAction(null);
    setBlocked(false);
    if (action === 'titles') handleKeywordSubmit(keyword, hospitalType, additionalInfo, writingStyle, profileRegion, optimizationMode);
    else if (action === 'content') handleGenerateContent();
  };

  const dismissBlocked = () => {
    setBlocked(false);
    setError(null);
  };

  const handleGenerateTags = async () => {
    if (!selectedTitle) return;
    setLoadingTags(true);
    try {
      const res = await fetch('/api/generate-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, title: selectedTitle.title, hospitalType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '태그 생성에 실패했습니다.');
      setTags(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '태그 생성 오류가 발생했습니다.');
    } finally {
      setLoadingTags(false);
    }
  };

  const handleGenerateImages = async (count: number, style?: 'photo' | 'cardnews') => {
    if (!selectedTitle) return;
    const activeStyle = style ?? imageStyle;
    setError(null);
    setLoadingImages(true);
    try {
      const res = await fetch('/api/generate-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, title: selectedTitle.title, body: content?.body ?? '', count, style: activeStyle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '이미지 생성에 실패했습니다.');
      setImages(data.images);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoadingImages(false);
    }
  };

  const handleGenerateSlides = async () => {
    if (!selectedTitle || !content) return;
    setCardNewsData(null);
    setError(null);
    setLoadingSlides(true);
    try {
      const res = await fetch('/api/generate-cardnews-slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, title: selectedTitle.title, body: content.body, hospitalType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '카드뉴스 생성에 실패했습니다.');
      setCardNewsData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoadingSlides(false);
    }
  };

  const handleImagesUploaded = (files: File[]) => {
    const readers = files.map(file => new Promise<GeneratedImage>(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve({
        id: `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        url: e.target?.result as string,
        prompt: file.name,
        revised_prompt: file.name,
      });
      reader.readAsDataURL(file);
    }));
    Promise.all(readers)
      .then(newImages => setImages(prev => [...prev, ...newImages]))
      .catch(() => setError('이미지 파일을 읽는 데 실패했습니다.'));
  };

  const handleContentChange = (newBody: string) => {
    setContent(prev => prev ? { ...prev, body: newBody } : prev);
  };

  const STYLE_LABEL: Record<WritingStyle, string> = {
    '전문가': '🩺 전문가시점',
    '고객이해': '👥 고객이해시점',
    '사무장': '🏥 사무장시점',
  };

  const userIsAdmin = isClientAdmin(user?.email);
  const planLimit = userPlan || userIsAdmin ? getPlanUsageLimit(userPlan?.plan, userIsAdmin) : null;

  return (
    <div className="min-h-screen bg-[#0b0d2b] text-white">
      {showAuthModal && (
        <AuthModal
          onClose={() => {
            if (user) {
              setShowAuthModal(false);
            } else {
              router.push('/');
            }
          }}
          onSuccess={() => { setShowAuthModal(false); }}
          closable={true}
        />
      )}

      {/* 헤더 */}
      <header className="sticky top-0 z-40 border-b border-[#2a2b6e] bg-[#0b0d2b]/95 backdrop-blur-md">
        <div className="max-w-screen-2xl mx-auto px-3 sm:px-4 h-13 sm:h-14 flex items-center justify-between gap-2 sm:gap-4" style={{ minHeight: '52px' }}>
          <Link href="/" className="flex items-center gap-2 flex-shrink-0 hover:opacity-80 transition-opacity" title="홈으로">
            <div className="w-8 h-8 rounded-xl bg-[#191970] border border-[#4f6ef7]/30 flex items-center justify-center shadow-lg shadow-[#4f6ef7]/10">
              <span className="text-base">🏥</span>
            </div>
            <span className="font-bold text-white text-lg">닥터포스트</span>
          </Link>

          <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-center">
            {viewStep === 'input' ? (
              <>
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-[#4f6ef7]/10 text-[#4f6ef7] border border-[#4f6ef7]/20 text-[10px] sm:text-xs font-semibold">
                  <span className="w-1.5 h-1.5 bg-[#4f6ef7] rounded-full animate-pulse flex-shrink-0" />
                  <span className="sm:hidden">Step 1</span>
                  <span className="hidden sm:inline">Step 1 · 키워드 → 제목 선택</span>
                </div>
                <span className="text-[#555d8a] text-xs hidden sm:block">→</span>
                <div className="hidden sm:block px-2.5 py-1 rounded-full bg-[#2a2b6e]/40 text-[#555d8a] border border-[#2a2b6e] text-xs font-semibold">
                  Step 2 · 본문 · 이미지
                </div>
              </>
            ) : selectedTitle ? (
              <>
                <button
                  onClick={() => setViewStep('input')}
                  className="flex items-center gap-1 text-[#8891bd] hover:text-white active:text-white transition-colors flex-shrink-0 text-xs min-h-[36px] px-1"
                >
                  ← 뒤로
                </button>
                <span className="text-[#555d8a] text-xs">·</span>
                <span className="text-[#c5caf0] truncate text-[10px] sm:text-xs">{selectedTitle.title}</span>
                <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-[#191970] text-[9px] text-[#8891bd] border border-[#2a2b6e] hidden sm:block">
                  {STYLE_LABEL[writingStyle]}
                </span>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            {/* 문의하기 (카카오톡 채널) */}
            <a
              href={KAKAO_CHANNEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              title="카카오톡 채널 문의하기"
              aria-label="카카오톡 채널 문의하기"
              className="w-9 h-9 flex items-center justify-center rounded-lg transition-transform hover:scale-105 active:scale-95"
              style={{ background: '#FEE500' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path
                  d="M12 3.5C6.7 3.5 2.4 6.9 2.4 11.1c0 2.7 1.8 5.1 4.6 6.5l-1.1 4c-.1.4.3.7.6.5l4.7-3.1c.3 0 .5 0 .8 0 5.3 0 9.6-3.4 9.6-7.6S17.3 3.5 12 3.5z"
                  fill="#3C1E1E"
                />
              </svg>
            </a>
            {/* 사용량 표시 */}
            {planLimit !== null && (userPlan || userIsAdmin) && (
              <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-[#191970]/50 border border-[#2a2b6e]">
                <span className={`text-[10px] font-semibold ${!userIsAdmin && userPlan && userPlan.usage_count >= planLimit ? 'text-red-400' : 'text-[#8891bd]'}`}>
                  {userIsAdmin ? '관리자 · ∞' : `${userPlan?.usage_count ?? 0}/${planLimit === Infinity ? '∞' : planLimit}회`}
                </span>
              </div>
            )}
            {authChecked && (
              user ? (
                <>
                  <span className="text-xs text-[#8891bd] hidden lg:block max-w-[120px] truncate">{user.email}</span>
                  {user.email === 'terro6936@naver.com' && (
                    <Link
                      href="/admin"
                      className="px-2.5 sm:px-3 py-1.5 text-xs border border-yellow-500/40 rounded-lg text-yellow-400 hover:bg-yellow-500/10 transition-colors min-h-[36px] flex items-center gap-1"
                    >
                      <span>⚙️</span>
                      <span className="hidden sm:inline">관리자</span>
                    </Link>
                  )}
                  <button
                    onClick={handleLogout}
                    className="px-2.5 sm:px-3 py-1.5 text-xs border border-[#2a2b6e] rounded-lg text-[#8891bd] hover:bg-[#191970] hover:text-white active:bg-[#191970] transition-colors min-h-[36px]"
                  >
                    로그아웃
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="px-2.5 sm:px-3 py-1.5 bg-[#4f6ef7] hover:bg-[#3d5ef0] active:bg-[#2d4ee0] text-white text-xs font-bold rounded-lg transition-colors min-h-[36px]"
                >
                  로그인
                </button>
              )
            )}
          </div>
        </div>
      </header>

      {/* 구독 플랜 필요 알림 (한도 초과 / 미구독 / 만료) */}
      {blocked && (
        <div className="max-w-screen-2xl mx-auto px-4 pt-4">
          <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 border border-blue-500/40 rounded-2xl p-5 sm:p-6">
            <div className="flex items-start gap-3 mb-4">
              <span className="text-3xl flex-shrink-0">💎</span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white text-base sm:text-lg mb-1">구독 플랜이 필요합니다</p>
                <p className="text-xs sm:text-sm text-blue-200">{error}</p>
              </div>
              <button
                onClick={dismissBlocked}
                className="text-blue-200 hover:text-white text-2xl leading-none flex-shrink-0"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Link
                href="/#pricing"
                className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-bold rounded-xl text-center transition-colors flex items-center justify-center gap-2"
              >
                💎 구독 플랜 보기
              </Link>
              <Link
                href="/app/subscription"
                className="flex-1 py-3 bg-[#191970] hover:bg-[#22227a] text-white text-sm font-semibold rounded-xl text-center transition-colors border border-[#4f6ef7]/40 flex items-center justify-center gap-2"
              >
                ⚙️ 구독 관리
              </Link>
              <Link
                href="/"
                className="flex-1 py-3 bg-transparent hover:bg-[#191970]/50 text-[#8891bd] hover:text-white text-sm font-semibold rounded-xl text-center transition-colors border border-[#2a2b6e] flex items-center justify-center gap-2"
              >
                🏠 홈으로
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* 일반 에러 */}
      {error && !blocked && (
        <div className="max-w-screen-2xl mx-auto px-4 pt-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-start gap-3">
            <span className="text-red-400 text-lg flex-shrink-0">❌</span>
            <div className="flex-1">
              <p className="font-semibold text-red-300 text-sm">오류 발생</p>
              <p className="text-xs text-red-400 mt-0.5">{error}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {retryAction && (
                <button
                  onClick={handleRetry}
                  className="px-3 py-1.5 bg-[#4f6ef7] hover:bg-[#3d5ef0] text-white text-xs font-bold rounded-lg transition-colors min-h-[36px]"
                >
                  🔄 다시 시도
                </button>
              )}
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200 text-lg leading-none">×</button>
            </div>
          </div>
        </div>
      )}

      {/* 본문 */}
      <main className="max-w-screen-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="flex">
          <AdBanner side="left" />

          <div className="flex-1 min-w-0 overflow-hidden">

            {/* ── STEP 1 ── */}
            {viewStep === 'input' && (
              <>
                {loadingContent && <GeneratingSpinner />}

                {!loadingContent && (
                  <div className={`grid gap-4 sm:gap-5 ${titles.length > 0 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 max-w-full sm:max-w-md mx-auto'}`}>
                    <div className="space-y-4">
                      <KeywordInput
                        onSubmit={handleKeywordSubmit}
                        isLoading={loadingTitles}
                        lockedHospitalType={userPlan?.hospital_type ?? undefined}
                        defaultRegion={profileRegion}
                      />
                    </div>

                    {titles.length > 0 && (
                      <div className="space-y-4">
                        <TitleSelector
                          titles={titles}
                          selectedTitle={selectedTitle}
                          onSelect={setSelectedTitle}
                          onGenerate={handleGenerateContent}
                          isLoading={loadingContent}
                        />
                        <button
                          onClick={() => handleKeywordSubmit(keyword, hospitalType, additionalInfo, writingStyle, profileRegion, optimizationMode)}
                          disabled={loadingTitles}
                          className="w-full py-2.5 text-xs text-[#8891bd] hover:text-white border border-[#2a2b6e] hover:border-[#4f6ef7]/40 bg-[#0b0d2b] hover:bg-[#191970]/30 rounded-xl transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40"
                        >
                          {loadingTitles ? (
                            <><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> 생성 중...</>
                          ) : (
                            <><span>🔄</span> 마음에 드는 제목이 없으신가요? 새로 5개 생성</>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {titles.length === 0 && !loadingTitles && !loadingContent && (
                  <div className="mt-8 sm:mt-12 text-center px-4">
                    <div className="text-4xl sm:text-5xl mb-3">✍️</div>
                    <p className="text-base font-semibold text-white mb-1">키워드를 입력하여 시작하세요</p>
                    <p className="text-xs text-[#8891bd] mb-5">
                      네이버 C-Rank · D.I.A+ 알고리즘 기반 SEO 최적화 블로그 자동 생성
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {['레이저 토닝', '보톡스 시술', '도수치료', '허리디스크', '임플란트', '라식 수술'].map((kw) => (
                        <span key={kw} className="bg-[#191970]/50 text-[#8891bd] text-xs px-3 py-1.5 rounded-full border border-[#2a2b6e]">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── STEP 2 ── */}
            {viewStep === 'content' && (
              <>
                {loadingContent && <GeneratingSpinner />}

                {content && !loadingContent && (
                  <div className="space-y-5">
                    <ContentPreview
                      content={content}
                      onGenerateImages={handleGenerateImages}
                      onImagesUploaded={handleImagesUploaded}
                      isLoadingImages={loadingImages}
                      imageStyle={imageStyle}
                      onImageStyleChange={setImageStyle}
                      onGenerateSlides={handleGenerateSlides}
                      isLoadingSlides={loadingSlides}
                      onContentChange={handleContentChange}
                    />

                    <button
                      type="button"
                      onClick={() => setShowAnalysis(true)}
                      className="group analysis-cta relative w-full py-3.5 sm:py-4 rounded-xl border-2 border-cyan-400/70 hover:border-cyan-300 bg-gradient-to-r from-cyan-500/15 via-emerald-500/15 to-cyan-500/15 hover:from-cyan-500/25 hover:via-emerald-500/25 hover:to-cyan-500/25 text-white text-sm sm:text-base font-bold transition-all flex items-center justify-center gap-2.5"
                    >
                      <span className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75 animate-ping"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-300"></span>
                      </span>
                      <span className="text-lg">📊</span>
                      <span className="bg-gradient-to-r from-cyan-200 to-emerald-200 bg-clip-text text-transparent">상세 분석 보기</span>
                      <span className="text-[10px] sm:text-[11px] text-cyan-300/80 font-medium hidden sm:inline">(SEO · 독창성 · 네이버 검색 미리보기)</span>
                      <span className="text-cyan-300 group-hover:translate-x-1 transition-transform text-base font-extrabold">→</span>
                    </button>

                    {tags && (
                      <TagPanel
                        tags={tags}
                        onRegenerate={handleGenerateTags}
                        isLoading={loadingTags}
                      />
                    )}

                    {images.length > 0 && (
                      <ImageGallery
                        images={images}
                        keyword={keyword}
                        title={selectedTitle?.title || keyword}
                        style={imageStyle}
                        onRegenerate={() => handleGenerateImages(lastImageCount)}
                        isLoading={loadingImages}
                        onImagesUpdate={setImages}
                      />
                    )}

                    {cardNewsData && (
                      <CardNewsDesigner data={cardNewsData} keyword={keyword} />
                    )}

                    {user && selectedTitle && (
                      <NaverPublisher
                        title={selectedTitle.title}
                        content={content}
                        tags={tags}
                        images={images}
                      />
                    )}

                    {!user && authChecked && (
                      <div className="rounded-2xl border border-[#2a2b6e] bg-[#12153d] p-5 text-center">
                        <p className="text-sm font-semibold text-white mb-1">발행 도우미는 로그인 후 사용 가능합니다</p>
                        <p className="text-xs text-[#8891bd] mb-4">로그인하고 네이버 블로그에 바로 발행하세요</p>
                        <button
                          onClick={() => setShowAuthModal(true)}
                          className="px-5 py-2 bg-[#4f6ef7] hover:bg-[#3d5ef0] text-white text-sm font-bold rounded-xl transition-colors"
                        >
                          로그인 / 회원가입
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <AdBanner side="right" />
        </div>
      </main>

      <footer className="mt-16 border-t border-[#2a2b6e] bg-[#0b0d2b]">
        <div className="max-w-screen-2xl mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-between gap-2">
          <p className="text-[10px] text-[#555d8a]">
            본 서비스는 의료광고법(의료법 제56조) 준수를 지원합니다. 최종 광고 심의는 의료광고 심의기관을 통해 확인하시기 바랍니다.
          </p>
          <p className="text-[10px] text-[#555d8a] flex-shrink-0">닥터포스트 © 2026 · Claude AI · 네이버 C-Rank · D.I.A+ 최적화</p>
        </div>
      </footer>

      {content && selectedTitle && (
        <AnalysisModal
          open={showAnalysis}
          onClose={() => setShowAnalysis(false)}
          content={content}
          title={selectedTitle.title}
          keyword={keyword}
        />
      )}

      <ContactFloatingButton />
    </div>
  );
}
