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
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-sm">로딩 중...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-white font-semibold text-base mb-2">로그인이 필요합니다</div>
          <div className="text-gray-400 text-sm mb-6">마이페이지는 로그인 후 이용할 수 있습니다.</div>
          <a href="/" className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">
            앱으로 이동해서 로그인
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 py-6 sm:py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* 헤더 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
          <div>
            <h1 className="text-xl font-bold text-white">마이페이지</h1>
            <p className="text-gray-400 text-sm mt-0.5">{user.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/settings/team"
              className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              팀 관리
            </a>
            <a href="/app" className="text-sm text-gray-400 hover:text-gray-200 transition-colors">
              ← 앱으로
            </a>
          </div>
        </div>

        {/* 탭 */}
        <MyPageTabs active={activeTab} onChange={handleTabChange} />

        {/* 탭 콘텐츠 */}
        {activeTab === 'profile' && <ProfileTab />}
        {activeTab === 'subscription' && <SubscriptionTab />}
        {activeTab === 'usage' && <UsageTab />}
        {activeTab === 'posts' && <ContentArchiveTab />}
      </div>
    </div>
  );
}

export default function MyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-950 flex items-center justify-center">
          <div className="text-gray-400 text-sm">로딩 중...</div>
        </div>
      }
    >
      <MyPageContent />
    </Suspense>
  );
}
