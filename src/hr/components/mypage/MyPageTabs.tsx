'use client';

import type { ReactNode } from 'react';
import {
  MYPAGE_GROUPS,
  groupOfTab,
  firstTabOfGroup,
  type MyPageTabId,
} from './mypage-tab-groups';

// 하위 호환 재수출 — 기존에 MyPageTabs 에서 import 하던 외부 코드 보호.
export { MYPAGE_TABS, MYPAGE_GROUPS, isMyPageTabId, groupOfTab, resolveMyPageTab } from './mypage-tab-groups';
export type { MyPageTabId, MyPageGroupId } from './mypage-tab-groups';

interface MyPageTabsProps {
  active: MyPageTabId;
  onChange: (tab: MyPageTabId) => void;
  /** 1층(그룹)과 2층(서브탭) 사이에 끼워 넣는 슬롯 — 성과·안전 요약 스트립 등. */
  summarySlot?: ReactNode;
}

/**
 * 마이페이지 2층 탭 바.
 * 1층: 그룹 4개 — 모바일에서도 스크롤 없이 한 줄(flex-1 균등).
 * 2층: 활성 그룹의 서브탭 — 언더라인 스타일로 1층보다 가볍게, 필요 시 가로 스크롤.
 * 그룹 버튼 클릭 시 그 그룹의 첫 서브탭으로 이동(딥링크 `?tab=` 은 지정 탭 우선).
 */
export default function MyPageTabs({ active, onChange, summarySlot }: MyPageTabsProps) {
  const activeGroupId = groupOfTab(active);
  const activeGroup = MYPAGE_GROUPS.find((g) => g.id === activeGroupId) ?? MYPAGE_GROUPS[0];

  return (
    <div className="mb-6">
      {/* 1층 — 그룹 4개 (한 줄 고정, 스크롤 없음) */}
      <div
        className="flex gap-1 bg-white border border-[#b4bfce] rounded-xl p-1 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]"
        role="tablist"
        aria-label="마이페이지 그룹"
      >
        {MYPAGE_GROUPS.map((group) => (
          <button
            key={group.id}
            type="button"
            role="tab"
            aria-selected={group.id === activeGroupId}
            onClick={() => {
              if (group.id !== activeGroupId) onChange(firstTabOfGroup(group.id));
            }}
            className={`flex-1 min-w-0 whitespace-nowrap text-center px-1 sm:px-3 py-2 rounded-lg text-[13px] sm:text-sm transition-colors ${
              group.id === activeGroupId
                ? 'bg-[#ffece7] text-[#ff4628] font-semibold'
                : 'text-[#5b6573] hover:text-[#202020]'
            }`}
          >
            {group.label}
          </button>
        ))}
      </div>

      {/* 그룹 요약 슬롯 — 서브탭 위 (성과·안전 요약 스트립) */}
      {summarySlot}

      {/* 2층 — 활성 그룹의 서브탭 (언더라인, 필요 시 가로 스크롤) */}
      <div
        className="flex gap-4 sm:gap-5 mt-3 px-1 border-b border-[#b4bfce]/50 overflow-x-auto"
        role="tablist"
        aria-label={`${activeGroup.label} 서브탭`}
      >
        {activeGroup.tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            onClick={() => onChange(tab.id)}
            className={`whitespace-nowrap pb-2 text-sm transition-colors border-b-2 -mb-px ${
              tab.id === active
                ? 'text-[#ff4628] font-semibold border-[#ff4628]'
                : 'text-[#5b6573] hover:text-[#202020] border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
