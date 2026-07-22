import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getOnboardingKeywords,
  suggestOnboardingKeyword,
  shouldShowOnboarding,
  ONBOARDING_KEYWORD_LIMIT,
  type OnboardingEligibility,
} from '../onboarding-keyword.ts';
import { SEED_KEYWORDS_BY_SPECIALTY } from '../serp-warm-seeds.ts';

// ── getOnboardingKeywords ──
test('getOnboardingKeywords: 진료과 시드를 최대 3개 반환', () => {
  const list = getOnboardingKeywords('피부과');
  assert.deepEqual(list, ['여드름 원인', '기미 관리', '아토피 피부 관리']);
  assert.ok(list.length <= ONBOARDING_KEYWORD_LIMIT);
});

test('getOnboardingKeywords: 지원 15개 진료과 전부 후보를 가진다', () => {
  for (const specialty of Object.keys(SEED_KEYWORDS_BY_SPECIALTY)) {
    const list = getOnboardingKeywords(specialty);
    assert.ok(list.length >= 1, `${specialty} 후보 없음`);
  }
});

test('getOnboardingKeywords: 미상/빈 진료과는 빈 배열', () => {
  assert.deepEqual(getOnboardingKeywords(''), []);
  assert.deepEqual(getOnboardingKeywords(null), []);
  assert.deepEqual(getOnboardingKeywords(undefined), []);
  assert.deepEqual(getOnboardingKeywords('존재하지않는과'), []);
});

test('getOnboardingKeywords: 공백 트리밍', () => {
  assert.deepEqual(getOnboardingKeywords('  안과  '), ['라식 라섹 차이', '백내장 증상', '눈 건조증 관리']);
});

// ── suggestOnboardingKeyword ──
test('suggestOnboardingKeyword: 첫 항목(대표)을 반환', () => {
  assert.equal(suggestOnboardingKeyword('치과'), '임플란트 과정');
  assert.equal(suggestOnboardingKeyword('내과'), '고혈압 관리');
});

test('suggestOnboardingKeyword: 미상 진료과는 null', () => {
  assert.equal(suggestOnboardingKeyword(''), null);
  assert.equal(suggestOnboardingKeyword('없는과'), null);
});

// ── shouldShowOnboarding ──
function baseEligibility(): OnboardingEligibility {
  return {
    isLoggedIn: true,
    isAdmin: false,
    freeCredits: 2,
    hasStartedFlow: false,
    hasSuggestion: true,
  };
}

test('shouldShowOnboarding: 신규 무료 회원 + 추천 있음 → true', () => {
  assert.equal(shouldShowOnboarding(baseEligibility()), true);
});

test('shouldShowOnboarding: 비로그인/관리자 → false', () => {
  assert.equal(shouldShowOnboarding({ ...baseEligibility(), isLoggedIn: false }), false);
  assert.equal(shouldShowOnboarding({ ...baseEligibility(), isAdmin: true }), false);
});

test('shouldShowOnboarding: 무료 크레딧 소진/미조회 → false', () => {
  assert.equal(shouldShowOnboarding({ ...baseEligibility(), freeCredits: 0 }), false);
  assert.equal(shouldShowOnboarding({ ...baseEligibility(), freeCredits: null }), false);
});

test('shouldShowOnboarding: 이미 흐름 진입 → false', () => {
  assert.equal(shouldShowOnboarding({ ...baseEligibility(), hasStartedFlow: true }), false);
});

test('shouldShowOnboarding: 추천 키워드 없음 → false', () => {
  assert.equal(shouldShowOnboarding({ ...baseEligibility(), hasSuggestion: false }), false);
});
