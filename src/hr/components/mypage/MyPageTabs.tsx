'use client';

export type MyPageTabId = 'profile' | 'subscription' | 'usage' | 'posts';

export const MYPAGE_TABS: { id: MyPageTabId; label: string }[] = [
  { id: 'profile', label: '내 정보' },
  { id: 'subscription', label: '구독·결제' },
  { id: 'usage', label: '사용량' },
  { id: 'posts', label: '콘텐츠 보관함' },
];

export function isMyPageTabId(value: string | null): value is MyPageTabId {
  return value === 'profile' || value === 'subscription' || value === 'usage' || value === 'posts';
}

interface MyPageTabsProps {
  active: MyPageTabId;
  onChange: (tab: MyPageTabId) => void;
}

/** 마이페이지 탭 바 — 모바일에서는 가로 스크롤 */
export default function MyPageTabs({ active, onChange }: MyPageTabsProps) {
  return (
    <div
      className="flex gap-1 mb-6 bg-gray-900 border border-gray-800 rounded-xl p-1 overflow-x-auto"
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
              ? 'bg-blue-600 text-white font-medium'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
