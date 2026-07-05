// 마이페이지 탭 2층 구조 정의 — 그룹 4개 → 그룹 내 서브탭.
// UI(React)와 분리된 순수 모듈: 그룹/탭 정의, tab→group 매핑, `?tab=` 딥링크 파싱.
// URL 은 기존과 동일하게 `?tab=<MyPageTabId>` 단일 파라미터만 사용하며,
// 그룹은 항상 탭 id 에서 유도한다(단일 진실 원천 — 그룹을 URL 에 넣지 않는다).

/** 마이페이지 서브탭 id 11종 — 외부 딥링크(`?tab=`)가 참조하므로 절대 변경 금지. */
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

/** 마이페이지 그룹 id 4종 — URL 에 노출하지 않는 내부 구조. */
export type MyPageGroupId = 'account' | 'content' | 'performance' | 'clinicflix';

export interface MyPageTabDef {
  id: MyPageTabId;
  label: string;
}

export interface MyPageGroupDef {
  id: MyPageGroupId;
  label: string;
  /** 그룹 내 서브탭 (최소 2개, 첫 번째가 그룹 진입 시 기본 탭). */
  tabs: readonly MyPageTabDef[];
}

/** 그룹 4개 정의 — 서브탭 소속과 순서의 단일 진실 원천. */
export const MYPAGE_GROUPS: readonly MyPageGroupDef[] = [
  {
    id: 'account',
    label: '내 계정',
    tabs: [
      { id: 'profile', label: '내 정보' },
      { id: 'subscription', label: '구독·결제' },
      { id: 'usage', label: '사용량' },
    ],
  },
  {
    id: 'content',
    label: '콘텐츠',
    tabs: [
      { id: 'posts', label: '콘텐츠 보관함' },
      { id: 'voice', label: '내 문체' },
    ],
  },
  {
    id: 'performance',
    label: '성과·안전',
    tabs: [
      { id: 'rankings', label: '성과 리포트' },
      { id: 'geo', label: 'AI 검색' },
      { id: 'audit', label: '블로그 진단' },
    ],
  },
  {
    id: 'clinicflix',
    label: '클리닉픽스',
    tabs: [
      { id: 'brandkit', label: '콘텐츠 설정' },
      { id: 'photos', label: '사진 보관함' },
      { id: 'conversions', label: '변환 내역' },
    ],
  },
];

/** 전체 서브탭 평탄화 목록 — 그룹 정의에서 유도(기존 MYPAGE_TABS 호환). */
export const MYPAGE_TABS: readonly MyPageTabDef[] = MYPAGE_GROUPS.flatMap(
  (group) => group.tabs,
);

const MYPAGE_TAB_IDS: readonly MyPageTabId[] = MYPAGE_TABS.map((t) => t.id);

/** tab id → group id 매핑 (그룹 정의에서 유도). */
const TAB_TO_GROUP: Readonly<Record<MyPageTabId, MyPageGroupId>> = MYPAGE_GROUPS.reduce(
  (acc, group) => ({
    ...acc,
    ...Object.fromEntries(group.tabs.map((tab) => [tab.id, group.id])),
  }),
  {} as Record<MyPageTabId, MyPageGroupId>,
);

/** `?tab=` 쿼리 값이 유효한 서브탭 id 인지 검사한다. */
export function isMyPageTabId(value: string | null): value is MyPageTabId {
  return value !== null && (MYPAGE_TAB_IDS as readonly string[]).includes(value);
}

/** 서브탭이 속한 그룹 id 를 반환한다. */
export function groupOfTab(tab: MyPageTabId): MyPageGroupId {
  return TAB_TO_GROUP[tab];
}

/** 그룹 진입 시 기본으로 열리는 첫 서브탭 id 를 반환한다. */
export function firstTabOfGroup(groupId: MyPageGroupId): MyPageTabId {
  const group = MYPAGE_GROUPS.find((g) => g.id === groupId);
  // MYPAGE_GROUPS 는 4개 그룹을 항상 포함하므로 도달 불가 — 타입 안전용 폴백.
  return group ? group.tabs[0].id : 'profile';
}

/**
 * `?tab=` 딥링크 파싱 — 유효한 탭이면 그대로(딥링크 우선), 없거나 잘못됐으면 'profile'.
 * 기존 단층 구조의 파싱 규칙과 동일해 모든 기존 딥링크가 그대로 동작한다.
 */
export function resolveMyPageTab(tabParam: string | null): MyPageTabId {
  return isMyPageTabId(tabParam) ? tabParam : 'profile';
}
