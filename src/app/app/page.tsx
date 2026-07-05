'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/dev/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import KeywordInput from '@/content/components/KeywordInput';
import ContentGapSuggestions from '@/content/components/ContentGapSuggestions';
import CrossContentRecommendations from '@/content/components/CrossContentRecommendations';
import TitleSelector from '@/content/components/TitleSelector';
import ContentPreview from '@/content/components/ContentPreview';
import ImageGallery from '@/content/components/ImageGallery';
import CardNewsDesigner from '@/content/components/CardNewsDesigner';
import TagPanel from '@/content/components/TagPanel';
import NaverPublisher from '@/publish/components/NaverPublisher';
import AuthModal from '@/hr/components/AuthModal';
import type { BlogTitle, BlogContent, GeneratedImage, TagResult, CardNewsData, WritingStyle, OptimizationMode, TargetSite, Readability } from '@/types';
import { PLANS, isPaidPlanId, isActivePlan } from '@/payment/lib/plans';
import { safeFetchJson } from '@/content/lib/safe-fetch';
import { MULTICHANNEL_SRC_KEY, encodeMultichannelSrc } from '@/content/lib/multichannel-src';
import { checkCompliance } from '@/content/lib/medical-compliance';
import { buildComplianceReport } from '@/content/lib/compliance-report';

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
const DRAFT_KEY = 'dp_draft_v1';

// 글 생성 옵션 기억: 한 번 바꾼 선택(말투·스타일·고급 설정)을 저장해 다음 생성에 자동 적용
const GEN_PREFS_KEY = 'dp_gen_prefs_v1';

interface GenPrefs {
  writingStyle: WritingStyle;
  optimizationMode: OptimizationMode;
  targetSite: TargetSite;
  readability: Readability;
  useVoiceDna: boolean;
  viralHook: boolean;
  storytelling: boolean;
  reverseAnalysis: boolean;
}

/** localStorage 값 검증 — 허용된 유니언 값만 통과 (외부 데이터 신뢰 금지) */
function parseGenPrefs(raw: string): Partial<GenPrefs> {
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<GenPrefs> = {};
    if (p.writingStyle === '전문가' || p.writingStyle === '고객이해' || p.writingStyle === '사무장') out.writingStyle = p.writingStyle;
    if (p.optimizationMode === 'seo+geo' || p.optimizationMode === 'seo') out.optimizationMode = p.optimizationMode;
    if (p.targetSite === 'naver' || p.targetSite === 'google') out.targetSite = p.targetSite;
    if (p.readability === 'easy' || p.readability === 'standard') out.readability = p.readability;
    if (typeof p.useVoiceDna === 'boolean') out.useVoiceDna = p.useVoiceDna;
    if (typeof p.viralHook === 'boolean') out.viralHook = p.viralHook;
    if (typeof p.storytelling === 'boolean') out.storytelling = p.storytelling;
    if (typeof p.reverseAnalysis === 'boolean') out.reverseAnalysis = p.reverseAnalysis;
    return out;
  } catch {
    return {};
  }
}
// 경쟁분석(monitor) → 글쓰기 prefill 전달 키. { topic, keyword } 포맷.
const TOPIC_PREFILL_KEY = 'dp_topic_prefill';
// 온보딩 완주 가이드 — 첫 글을 완성하면 다시 보이지 않는다
const WELCOME_DONE_KEY = 'dp_welcome_done_v1';

type DraftData = {
  keyword: string;
  hospitalType: string;
  additionalInfo: string;
  writingStyle: WritingStyle;
  optimizationMode: OptimizationMode;
  targetSite: TargetSite;
  readability: Readability;
  useVoiceDna: boolean;
  viralHook: boolean;
  storytelling: boolean;
  reverseAnalysis: boolean;
  titles: BlogTitle[];
  selectedTitle: BlogTitle | null;
  content: BlogContent | null;
  tags: TagResult | null;
  viewStep: ViewStep;
  savedAt: string;
};

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

const OFFLINE_BANNER_CSS = `
.obr-banner {
  width:100%;
  background:#0a0a0a;
  border-radius:16px;
  overflow:hidden;
  box-shadow:0 0 0 1px rgba(255,0,0,0.2), 0 20px 60px rgba(0,0,0,0.8);
  font-family:'Noto Sans KR', system-ui, sans-serif;
}
.obr-top-bar {
  height:4px;
  background:linear-gradient(90deg, #E53935, #FF5722, #FFD700);
}
.obr-header {
  padding:24px 20px 16px;
  position:relative;
}
.obr-badge {
  display:inline-block;
  background:rgba(229,57,53,0.15);
  border:1px solid rgba(229,57,53,0.4);
  color:#FF5252;
  font-size:10px;
  font-weight:700;
  letter-spacing:1.5px;
  padding:3px 10px;
  border-radius:20px;
  margin-bottom:12px;
}
.obr-headline {
  font-size:26px;
  font-weight:900;
  color:#fff;
  line-height:1.15;
  margin-bottom:8px;
}
.obr-headline .obr-accent {
  color:#E53935;
  position:relative;
}
.obr-headline .obr-accent::after {
  content:'';
  position:absolute;
  bottom:-2px; left:0; right:0;
  height:3px;
  background:#E53935;
  border-radius:2px;
}
.obr-sub { font-size:11px; color:rgba(255,255,255,0.5); line-height:1.6; }

/* 비주얼 씬 */
.obr-visual {
  margin:0 16px;
  border-radius:12px;
  overflow:hidden;
  background:linear-gradient(135deg, #1a0000 0%, #2d0000 50%, #1a0a00 100%);
  height:110px;
  position:relative;
  border:1px solid rgba(229,57,53,0.2);
}
.obr-road2 {
  position:absolute; bottom:0; left:0; right:0; height:24px;
  background:#1a1a1a;
}
.obr-road-lines {
  position:absolute; bottom:10px; left:0; right:0; height:3px;
  background:repeating-linear-gradient(90deg, #FFD700 0,#FFD700 20px,transparent 20px,transparent 36px);
  animation:obr-move 1s linear infinite;
}
@keyframes obr-move { to { background-position:-36px 0; } }

/* 래핑된 버스 */
.obr-bus2 {
  position:absolute; bottom:24px;
  animation:obr-drive 4s linear infinite;
}
@keyframes obr-drive { from{left:-100px} to{left:340px} }
.obr-bus2-body {
  width:88px; height:32px;
  background:linear-gradient(180deg,#B71C1C,#C62828);
  border-radius:6px 8px 2px 2px;
  position:relative;
}
.obr-bus2-text {
  position:absolute; top:6px; left:8px; right:8px; height:14px;
  background:white; border-radius:2px;
  display:flex; align-items:center; justify-content:center;
  font-size:6px; font-weight:900; color:#B71C1C; letter-spacing:0.5px;
}
.obr-bus2-win {
  position:absolute; top:22px; left:10px; right:10px; height:7px;
  background:rgba(100,180,255,0.3); border-radius:1px;
}
.obr-bus2-wheel {
  position:absolute; bottom:-5px;
  width:10px; height:10px;
  background:#111; border-radius:50%; border:2px solid #333;
  animation:obr-spin 0.3s linear infinite;
}
@keyframes obr-spin { to{transform:rotate(360deg)} }

/* 전광판 */
.obr-billboard {
  position:absolute; top:8px; right:20px;
  width:70px; height:45px;
  background:#000;
  border:2px solid #FFD700;
  border-radius:4px;
  display:flex; flex-direction:column;
  align-items:center; justify-content:center;
  box-shadow:0 0 15px rgba(255,215,0,0.4);
  overflow:hidden;
}
.obr-billboard-screen {
  font-size:6px; font-weight:900; color:#FFD700;
  white-space:nowrap;
  animation:obr-scroll 3s linear infinite;
}
@keyframes obr-scroll { from{transform:translateX(70px)} to{transform:translateX(-90px)} }
.obr-billboard-stand {
  position:absolute; bottom:-8px; left:50%; transform:translateX(-50%);
  width:4px; height:10px; background:#555;
}

/* 광고 아이템 */
.obr-items { padding:14px 16px; display:flex; flex-direction:column; gap:6px; }
.obr-item {
  display:flex; align-items:center; gap:10px;
  padding:10px 12px;
  background:rgba(255,255,255,0.03);
  border:1px solid rgba(255,255,255,0.06);
  border-radius:10px;
  position:relative; overflow:hidden;
}
.obr-item::before {
  content:'';
  position:absolute; left:0; top:0; bottom:0; width:3px;
  background:var(--c);
}
.obr-item-icon {
  font-size:18px;
  width:32px; text-align:center;
}
.obr-item-text { flex:1; }
.obr-item-name { font-size:12px; font-weight:700; color:#fff; margin-bottom:2px; }
.obr-item-desc { font-size:10px; color:rgba(255,255,255,0.4); }
.obr-item-tag {
  font-size:9px; font-weight:700; padding:2px 7px;
  border-radius:10px; background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.4);
}

.obr-cta { padding:0 16px 16px; }
.obr-cta-button {
  width:100%; padding:14px;
  background:linear-gradient(90deg,#E53935,#C62828);
  border:none; border-radius:12px;
  font-size:13px; font-weight:900; color:#fff;
  cursor:pointer; letter-spacing:0.5px;
  box-shadow:0 4px 20px rgba(229,57,53,0.35);
  display:flex; align-items:center; justify-content:center; gap:8px;
}
.obr-foot {
  padding:10px 16px 14px;
  display:flex; align-items:center; justify-content:center; gap:8px;
  border-top:1px solid rgba(255,255,255,0.05);
}
.obr-foot-name { font-size:11px; font-weight:700; color:rgba(255,255,255,0.4); letter-spacing:1px; }
.obr-foot-divider { color:rgba(255,0,0,0.4); }
.obr-foot-sub { font-size:10px; color:rgba(255,255,255,0.2); }
`;

function HospitalMarketingBanner() {
  return (
    <a
      href="http://www.hospitalmarketing.kr/"
      target="_blank"
      rel="noopener noreferrer"
      className="ad-banner-hm relative block w-full no-underline cursor-pointer"
    >
      <style>{OFFLINE_BANNER_CSS}</style>
      <div className="obr-banner">
        <div className="obr-top-bar" />

        <div className="obr-header">
          <div className="obr-badge">OFFLINE MARKETING</div>
          <div className="obr-headline">
            온라인 이후엔<br />
            <span className="obr-accent">오프라인</span>입니다
          </div>
          <div className="obr-sub">지역 환자를 직접 만나는<br />오프라인 광고 솔루션</div>
        </div>

        <div className="obr-visual">
          {/* 전광판 */}
          <div className="obr-billboard">
            <div className="obr-billboard-screen">광고진정성 병의원마케팅</div>
            <div className="obr-billboard-stand" />
          </div>
          {/* 버스 */}
          <div className="obr-bus2" style={{ left: '-100px' }}>
            <div className="obr-bus2-body">
              <div className="obr-bus2-text">광고진정성 · 병의원 전문</div>
              <div className="obr-bus2-win" />
              <div className="obr-bus2-wheel" style={{ left: '8px' }} />
              <div className="obr-bus2-wheel" style={{ left: '68px' }} />
            </div>
          </div>
          <div className="obr-road2"><div className="obr-road-lines" /></div>
        </div>

        <div className="obr-items">
          <div className="obr-item" style={{ ['--c']: '#FFD700' } as React.CSSProperties}>
            <div className="obr-item-icon">📺</div>
            <div className="obr-item-text">
              <div className="obr-item-name">전광판 · LED</div>
              <div className="obr-item-desc">고가시성 대형 디스플레이 광고</div>
            </div>
            <div className="obr-item-tag">HOT</div>
          </div>
          <div className="obr-item" style={{ ['--c']: '#2196F3' } as React.CSSProperties}>
            <div className="obr-item-icon">🚌</div>
            <div className="obr-item-text">
              <div className="obr-item-name">버스 래핑</div>
              <div className="obr-item-desc">지역 생활권 반복 노출</div>
            </div>
            <div className="obr-item-tag">추천</div>
          </div>
          <div className="obr-item" style={{ ['--c']: '#FDD835' } as React.CSSProperties}>
            <div className="obr-item-icon">🚕</div>
            <div className="obr-item-text">
              <div className="obr-item-name">택시 래핑</div>
              <div className="obr-item-desc">근거리 타겟 밀착 광고</div>
            </div>
            <div className="obr-item-tag">인기</div>
          </div>
          <div className="obr-item" style={{ ['--c']: '#FF5722' } as React.CSSProperties}>
            <div className="obr-item-icon">📦</div>
            <div className="obr-item-text">
              <div className="obr-item-name">택배차량 래핑</div>
              <div className="obr-item-desc">주거지역 생활 밀착 노출</div>
            </div>
            <div className="obr-item-tag">NEW</div>
          </div>
        </div>

        <div className="obr-cta">
          <div className="obr-cta-button">오프라인 광고 상담받기 →</div>
        </div>

        <div className="obr-foot">
          <div className="obr-foot-name">광고진정성</div>
          <div className="obr-foot-divider">|</div>
          <div className="obr-foot-sub">병의원 전문 마케팅</div>
        </div>
      </div>
    </a>
  );
}

function AdBanner({ side }: { side: 'left' | 'right' }) {
  return (
    <div className={`hidden xl:flex flex-col flex-shrink-0 ${side === 'left' ? 'mr-4' : 'ml-4'}`} style={{ width: '384px' }}>
      <div className="sticky top-24">
        {side === 'left' && <HospitalMarketingBanner />}
      </div>
    </div>
  );
}

const GEN_STEPS = ['경쟁 블로그 분석', '구조·키워드 설계', '본문 초안 작성', '의료광고법 검토', '태그 최적화'];

function GeneratingSpinner() {
  return (
    <div className="flex items-center justify-center py-16 sm:py-24">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-[#ff4628] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[#202020] font-semibold">본문 + 태그 생성 중...</p>
        <p className="text-xs text-[#5b6573] mt-1">Claude AI · 약 20~30초 소요</p>
        <div className="mt-4 space-y-2 text-left inline-block">
          {GEN_STEPS.map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-[#5b6573]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff4628] animate-pulse flex-shrink-0" style={{ animationDelay: `${i * 0.4}s` }} />
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
  // 프로필 완성도 게이팅: 필수 컬럼이 비면 유령 계정으로 보고 서비스 진입 차단
  const [profileIncomplete, setProfileIncomplete] = useState(false);

  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [viewStep, setViewStep] = useState<ViewStep>('input');
  const [keyword, setKeyword] = useState<string>('');
  const [hospitalType, setHospitalType] = useState<string>('피부과');
  const [additionalInfo, setAdditionalInfo] = useState<string>('');
  const [writingStyle, setWritingStyle] = useState<WritingStyle>('전문가');
  const [optimizationMode, setOptimizationMode] = useState<OptimizationMode>('seo+geo');
  const [targetSite, setTargetSite] = useState<TargetSite>('naver');
  // DUMBIFY 난이도 — 기본 ON('easy')
  const [readability, setReadability] = useState<Readability>('easy');
  // VOICE-DNA 우리 병원 문체 적용 — 기본 ON
  const [useVoiceDna, setUseVoiceDna] = useState<boolean>(true);
  // VIRAL-HOOKS·STORYTELLING — 의료광고법 리스크 선택 기능, 기본 OFF
  const [viralHook, setViralHook] = useState<boolean>(false);
  const [storytelling, setStorytelling] = useState<boolean>(false);
  // 상위노출 역분석 — 상위 글 골격 반영, 기본 ON
  const [reverseAnalysis, setReverseAnalysis] = useState<boolean>(true);
  const [titles, setTitles] = useState<BlogTitle[]>([]);
  const [selectedTitle, setSelectedTitle] = useState<BlogTitle | null>(null);
  const [content, setContent] = useState<BlogContent | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [tags, setTags] = useState<TagResult | null>(null);

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
  // 무료 체험 잔여 횟수 (유료/관리자=null → 배지 미표시)
  const [freeCredits, setFreeCredits] = useState<number | null>(null);
  // 세션 갱신 중 일시적 null → 홈 리다이렉트 방지용 (한 번이라도 로그인됐으면 true)
  const wasEverLoggedInRef = useRef(false);
  // 자동저장 디바운스 타이머
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 복원할 초안 (마운트 시 localStorage에서 감지)
  const [draftToRestore, setDraftToRestore] = useState<DraftData | null>(null);
  // 경쟁분석에서 넘어온 prefill 키워드 (KeywordInput 초기값으로 주입)
  const [prefillKeyword, setPrefillKeyword] = useState<string>('');
  // 온보딩 완주 가이드 배너 (결제 직후 ?welcome=1 또는 유료+사용량 0)
  const [showWelcome, setShowWelcome] = useState(false);
  // prefill 적용 시 KeywordInput 을 강제 리마운트하기 위한 키
  const [keywordInputKey, setKeywordInputKey] = useState(0);
  // 복사 시 보관함 자동 저장: 첫 복사 후 글 id 보관 → 재복사는 PATCH로 갱신 (중복 insert 방지)
  const savedPostIdRef = useRef<string | null>(null);
  // VOICE-DNA: AI 생성 직후 원본 본문 스냅샷 보관 (편집 학습용 {원본, 수정본} 쌍의 원본).
  // 복사 저장 시 original_content 로 전송. savedPostIdRef 와 동일 시점에 리셋한다.
  const originalBodyRef = useRef<string | null>(null);
  // 연속 복사 시 POST 중복 실행 방지용 직렬화 큐
  const copySaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthChecked(true);
      if (data.user) wasEverLoggedInRef.current = true;
      else setShowAuthModal(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      // TOKEN_REFRESHED / INITIAL_SESSION 등 갱신 이벤트에선 모달 상태를 바꾸지 않는다.
      // SIGNED_OUT 이벤트일 때만 로그인 모달을 열어 세션 갱신 중 오탐 리다이렉트를 방지한다.
      if (event === 'SIGNED_OUT') {
        setShowAuthModal(true);
      } else if (session?.user) {
        wasEverLoggedInRef.current = true;
        setShowAuthModal(false);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  // 플랜/사용량/병원정보 fetch + 프로필 완성도 게이팅
  useEffect(() => {
    if (!user) {
      setUserPlan(null); setHospitalName(''); setProfileRegion('');
      setProfileIncomplete(false);
      return;
    }
    let cancelled = false;
    supabase.from('profiles')
      .select('plan, usage_count, hospital_type, hospital_name, hospital_address, full_name, phone, position, plan_expires_at, free_credits')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        const profile = data as {
          plan: string; usage_count: number; hospital_type?: string | null;
          hospital_name?: string | null; hospital_address?: string | null;
          full_name?: string | null; phone?: string | null; position?: string | null;
          plan_expires_at?: string | null;
          free_credits?: number | null;
        } | null;

        const incomplete =
          !isClientAdmin(user.email) &&
          (!profile ||
            !profile.full_name ||
            !profile.phone ||
            !profile.hospital_name ||
            !profile.position ||
            !profile.hospital_type);
        setProfileIncomplete(incomplete);
        if (incomplete) setShowAuthModal(true);

        if (profile) {
          setUserPlan({ plan: profile.plan, usage_count: profile.usage_count, hospital_type: profile.hospital_type });

          // 미구독(free)·만료 회원: 생성 시도를 기다리지 않고 진입 즉시 구독 안내 배너 노출
          // (가입 직후 결제 안내를 한 번도 못 보고 이탈하는 전환 누수 방지 — 관리자·프로필 미완성 모달과 중복 제외)
          if (!isClientAdmin(user.email) && !incomplete && !isActivePlan(profile.plan, profile.plan_expires_at ?? null)) {
            // 무료 2회 크레딧(2026-07-04): 잔여가 있으면 차단하지 않고 체험 배지로 안내,
            // 소진했을 때만 결제 유도 차단 배너
            const fc = profile.free_credits ?? 0;
            if (fc > 0) {
              setFreeCredits(fc);
            } else {
              setBlocked(true);
              setError('무료 체험 2회를 모두 사용하셨어요. 구독하면 매달 계속 이용할 수 있어요.');
            }
          }

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
    return () => { cancelled = true; };
  }, [user, supabase]);

  // 마운트 시 저장된 생성 옵션 복원 (SSR 하이드레이션 안전을 위해 useEffect에서 적용 후 리마운트)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(GEN_PREFS_KEY);
      if (!raw) return;
      const p = parseGenPrefs(raw);
      if (Object.keys(p).length === 0) return;
      if (p.writingStyle !== undefined) setWritingStyle(p.writingStyle);
      if (p.optimizationMode !== undefined) setOptimizationMode(p.optimizationMode);
      if (p.targetSite !== undefined) setTargetSite(p.targetSite);
      if (p.readability !== undefined) setReadability(p.readability);
      if (p.useVoiceDna !== undefined) setUseVoiceDna(p.useVoiceDna);
      if (p.viralHook !== undefined) setViralHook(p.viralHook);
      if (p.storytelling !== undefined) setStorytelling(p.storytelling);
      if (p.reverseAnalysis !== undefined) setReverseAnalysis(p.reverseAnalysis);
      // KeywordInput 은 default* 를 초기값으로만 쓰므로 리마운트해서 반영
      setKeywordInputKey((k) => k + 1);
    } catch {
      // 복원 실패는 무시 — 기본값으로 진행
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 마운트 시 저장된 초안 감지
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<DraftData>;
      // 필수 필드 검증 후 안전하게 기본값으로 채워서 복원
      const draft: DraftData = {
        keyword: typeof parsed.keyword === 'string' ? parsed.keyword : '',
        hospitalType: typeof parsed.hospitalType === 'string' ? parsed.hospitalType : '',
        additionalInfo: typeof parsed.additionalInfo === 'string' ? parsed.additionalInfo : '',
        writingStyle: parsed.writingStyle ?? '전문가',
        optimizationMode: parsed.optimizationMode ?? 'seo+geo',
        // 구버전 초안에는 targetSite가 없으므로 'naver' 기본값으로 하위 호환
        targetSite: parsed.targetSite === 'google' ? 'google' : 'naver',
        // 구버전 초안에는 readability가 없으므로 'easy'(기본 ON) 기본값으로 하위 호환
        readability: parsed.readability === 'standard' ? 'standard' : 'easy',
        // 구버전 초안에는 useVoiceDna가 없으므로 true(기본 ON) 기본값으로 하위 호환
        useVoiceDna: parsed.useVoiceDna !== false,
        // 구버전 초안에는 viralHook·storytelling이 없으므로 false(기본 OFF) 기본값으로 하위 호환
        viralHook: parsed.viralHook === true,
        storytelling: parsed.storytelling === true,
        // 구버전 초안에는 reverseAnalysis가 없으므로 true(기본 ON) 기본값으로 하위 호환
        reverseAnalysis: parsed.reverseAnalysis !== false,
        titles: Array.isArray(parsed.titles) ? parsed.titles : [],
        selectedTitle: parsed.selectedTitle ?? null,
        content: parsed.content ?? null,
        tags: parsed.tags ?? null,
        viewStep: (parsed.viewStep === 'input' || parsed.viewStep === 'content') ? parsed.viewStep : 'input',
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
      };
      if (draft.keyword || draft.content || draft.titles.length > 0) setDraftToRestore(draft);
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  // 온보딩 완주 가이드: ?welcome=1(결제 직후) 감지 → 첫 글 가이드 배너. URL은 즉시 정리.
  useEffect(() => {
    try {
      if (localStorage.getItem(WELCOME_DONE_KEY)) return;
      const params = new URLSearchParams(window.location.search);
      if (params.get('welcome') === '1' || params.get('welcome') === 'free') {
        setShowWelcome(true);
        params.delete('welcome');
        const qs = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
      }
    } catch {
      // storage/URL 접근 실패는 무시 — 가이드는 부가 기능
    }
  }, []);

  // 유료 플랜인데 아직 글 0건이면(결제 후 이탈했다 돌아온 경우 포함) 가이드 배너 노출
  useEffect(() => {
    try {
      if (localStorage.getItem(WELCOME_DONE_KEY)) return;
      if (userPlan && isPaidPlanId(userPlan.plan) && (userPlan.usage_count ?? 0) === 0) {
        setShowWelcome(true);
      }
    } catch {
      // 무시
    }
  }, [userPlan]);

  const dismissWelcome = () => {
    setShowWelcome(false);
    try { localStorage.setItem(WELCOME_DONE_KEY, '1'); } catch { /* 무시 */ }
  };

  // 마운트 시 경쟁분석 prefill 감지 → 키워드 입력란 자동 채움
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TOPIC_PREFILL_KEY);
      if (!raw) return;
      localStorage.removeItem(TOPIC_PREFILL_KEY);
      const parsed = JSON.parse(raw) as { topic?: unknown; keyword?: unknown };
      const kw =
        (typeof parsed.keyword === 'string' && parsed.keyword.trim()) ||
        (typeof parsed.topic === 'string' && parsed.topic.trim()) ||
        '';
      if (!kw) return;
      setPrefillKeyword(kw);
      setKeyword(kw);
      // KeywordInput 은 defaultKeyword 를 초기값으로만 쓰므로 리마운트해서 반영
      setKeywordInputKey((k) => k + 1);
    } catch {
      localStorage.removeItem(TOPIC_PREFILL_KEY);
    }
  }, []);

  // 2초 디바운스 자동저장 (의미있는 상태가 있을 때만)
  useEffect(() => {
    if (!keyword && !content && titles.length === 0) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      try {
        const draft: DraftData = {
          keyword, hospitalType, additionalInfo, writingStyle, optimizationMode, targetSite, readability, useVoiceDna, viralHook, storytelling, reverseAnalysis,
          titles, selectedTitle, content, tags, viewStep,
          savedAt: new Date().toISOString(),
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch { /* 저장 실패 무시 */ }
    }, 2000);
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [keyword, hospitalType, additionalInfo, writingStyle, optimizationMode, targetSite, readability, useVoiceDna, viralHook, storytelling, reverseAnalysis, titles, selectedTitle, content, tags, viewStep]);

  const restoreDraft = () => {
    if (!draftToRestore) return;
    setKeyword(draftToRestore.keyword);
    setHospitalType(draftToRestore.hospitalType);
    setAdditionalInfo(draftToRestore.additionalInfo);
    setWritingStyle(draftToRestore.writingStyle);
    setOptimizationMode(draftToRestore.optimizationMode);
    setTargetSite(draftToRestore.targetSite);
    setReadability(draftToRestore.readability);
    setUseVoiceDna(draftToRestore.useVoiceDna);
    setViralHook(draftToRestore.viralHook);
    setStorytelling(draftToRestore.storytelling);
    setReverseAnalysis(draftToRestore.reverseAnalysis);
    setTitles(draftToRestore.titles);
    setSelectedTitle(draftToRestore.selectedTitle);
    setContent(draftToRestore.content);
    setTags(draftToRestore.tags);
    setViewStep(draftToRestore.viewStep);
    setDraftToRestore(null);
    // 복원된 초안은 다른 글이므로 복사-저장 id 리셋
    savedPostIdRef.current = null;
    // VOICE-DNA 원본 스냅샷도 리셋 (복원본은 AI 원본을 알 수 없으므로 학습 대상 제외)
    originalBodyRef.current = null;
  };

  const dismissDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setDraftToRestore(null);
  };

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

  const handleKeywordSubmit = async (kw: string, ht: string, ai: string, ws: WritingStyle, inputRegion: string, om: OptimizationMode, ts: TargetSite, rd: Readability, uvd: boolean, vh: boolean, st: boolean, ra: boolean) => {
    // 새 작업 시작 시 저장된 초안 삭제
    localStorage.removeItem(DRAFT_KEY);
    setDraftToRestore(null);
    // 이번 생성에 쓴 옵션을 저장 → 다음 생성부터 자동 적용 (실패해도 생성은 계속)
    try {
      const prefs: GenPrefs = {
        writingStyle: ws, optimizationMode: om, targetSite: ts, readability: rd,
        useVoiceDna: uvd, viralHook: vh, storytelling: st, reverseAnalysis: ra,
      };
      localStorage.setItem(GEN_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // storage 불가 환경(프라이빗 모드 등) 무시
    }
    setKeyword(kw);
    setHospitalType(ht);
    setAdditionalInfo(ai);
    setWritingStyle(ws);
    setOptimizationMode(om);
    setTargetSite(ts);
    setReadability(rd);
    setUseVoiceDna(uvd);
    setViralHook(vh);
    setStorytelling(st);
    setReverseAnalysis(ra);
    setTitles([]);
    setSelectedTitle(null);
    setContent(null);
    setImages([]);
    setTags(null);
    setError(null);
    setRetryAction(null);
    setViewStep('input');
    setLoadingTitles(true);
    // 새 글 시작 → 복사-저장 id 리셋 (다음 복사는 새 글로 insert)
    savedPostIdRef.current = null;
    // VOICE-DNA 원본 스냅샷 리셋 (새 작업)
    originalBodyRef.current = null;

    const effectiveRegion = inputRegion || profileRegion;

    try {
      const res = await fetch('/api/generate-titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw, hospitalType: ht, region: effectiveRegion, targetSite: ts }),
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
    // 본문 생성 = 온보딩 완주 — 가이드 배너 영구 종료
    if (showWelcome) dismissWelcome();
    setContent(null);
    setImages([]);
    setTags(null);
    setCardNewsData(null);
    setError(null);
    setRetryAction(null);
    setLoadingContent(true);
    // 제목 변경/본문 재생성 → 새 글이므로 복사-저장 id 리셋
    savedPostIdRef.current = null;
    // VOICE-DNA 원본 스냅샷 리셋 (재생성 → 새 원본을 아래에서 다시 채움)
    originalBodyRef.current = null;

    try {
      const effectiveRegion = profileRegion;

      // 1. generate-content 먼저 실행 (사용량 차감 포함)
      // safeFetchJson 으로 감싸 2패스 생성이 maxDuration 을 넘겨 Vercel 이
      // HTML/텍스트 504 를 반환해도 JSON.parse 예외("Unexpected token 'A',
      // \"An error o\"...") 가 컴포넌트로 새지 않고 한국어 안내로 표시되게 한다.
      const result = await safeFetchJson<BlogContent>('/api/generate-content', {
        method: 'POST',
        body: JSON.stringify({
          title: selectedTitle.title, keyword, hospitalType, additionalInfo,
          titleFormat: selectedTitle.seoDetails?.format, writingStyle,
          region: effectiveRegion, hospitalName, optimizationMode, targetSite, readability, useVoiceDna, viralHook, storytelling, reverseAnalysis,
        }),
      });

      if (!result.ok) {
        // safeFetchJson 은 실패 시 원본 payload 필드(reason 등)를 보존하므로
        // 기존 플랜 차단 분기를 그대로 유지한다.
        const reason = (result as { reason?: unknown }).reason as string | undefined;
        const isBlocked = reason === 'plan_required' || reason === 'plan_expired' || reason === 'limit_exceeded';
        const err = new Error(result.error || '본문 생성에 실패했습니다.');
        if (isBlocked) (err as Error & { _blocked?: boolean })._blocked = true;
        throw err;
      }
      setContent(result.data);
      // VOICE-DNA: AI 원본 본문 스냅샷 보관 (이후 사용자 편집본과 쌍을 이뤄 학습)
      originalBodyRef.current = result.data.body;
      setViewStep('content');

      // 2. generate-tags 별도 실행 (실패해도 content는 보존)
      try {
        const tagRes = await fetch('/api/generate-tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword, title: selectedTitle.title, hospitalType }),
        });
        if (tagRes.ok) {
          const tagData = await tagRes.json();
          setTags(tagData);
        }
      } catch {
        // 태그 생성 실패는 무시 (content는 이미 저장됨)
      }
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
    if (action === 'titles') handleKeywordSubmit(keyword, hospitalType, additionalInfo, writingStyle, profileRegion, optimizationMode, targetSite, readability, useVoiceDna, viralHook, storytelling, reverseAnalysis);
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
      // safeFetchJson 으로 감싸 Vercel HTML 504/500 같은 비-JSON 응답이 와도
      // JSON.parse 예외 ("Unexpected token 'A', \"An error o\"...") 가 컴포넌트로
      // 새지 않게 한다.
      const result = await safeFetchJson<{ images: GeneratedImage[] }>(
        '/api/generate-images',
        {
          method: 'POST',
          body: JSON.stringify({ keyword, title: selectedTitle.title, body: content?.body ?? '', count, style: activeStyle }),
        }
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setImages(result.data.images);
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
      const result = await safeFetchJson<CardNewsData>(
        '/api/generate-cardnews-slides',
        {
          method: 'POST',
          body: JSON.stringify({ keyword, title: selectedTitle.title, body: content.body, hospitalType }),
        }
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCardNewsData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoadingSlides(false);
    }
  };

  const handleImagesUploaded = (files: File[]) => {
    const readers = files.map(file => new Promise<GeneratedImage>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve({
        id: `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        url: e.target?.result as string,
        prompt: file.name,
        revised_prompt: file.name,
      });
      reader.onerror = () => reject(new Error(`${file.name} 파일을 읽을 수 없습니다.`));
      reader.readAsDataURL(file);
    }));
    Promise.all(readers)
      .then(newImages => setImages(prev => [...prev, ...newImages]))
      .catch(() => setError('이미지 파일을 읽는 데 실패했습니다.'));
  };

  const handleContentChange = (newBody: string) => {
    // 글자수 재계산 — generate-content API와 동일한 방식 (이미지 자리표시자 제외, 공백 포함)
    const charCount = newBody.replace(/\[이미지\s*\d+:[^\]]*\]/g, '').length;
    // 의료광고법 재검사 — 편집으로 위반 표현이 추가/제거돼도 즉시 반영
    const compliance = checkCompliance(newBody);
    setContent(prev => prev ? { ...prev, body: newBody, charCount, compliance } : prev);
  };

  // 복사 = 발행 간주 → 보관함(saved_posts)에 published 상태로 백그라운드 자동 저장.
  // 첫 복사는 POST(insert), 같은 글 재복사는 PATCH(갱신)로 중복 저장을 방지한다.
  // 저장 실패는 복사 UX를 막지 않도록 조용히 무시한다 (초안은 LocalStorage에 별도 보존됨).
  const handleContentCopied = () => {
    if (!user || !content) return;
    const payload = {
      title: content.title,
      body: content.body, // 직접 편집 반영본
      keyword,
      targetSite,
    };
    // VOICE-DNA: AI 원본 스냅샷 (편집 학습용). null이면 컬럼 제외(하위 호환은 API가 처리).
    const originalContent = originalBodyRef.current;
    // 컴플라이언스 증빙 스냅샷 — A층(편집 반영 재검사분) + B층(생성 시 LLM 심의) 결과를
    // 저장 시점에 정리해 함께 보관한다(리포트 페이지 /app/report/[postId]에서 재사용).
    const complianceReport = buildComplianceReport({
      compliance: content.compliance,
      aiReview: content.aiReview ?? null,
    });
    copySaveQueueRef.current = copySaveQueueRef.current.then(async () => {
      try {
        const existingId = savedPostIdRef.current;
        if (existingId) {
          await fetch(`/api/posts/${existingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: payload.title,
              content: payload.body,
              keyword: payload.keyword,
              target_site: payload.targetSite,
              status: 'published',
              compliance_report: complianceReport,
              ...(originalContent ? { original_content: originalContent } : {}),
            }),
          });
          triggerVoiceDnaRefresh();
          return;
        }
        const res = await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: payload.title,
            content: payload.body,
            keyword: payload.keyword,
            target_site: payload.targetSite,
            status: 'published',
            compliance_report: complianceReport,
            ...(originalContent ? { original_content: originalContent } : {}),
          }),
        });
        if (res.ok) {
          const json = await res.json() as { post?: { id?: string } };
          if (typeof json.post?.id === 'string') savedPostIdRef.current = json.post.id;
          triggerVoiceDnaRefresh();
        }
      } catch {
        // 백그라운드 저장 실패 무시 — 복사 자체는 이미 성공했고 UX를 막지 않는다
      }
    });
  };

  // VOICE-DNA 카드 갱신 트리거 — 복사 저장 성공 후 fire-and-forget.
  // 서버가 임계(의미 있는 편집쌍 3개 이상)를 판단하므로 매번 호출해도 안전하다.
  // 실패는 조용히 무시 — 복사 UX를 막지 않는다.
  const triggerVoiceDnaRefresh = () => {
    void fetch('/api/voice-dna/refresh', { method: 'POST' }).catch(() => {});
  };

  const STYLE_LABEL: Record<WritingStyle, string> = {
    '전문가': '🩺 전문가시점',
    '고객이해': '👥 고객이해시점',
    '사무장': '🏥 사무장시점',
  };

  const userIsAdmin = isClientAdmin(user?.email);
  const planLimit = (userPlan !== null || userIsAdmin) ? getPlanUsageLimit(userPlan?.plan, userIsAdmin) : null;

  return (
    <div className="min-h-screen bg-[#eaeef4] text-[#202020]">
      {showAuthModal && (
        <AuthModal
          // 프로필 미완성(유령 계정) 또는 비로그인 상태면 회원가입 탭으로 유도
          initialMode={profileIncomplete ? 'signup' : 'login'}
          onClose={() => {
            if (user && !profileIncomplete) {
              setShowAuthModal(false);
            } else if (wasEverLoggedInRef.current) {
              // 세션 갱신 중 일시적 null일 수 있으므로 홈 리다이렉트 하지 않음
              setShowAuthModal(false);
            } else {
              // 한 번도 로그인된 적 없으면 홈으로
              router.push('/');
            }
          }}
          onSuccess={() => {
            // 가입/로그인 성공 시 게이트 해제 (프로필 재검증은 user 변경 effect가 수행)
            setProfileIncomplete(false);
            setShowAuthModal(false);
          }}
          closable={true}
        />
      )}

      {/* 헤더 */}
      <header className="sticky top-0 z-40 border-b border-[#b4bfce] bg-white/85 backdrop-blur-md">
        <div className="max-w-screen-2xl mx-auto px-3 sm:px-4 h-13 sm:h-14 flex items-center justify-between gap-2 sm:gap-4" style={{ minHeight: '52px' }}>
          <Link href="/" className="flex items-center gap-2 flex-shrink-0 hover:opacity-80 transition-opacity" title="홈으로">
            <div className="w-8 h-8 rounded-xl bg-[#ffece7] border border-[#ff4628]/30 flex items-center justify-center shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
              <span className="text-base">🏥</span>
            </div>
            <span className="font-bold text-[#202020] text-lg">닥터포스트</span>
          </Link>

          <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-center">
            {viewStep === 'input' ? (
              <>
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-[#ffece7] text-[#ff4628] border border-[#ff4628]/30 text-[10px] sm:text-xs font-semibold">
                  <span className="w-1.5 h-1.5 bg-[#ff4628] rounded-full animate-pulse flex-shrink-0" />
                  <span className="sm:hidden">Step 1</span>
                  <span className="hidden sm:inline">Step 1 · 키워드 → 제목 선택</span>
                </div>
                <span className="text-[#73808f] text-xs hidden sm:block">→</span>
                <div className="hidden sm:block px-2.5 py-1 rounded-full bg-[#eef2f6] text-[#73808f] border border-[#b4bfce] text-xs font-semibold">
                  Step 2 · 본문 · 이미지
                </div>
              </>
            ) : selectedTitle ? (
              <>
                <button
                  onClick={() => setViewStep('input')}
                  className="flex items-center gap-1 text-[#5b6573] hover:text-[#202020] active:text-[#202020] transition-colors flex-shrink-0 text-xs min-h-[36px] px-1"
                >
                  ← 뒤로
                </button>
                <span className="text-[#73808f] text-xs">·</span>
                <span className="text-[#202020] truncate text-[10px] sm:text-xs">{selectedTitle.title}</span>
                <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-[#eef2f6] text-[9px] text-[#5b6573] border border-[#b4bfce] hidden sm:block">
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
            {planLimit !== null && planLimit !== 0 && (userPlan || userIsAdmin) && (
              <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-[#eef2f6] border border-[#b4bfce]">
                <span className={`text-[10px] font-semibold ${!userIsAdmin && userPlan && userPlan.usage_count >= planLimit ? 'text-red-500' : 'text-[#5b6573]'}`}>
                  {userIsAdmin ? '관리자 · ∞' : `${userPlan?.usage_count ?? 0}/${planLimit === Infinity ? '∞' : planLimit}회`}
                </span>
              </div>
            )}
            {authChecked && (
              user ? (
                <>
                  <span className="text-xs text-[#5b6573] hidden lg:block max-w-[120px] truncate">{user.email}</span>
                  <Link
                    href="/mypage"
                    title="마이페이지"
                    className="px-2.5 sm:px-3 py-1.5 text-xs border border-[#b4bfce] rounded-lg text-[#5b6573] hover:bg-[#eef2f6] hover:text-[#202020] active:bg-[#eef2f6] transition-colors min-h-[36px] flex items-center gap-1"
                  >
                    <span>👤</span>
                    <span className="hidden sm:inline">마이페이지</span>
                  </Link>
                  {isClientAdmin(user.email) && (
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
                    className="px-2.5 sm:px-3 py-1.5 text-xs border border-[#b4bfce] rounded-lg text-[#5b6573] hover:bg-[#eef2f6] hover:text-[#202020] active:bg-[#eef2f6] transition-colors min-h-[36px]"
                  >
                    로그아웃
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="px-2.5 sm:px-3 py-1.5 bg-[#ff4628] hover:bg-[#e63a1c] active:bg-[#e63a1c] text-white text-xs font-bold rounded-lg transition-colors min-h-[36px]"
                >
                  로그인
                </button>
              )
            )}
          </div>
        </div>
      </header>

      {/* 저장된 초안 복원 배너 */}
      {draftToRestore && (
        <div className="max-w-screen-2xl mx-auto px-4 pt-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-[#eef2f6] border border-[#ff4628]/40 rounded-xl px-4 py-3">
            <span className="text-xl flex-shrink-0">📋</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#202020]">
                이전에 작성하던 내용이 있습니다
                <span className="ml-2 text-[10px] font-normal text-[#5b6573]">
                  {new Date(draftToRestore.savedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 저장
                </span>
              </p>
              <p className="text-xs text-[#5b6573] mt-0.5 truncate">
                키워드: {draftToRestore.keyword || '(없음)'}
                {draftToRestore.content && ' · 본문 작성됨'}
                {draftToRestore.titles.length > 0 && ` · 제목 ${draftToRestore.titles.length}개`}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={restoreDraft}
                className="px-3 py-1.5 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-xs font-bold rounded-lg transition-colors min-h-[34px]"
              >
                복원하기
              </button>
              <button
                onClick={dismissDraft}
                className="px-3 py-1.5 border border-[#b4bfce] text-[#5b6573] hover:text-[#202020] hover:border-[#ff4628]/40 text-xs rounded-lg transition-colors min-h-[34px]"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 무료 체험 잔여 배지 (미구독 + 크레딧 보유) — 차단 대신 체험으로 안내 */}
      {!blocked && freeCredits !== null && freeCredits > 0 && (
        <div className="max-w-screen-2xl mx-auto px-4 pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 bg-[#eafaf0] border border-[#c9ead2] rounded-2xl px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-[#1c7c3d]">
              🎁 무료 체험 {freeCredits}회 남음
            </span>
            <span className="text-xs sm:text-sm text-[#3f5468]">
              키워드만 입력하면 의료광고법 검수까지 끝난 글이 60초 안에 나와요. 지금 바로 써보세요.
            </span>
          </div>
        </div>
      )}

      {/* 구독 플랜 필요 알림 (한도 초과 / 미구독 / 만료 / 무료 소진) */}
      {blocked && (
        <div className="max-w-screen-2xl mx-auto px-4 pt-4">
          <div className="bg-[#ffece7] border border-[#ff4628]/40 rounded-2xl p-5 sm:p-6">
            <div className="flex items-start gap-3 mb-4">
              <span className="text-3xl flex-shrink-0">💎</span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[#202020] text-base sm:text-lg mb-1">구독 플랜이 필요합니다</p>
                <p className="text-xs sm:text-sm text-[#4a4f55]">{error}</p>
              </div>
              <button
                onClick={dismissBlocked}
                className="text-[#4a4f55] hover:text-[#202020] text-2xl leading-none flex-shrink-0"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Link
                href="/#pricing"
                className="flex-1 py-3 bg-[#ff4628] hover:bg-[#e63a1c] active:bg-[#e63a1c] text-white text-sm font-bold rounded-xl text-center transition-colors flex items-center justify-center gap-2"
              >
                💎 구독 플랜 보기
              </Link>
              <Link
                href="/app/subscription"
                className="flex-1 py-3 bg-white hover:bg-[#eef2f6] text-[#202020] text-sm font-semibold rounded-xl text-center transition-colors border border-[#b4bfce] flex items-center justify-center gap-2"
              >
                ⚙️ 구독 관리
              </Link>
              <Link
                href="/"
                className="flex-1 py-3 bg-transparent hover:bg-[#eef2f6] text-[#5b6573] hover:text-[#202020] text-sm font-semibold rounded-xl text-center transition-colors border border-[#b4bfce] flex items-center justify-center gap-2"
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
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-3">
            <span className="text-red-500 text-lg flex-shrink-0">❌</span>
            <div className="flex-1">
              <p className="font-semibold text-red-600 text-sm">오류 발생</p>
              <p className="text-xs text-red-500 mt-0.5">{error}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {retryAction && (
                <button
                  onClick={handleRetry}
                  className="px-3 py-1.5 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-xs font-bold rounded-lg transition-colors min-h-[36px]"
                >
                  🔄 다시 시도
                </button>
              )}
              <button onClick={() => setError(null)} className="text-red-500 hover:text-red-600 text-lg leading-none">×</button>
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

                {/* 온보딩 완주 가이드 — 첫 글 3단계 (첫 본문 생성 시 영구 종료) */}
                {!loadingContent && showWelcome && titles.length === 0 && (
                  <div className="mb-4 sm:mb-5 max-w-full sm:max-w-md mx-auto bg-[#14182a] text-white rounded-2xl p-4 sm:p-5 relative">
                    <button
                      onClick={dismissWelcome}
                      className="absolute top-3 right-3 text-white/50 hover:text-white text-xl leading-none"
                      aria-label="가이드 닫기"
                    >
                      ×
                    </button>
                    <p className="font-bold text-base mb-0.5">🎉 구독을 시작하셨네요! 첫 글, 3분이면 됩니다</p>
                    <p className="text-xs text-white/60 mb-3">첫 글을 발행해 본 병원이 검색 노출도 빨리 시작됩니다.</p>
                    <ol className="space-y-1.5 text-sm">
                      <li className="flex items-start gap-2">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#ff4628] text-white text-[11px] font-bold flex items-center justify-center mt-0.5">1</span>
                        <span>아래에 <b>시술·질환 키워드 하나</b>만 입력 (예: 레이저 토닝) — 추천 키워드를 눌러도 돼요</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#ff4628] text-white text-[11px] font-bold flex items-center justify-center mt-0.5">2</span>
                        <span>생성된 <b>제목 5개 중 하나</b>를 고르면 본문·이미지가 자동으로</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#ff4628] text-white text-[11px] font-bold flex items-center justify-center mt-0.5">3</span>
                        <span><b>복사 버튼</b>으로 네이버 블로그에 붙여넣으면 발행 끝</span>
                      </li>
                    </ol>
                  </div>
                )}

                {!loadingContent && (
                  <div className={`grid gap-4 sm:gap-5 ${titles.length > 0 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 max-w-full sm:max-w-md mx-auto'}`}>
                    <div className="space-y-4">
                      <KeywordInput
                        key={keywordInputKey}
                        onSubmit={handleKeywordSubmit}
                        isLoading={loadingTitles}
                        defaultKeyword={prefillKeyword || undefined}
                        defaultWritingStyle={writingStyle}
                        defaultOptimizationMode={optimizationMode}
                        defaultTargetSite={targetSite}
                        defaultReadability={readability}
                        defaultUseVoiceDna={useVoiceDna}
                        defaultViralHook={viralHook}
                        defaultStorytelling={storytelling}
                        defaultReverseAnalysis={reverseAnalysis}
                        lockedHospitalType={userPlan?.hospital_type ?? undefined}
                        defaultRegion={profileRegion}
                      />

                      {/* 주간 갭 리포트 — 경쟁 블로그는 다루는데 우리 글엔 없는 주제 (클릭 → 키워드 채움) */}
                      {userPlan?.hospital_type && profileRegion && (
                        <ContentGapSuggestions
                          specialty={userPlan.hospital_type}
                          region={profileRegion}
                          onSelect={(kw) => {
                            setPrefillKeyword(kw);
                            setKeyword(kw);
                            setKeywordInputKey((k) => k + 1);
                          }}
                        />
                      )}

                      {/* 크로스 콘텐츠 추천 — 잘 되는 글은 영상으로, 영상 주제는 후속 글로 (추천 없으면 자동 숨김) */}
                      {user && (
                        <CrossContentRecommendations
                          onSelectKeyword={(kw) => {
                            setPrefillKeyword(kw);
                            setKeyword(kw);
                            setKeywordInputKey((k) => k + 1);
                          }}
                        />
                      )}
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
                          onClick={() => handleKeywordSubmit(keyword, hospitalType, additionalInfo, writingStyle, profileRegion, optimizationMode, targetSite, readability, useVoiceDna, viralHook, storytelling, reverseAnalysis)}
                          disabled={loadingTitles}
                          className="w-full py-2.5 text-xs text-[#5b6573] hover:text-[#202020] border border-[#b4bfce] hover:border-[#ff4628]/40 bg-white hover:bg-[#eef2f6] rounded-xl transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40"
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
                    <p className="text-base font-semibold text-[#202020] mb-1">키워드를 입력하여 시작하세요</p>
                    <p className="text-xs text-[#5b6573] mb-5">
                      네이버 C-Rank · D.I.A+ 알고리즘 기반 SEO 최적화 블로그 자동 생성
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {['레이저 토닝', '보톡스 시술', '도수치료', '허리디스크', '임플란트', '라식 수술'].map((kw) => (
                        <span key={kw} className="bg-[#eef2f6] text-[#5b6573] text-xs px-3 py-1.5 rounded-full border border-[#b4bfce]">
                          {kw}
                        </span>
                      ))}
                    </div>

                    {/* #2 블로그 없이 멀티채널: 블로그를 아직 만들지 않아도 키워드/본문 붙여넣기로 바로 영상·멀티채널 제작 */}
                    {user && (
                      <div className="mt-8 max-w-full sm:max-w-md mx-auto">
                        <div className="flex items-center gap-3 mb-4" aria-hidden>
                          <span className="h-px flex-1 bg-[#cdd6e1]" />
                          <span className="text-xs text-[#73808f]">또는</span>
                          <span className="h-px flex-1 bg-[#cdd6e1]" />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            // 소스를 비워 idle 단계(키워드/붙여넣기 폼)로 진입한다. dp_multichannel_src 를 설정하지 않는다.
                            sessionStorage.removeItem(MULTICHANNEL_SRC_KEY);
                            router.push('/app/multichannel');
                          }}
                          className="w-full py-3.5 sm:py-4 rounded-xl bg-white hover:bg-[#fff1ee] text-[#ff4628] text-sm sm:text-base font-bold border border-[#ff4628]/40 transition-colors flex items-center justify-center gap-2"
                        >
                          <span className="text-lg">🎬</span>
                          <span>블로그 없이 멀티채널 만들기</span>
                        </button>
                        <p className="mt-2 text-xs text-[#73808f] leading-relaxed">
                          키워드만 입력하거나 기존 본문을 붙여넣어 영상 · 카드뉴스 · 스토리 · 쓰레드 · 피드를 만들 수 있어요.
                        </p>
                      </div>
                    )}
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
                      onCopied={handleContentCopied}
                    />

                    <button
                      type="button"
                      onClick={() => {
                        if (!content || !selectedTitle) return;
                        localStorage.setItem(
                          'dp_analysis_data',
                          JSON.stringify({
                            content,
                            title: selectedTitle.title,
                            keyword,
                          })
                        );
                        window.open('/app/analysis', '_blank', 'noopener,noreferrer');
                      }}
                      className="group analysis-cta relative w-full py-3.5 sm:py-4 rounded-xl border-2 border-emerald-400 hover:border-emerald-500 bg-gradient-to-r from-cyan-100 via-emerald-100 to-cyan-100 hover:from-cyan-200 hover:via-emerald-200 hover:to-cyan-200 text-slate-900 text-sm sm:text-base font-bold transition-all flex items-center justify-center gap-2.5"
                    >
                      <span className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75 animate-ping"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-300"></span>
                      </span>
                      <span className="text-lg">📊</span>
                      <span className="text-slate-900 font-extrabold">상세 분석 보기</span>
                      <span className="text-[10px] sm:text-[11px] text-slate-600 font-medium hidden sm:inline">(SEO · 독창성 · 네이버 검색 미리보기)</span>
                      <span className="text-emerald-700 group-hover:translate-x-1 transition-transform text-base font-extrabold">→ <span className="text-[10px] font-medium opacity-80">(새 창)</span></span>
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
                        imageStyle={imageStyle}
                        onBodyCopied={handleContentCopied}
                      />
                    )}

                    {/* 멀티채널 생성 (ClinicFlix) — 맨 아래 배치. 전용 페이지로 이동. 게이팅은 서버 + 페이지(UpgradeRequiredError)에서 처리 */}
                    {/* #1 블로그 → 멀티채널: 생성된 블로그 본문이 있을 때만 노출 (기존 동작 유지) */}
                    {user && content && (
                      <button
                        type="button"
                        onClick={() => {
                          // 복사 저장된 글이면 postId 를 함께 실어 변환 이력에 원본을 연결한다 (마이그 038).
                          // 저장 전이면 구 평문 포맷 그대로 (하위 호환 — 연결 없이 변환).
                          sessionStorage.setItem(
                            MULTICHANNEL_SRC_KEY,
                            encodeMultichannelSrc({
                              text: `${content.title}\n\n${content.body}`,
                              postId: savedPostIdRef.current,
                            }),
                          );
                          router.push('/app/multichannel');
                        }}
                        className="w-full py-3.5 sm:py-4 rounded-xl bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm sm:text-base font-bold transition-colors flex items-center justify-center gap-2"
                      >
                        <span className="text-lg">🎬</span>
                        <span>멀티채널 생성하기</span>
                        <span className="text-[10px] sm:text-[11px] font-medium opacity-90 hidden sm:inline">(영상 · 카드뉴스 · 스토리 · 쓰레드 · 피드)</span>
                      </button>
                    )}

                    {!user && authChecked && (
                      <div className="rounded-2xl border border-[#b4bfce] bg-white shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)] p-5 text-center">
                        <p className="text-sm font-semibold text-[#202020] mb-1">발행 도우미는 로그인 후 사용 가능합니다</p>
                        <p className="text-xs text-[#5b6573] mb-4">로그인하고 네이버 블로그에 바로 발행하세요</p>
                        <button
                          onClick={() => setShowAuthModal(true)}
                          className="px-5 py-2 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-bold rounded-xl transition-colors"
                        >
                          로그인 / 회원가입
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* 모바일 광고 — 데스크톱(xl) 사이드 배너 대신 본문 하단에 노출 */}
            <div className="xl:hidden mt-6 mx-auto w-full max-w-sm">
              <HospitalMarketingBanner />
            </div>
          </div>

          <AdBanner side="right" />
        </div>
      </main>

      <footer className="mt-16 border-t border-[#b4bfce] bg-white">
        <div className="max-w-screen-2xl mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-between gap-2">
          <p className="text-[10px] text-[#73808f]">
            본 서비스는 의료광고법(의료법 제56조) 준수를 지원합니다. 최종 광고 심의는 의료광고 심의기관을 통해 확인하시기 바랍니다.
          </p>
          <p className="text-[10px] text-[#73808f] flex-shrink-0">닥터포스트 © 2026 · Claude AI · 네이버 C-Rank · D.I.A+ 최적화</p>
        </div>
      </footer>

      <ContactFloatingButton />
    </div>
  );
}
