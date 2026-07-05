'use client';

export type MyPageTabId =
  | 'profile'
  | 'subscription'
  | 'usage'
  | 'posts'
  | 'rankings'
  | 'geo'
  | 'audit'
  | 'conversions'
  | 'brandkit'
  | 'voice'
  | 'photos';

export const MYPAGE_TABS: { id: MyPageTabId; label: string }[] = [
  { id: 'profile', label: '내 정보' },
  { id: 'subscription', label: '구독·결제' },
  { id: 'usage', label: '사용량' },
  { id: 'posts', label: '콘텐츠 보관함' },
  { id: 'rankings', label: '성과 리포트' },
  { id: 'geo', label: 'AI 검색' },
  { id: 'audit', label: '블로그 진단' },
  { id: 'conversions', label: '변환 내역' },
  { id: 'brandkit', label: '콘텐츠 설정' },
  { id: 'voice', label: '내 문체' },
  { id: 'photos', label: '사진 보관함' },
];

const MYPAGE_TAB_IDS: MyPageTabId[] = MYPAGE_TABS.map((t) => t.id);

export function isMyPageTabId(value: string | null): value is MyPageTabId {
  return value !== null && (MYPAGE_TAB_IDS as string[]).includes(value);
}

interface MyPageTabsProps {
  active: MyPageTabId;
  onChange: (tab: MyPageTabId) => void;
}

/** 마이페이지 탭 바 — 모바일에서는 가로 스크롤 */
export default function MyPageTabs({ active, onChange }: MyPageTabsProps) {
  return (
    <div
      className="flex gap-1 mb-6 bg-white border border-[#b4bfce] rounded-xl p-1 overflow-x-auto shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]"
      role="tablist"
      aria-label="마이페이지 탭"
    >
      {MYPAGE_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex-1 whitespace-nowrap text-center px-3 py-2 rounded-lg text-sm transition-colors min-w-fit ${
            active === tab.id
              ? 'bg-[#ffece7] text-[#ff4628] font-medium'
              : 'text-[#5b6573] hover:text-[#202020]'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
