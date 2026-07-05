'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/dev/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import MyPageTabs, { isMyPageTabId, type MyPageTabId } from '@/hr/components/mypage/MyPageTabs';
import ProfileTab from '@/hr/components/mypage/ProfileTab';
import SubscriptionTab from '@/hr/components/mypage/SubscriptionTab';
import UsageTab from '@/hr/components/mypage/UsageTab';
import ContentArchiveTab from '@/hr/components/mypage/ContentArchiveTab';
import RankingsTab from '@/hr/components/mypage/RankingsTab';
import GeoSearchTab from '@/hr/components/mypage/GeoSearchTab';
import BlogAuditTab from '@/hr/components/mypage/BlogAuditTab';
import ConversionHistoryTab from '@/hr/components/mypage/ConversionHistoryTab';
import BrandKitTab from '@/hr/components/mypage/BrandKitTab';
import VoiceDnaTab from '@/hr/components/mypage/VoiceDnaTab';
import PhotoLibraryTab from '@/hr/components/mypage/PhotoLibraryTab';

function MyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const tabParam = searchParams.get('tab');
  const activeTab: MyPageTabId = isMyPageTabId(tabParam) ? tabParam : 'profile';

  useEffect(() => {
    supabase.auth.getUser().then(({ data: d }) => {
      setUser(d.user);
      setAuthChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  const handleTabChange = useCallback((tab: MyPageTabId) => {
    router.replace(`/mypage?tab=${tab}`, { scroll: false });
  }, [router]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#eef2f6] flex items-center justify-center">
        <div className="text-[#5b6573] text-sm">로딩 중...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#eef2f6] flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-[#202020] font-semibold text-base mb-2">로그인이 필요합니다</div>
          <div className="text-[#5b6573] text-sm mb-6">마이페이지는 로그인 후 이용할 수 있습니다.</div>
          <a href="/" className="px-6 py-2.5 bg-[#ff4628] text-white rounded-lg text-sm font-semibold hover:bg-[#e63a1c] transition-colors">
            앱으로 이동해서 로그인
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eef2f6] py-6 sm:py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* 헤더 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
          <div>
            <h1 className="text-xl font-bold text-[#202020]">마이페이지</h1>
            <p className="text-[#5b6573] text-sm mt-0.5">{user.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/settings/team"
              className="text-sm text-[#5b6573] hover:text-[#202020] transition-colors"
            >
              팀 관리
            </a>
            <a href="/app" className="text-sm text-[#5b6573] hover:text-[#202020] transition-colors">
              ← 앱으로
            </a>
          </div>
        </div>

        {/* 품질 안내 — 정보를 채울수록 결과물 퀄리티가 올라간다 */}
        <div className="mb-5 rounded-xl border border-[#ff4628]/30 bg-[#ffece7] px-4 py-3.5">
          <p className="text-sm font-semibold text-[#202020] flex items-center gap-1.5">
            <span aria-hidden>✨</span> 정보를 채울수록 콘텐츠 퀄리티가 올라갑니다
          </p>
          <p className="text-xs text-[#5b6573] leading-relaxed mt-1.5">
            {(['profile', 'brandkit', 'photos'] as const).map((t, i) => (
              <span key={t}>
                {i > 0 && <span className="mx-1 text-[#b4bfce]">·</span>}
                <button
                  type="button"
                  onClick={() => handleTabChange(t)}
                  className="text-[#ff4628] font-medium underline underline-offset-2 hover:text-[#e63a1c]"
                >
                  {t === 'profile' ? '내 정보' : t === 'brandkit' ? '콘텐츠 설정' : '사진 보관함'}
                </button>
              </span>
            ))}
            <span>
              을 꼼꼼히 채워주세요. 로고 · 원장님 사진 · 병원 사진이 많을수록 더 우리 병원다운 영상과
              카드뉴스가 만들어집니다.
            </span>
          </p>
        </div>

        {/* 탭 */}
        <MyPageTabs active={activeTab} onChange={handleTabChange} />

        {/* 탭 콘텐츠 */}
        {activeTab === 'profile' && <ProfileTab />}
        {activeTab === 'subscription' && <SubscriptionTab />}
        {activeTab === 'usage' && <UsageTab />}
        {activeTab === 'posts' && <ContentArchiveTab />}
        {activeTab === 'rankings' && <RankingsTab />}
        {activeTab === 'geo' && <GeoSearchTab />}
        {activeTab === 'audit' && <BlogAuditTab />}
        {activeTab === 'conversions' && <ConversionHistoryTab />}
        {activeTab === 'brandkit' && <BrandKitTab />}
        {activeTab === 'voice' && <VoiceDnaTab />}
        {activeTab === 'photos' && <PhotoLibraryTab />}
      </div>
    </div>
  );
}

export default function MyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#eef2f6] flex items-center justify-center">
          <div className="text-[#5b6573] text-sm">로딩 중...</div>
        </div>
      }
    >
      <MyPageContent />
    </Suspense>
  );
}
