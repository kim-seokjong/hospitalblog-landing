import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MYPAGE_GROUPS,
  MYPAGE_TABS,
  firstTabOfGroup,
  groupOfTab,
  isMyPageTabId,
  resolveMyPageTab,
  type MyPageGroupId,
  type MyPageTabId,
} from '../mypage-tab-groups.ts';

// ---------------------------------------------------------------------------
// 구조 정합성 — 그룹 4개, 서브탭 11종, 중복/누락 없음
// ---------------------------------------------------------------------------

const ALL_TAB_IDS: MyPageTabId[] = [
  'profile',
  'subscription',
  'usage',
  'posts',
  'rankings',
  'geo',
  'audit',
  'conversions',
  'brandkit',
  'voice',
  'photos',
];

test('그룹은 정확히 4개이고 순서는 계정→콘텐츠→성과·안전→클리닉픽스', () => {
  assert.deepEqual(
    MYPAGE_GROUPS.map((g) => g.id),
    ['account', 'content', 'performance', 'clinicflix'],
  );
});

test('서브탭 11종이 그룹에 정확히 1번씩 배정된다 (중복/누락 없음)', () => {
  const flattened = MYPAGE_GROUPS.flatMap((g) => g.tabs.map((t) => t.id));
  assert.equal(flattened.length, 11);
  assert.equal(new Set(flattened).size, 11);
  assert.deepEqual([...flattened].sort(), [...ALL_TAB_IDS].sort());
});

test('MYPAGE_TABS 는 그룹 정의에서 유도된 11개 탭이다', () => {
  assert.equal(MYPAGE_TABS.length, 11);
  assert.deepEqual(
    [...MYPAGE_TABS.map((t) => t.id)].sort(),
    [...ALL_TAB_IDS].sort(),
  );
});

test('모든 그룹은 서브탭이 최소 2개다', () => {
  for (const group of MYPAGE_GROUPS) {
    assert.ok(group.tabs.length >= 2, `${group.id} 그룹 서브탭 ${group.tabs.length}개`);
  }
});

// ---------------------------------------------------------------------------
// tab → group 매핑
// ---------------------------------------------------------------------------

test('tab → group 매핑이 명세와 일치한다', () => {
  const expected: Record<MyPageTabId, MyPageGroupId> = {
    profile: 'account',
    subscription: 'account',
    usage: 'account',
    posts: 'content',
    voice: 'content',
    rankings: 'performance',
    geo: 'performance',
    audit: 'performance',
    brandkit: 'clinicflix',
    photos: 'clinicflix',
    conversions: 'clinicflix',
  };
  for (const tab of ALL_TAB_IDS) {
    assert.equal(groupOfTab(tab), expected[tab], `groupOfTab(${tab})`);
  }
});

test('그룹 진입 시 첫 서브탭 — account=profile, content=posts, performance=rankings, clinicflix=brandkit', () => {
  assert.equal(firstTabOfGroup('account'), 'profile');
  assert.equal(firstTabOfGroup('content'), 'posts');
  assert.equal(firstTabOfGroup('performance'), 'rankings');
  assert.equal(firstTabOfGroup('clinicflix'), 'brandkit');
});

// ---------------------------------------------------------------------------
// isMyPageTabId — 기존 시그니처 유지
// ---------------------------------------------------------------------------

test('isMyPageTabId: 11종 전부 true', () => {
  for (const tab of ALL_TAB_IDS) {
    assert.equal(isMyPageTabId(tab), true, tab);
  }
});

test('isMyPageTabId: null·빈 문자열·미지 값은 false', () => {
  assert.equal(isMyPageTabId(null), false);
  assert.equal(isMyPageTabId(''), false);
  assert.equal(isMyPageTabId('settings'), false);
  assert.equal(isMyPageTabId('performance'), false); // 그룹 id 는 탭 id 가 아니다
});

// ---------------------------------------------------------------------------
// 딥링크 파싱 — 기존 `?tab=` 하위 호환
// ---------------------------------------------------------------------------

test('resolveMyPageTab: 유효한 딥링크는 지정 탭 그대로 (그룹 기본 탭보다 우선)', () => {
  for (const tab of ALL_TAB_IDS) {
    assert.equal(resolveMyPageTab(tab), tab);
  }
});

test('resolveMyPageTab: 파라미터 없음/잘못된 값은 profile 폴백 (기존 규칙 동일)', () => {
  assert.equal(resolveMyPageTab(null), 'profile');
  assert.equal(resolveMyPageTab(''), 'profile');
  assert.equal(resolveMyPageTab('unknown-tab'), 'profile');
});

test('기존 딥링크 사용처 시나리오 — 탭과 그룹이 함께 올바르게 열린다', () => {
  // NotificationBell, monthly-report → ?tab=rankings
  assert.equal(resolveMyPageTab('rankings'), 'rankings');
  assert.equal(groupOfTab(resolveMyPageTab('rankings')), 'performance');
  // /app/report/[postId], /history 리다이렉트 → ?tab=posts
  assert.equal(groupOfTab(resolveMyPageTab('posts')), 'content');
  // /app/multichannel → ?tab=brandkit
  assert.equal(groupOfTab(resolveMyPageTab('brandkit')), 'clinicflix');
  // /settings/profile 리다이렉트, RankingsTab 내부 링크 → ?tab=profile
  assert.equal(groupOfTab(resolveMyPageTab('profile')), 'account');
});
