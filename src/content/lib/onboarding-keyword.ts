/**
 * 온보딩 첫 글 — 진료과 기반 시작 키워드 추천 (순수 로직).
 *
 * 가입 직후 "빈 화면" 대신 "원클릭으로 첫 글 시작"을 주기 위해, 진료과
 * (profiles.hospital_type)만으로 안전한 정보성 시작 키워드를 제안한다.
 * 기존 자산(serp-warm-seeds 의 진료과별 시드)을 재사용한다 — 별도 사전을
 * 새로 만들지 않는다(의료광고법 안전 원칙이 이미 검증된 목록).
 *
 * 외부 의존 없는 순수 모듈 — node:test 로 직접 검증 가능.
 */

import { SEED_KEYWORDS_BY_SPECIALTY } from './serp-warm-seeds.ts';

/** 온보딩 카드에 노출할 시작 키워드 최대 개수 (칩). */
export const ONBOARDING_KEYWORD_LIMIT = 3;

/**
 * 진료과의 시작 키워드 후보 목록 (최대 3개). 미지원/미상 진료과는 빈 배열.
 * 시드는 이미 "증상/원인/관리/예방" 정보 탐색형만 담고 있어 그대로 안전하다.
 */
export function getOnboardingKeywords(hospitalType: string | null | undefined): string[] {
  const key = (hospitalType ?? '').trim();
  if (!key) return [];
  const seeds = SEED_KEYWORDS_BY_SPECIALTY[key];
  if (!seeds || seeds.length === 0) return [];
  return seeds.slice(0, ONBOARDING_KEYWORD_LIMIT);
}

/**
 * 진료과의 대표 시작 키워드 1개. 없으면 null.
 * 목록의 첫 항목 = 가장 흔하고 무난한 주제(결정적 — 테스트 가능).
 */
export function suggestOnboardingKeyword(hospitalType: string | null | undefined): string | null {
  const list = getOnboardingKeywords(hospitalType);
  return list.length > 0 ? list[0] : null;
}

/** 온보딩 첫 글 카드를 띄울지 판정 — 순수 조건 함수(호출부에서 상태 전달). */
export interface OnboardingEligibility {
  /** 로그인 상태인가 */
  isLoggedIn: boolean;
  /** 관리자(무제한)인가 — 관리자는 온보딩 대상 아님 */
  isAdmin: boolean;
  /** 남은 무료 크레딧 (null = 미조회, 유료 회원 등) */
  freeCredits: number | null;
  /** 이미 생성/작성 흐름에 진입했는가(제목·본문 존재) */
  hasStartedFlow: boolean;
  /** 추천 가능한 시작 키워드가 있는가 */
  hasSuggestion: boolean;
}

/**
 * 온보딩 첫 글 카드 노출 조건:
 *  - 로그인 && 비관리자
 *  - 남은 무료 크레딧 > 0 (아직 첫 글을 안 만든 신규 무료 회원)
 *  - 아직 생성 흐름에 진입 안 함(제목/본문 없음)
 *  - 진료과 기반 추천 키워드가 존재
 */
export function shouldShowOnboarding(e: OnboardingEligibility): boolean {
  if (!e.isLoggedIn || e.isAdmin) return false;
  if (e.freeCredits === null || e.freeCredits <= 0) return false;
  if (e.hasStartedFlow) return false;
  return e.hasSuggestion;
}
