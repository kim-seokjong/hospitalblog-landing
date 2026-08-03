/**
 * 케어 위임 자격 판정 — **순수 규칙만** (부작용·DB 접근 없음).
 *
 * 파기·열람 로직(care-retention.ts)에서 규칙만 떼어냈다. "무엇이 유효한 위임인가" 는
 * 규칙이고 "지우는 일" 은 부작용이다. 규칙을 부작용과 같은 파일에 두면 회귀 테스트를
 * 쓸 수 없다 — 이 판정이 틀리면 병원 계정 비밀번호가 잘못 열리거나 잘못 지워진다.
 *
 * ⚠️ 외부 의존을 늘리지 말 것 (`@/` alias 금지, `.ts` 확장자 명시) —
 *    node:test 러너로 직접 돌려야 한다.
 */

import { isCarePlanId, PLANS } from './plans.ts';
import type { PlanId } from './plans.ts';

/**
 * 활성 케어 구독인가.
 *
 * 만료일이 비어 있으면 **유효로 보지 않는다** — 케어 플랜은 결제 기반이라 만료일이
 * 반드시 있고, 없다는 것은 상태가 깨졌다는 뜻이다. 자격증명 열람은 애매하면 막는 쪽이다.
 */
export function isActiveCareSubscription(
  plan: string | null | undefined,
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!plan) return false;
  const id = plan as PlanId;
  if (!PLANS[id] || !isCarePlanId(id)) return false;
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t > now;
}

/**
 * 이 위임이 **지금 계약의 위임인가** (`care_onboarding.billing_key_id`, 마이그 060).
 *
 * 갱신은 같은 빌링키 행을 계속 쓰고, 해지 후 재구독은 새 행을 만든다. 그래서 제출
 * 당시의 빌링키 id 와 현재 활성 빌링키 id 가 다르면 **지난 계약의 위임**이다.
 * 지난 계약의 동의로 새 계약의 계정을 열 수는 없다.
 *
 * ⚠️ 값이 비어 있으면 **열지 않는다**(fail-closed, 2026-08-03 지적으로 뒤집음).
 *    처음엔 "구버전 행을 잠그면 서비스가 멈춘다" 며 통과시켰는데, 그러면 기존 행은
 *    마이그레이션 후에도 **계약 방어가 영구히 꺼진 채** 남는다. 민감 자격증명에서
 *    기한 없는 fail-open 은 답이 아니다.
 *    기존 행은 마이그 060 이 현재 활성 빌링키로 **백필**하므로 잠기지 않는다.
 *    백필도 못 한 행(활성 결제수단이 없는 회원)은 실제로 계약이 불분명한 행이고,
 *    그런 행은 열지 않는 것이 맞다 — 고객에게 다시 받으면 된다.
 *
 * ⚠️ 마이그 060 자체가 미적용인 환경(컬럼 부재)은 여기까지 오지 않는다 —
 *    호출부가 그 경우를 구분해 이 검사를 통째로 건너뛴다.
 */
export function isSameContract(
  submittedBillingKeyId: string | null | undefined,
  activeBillingKeyId: string | null | undefined,
): boolean {
  if (!submittedBillingKeyId) return false;
  if (!activeBillingKeyId) return false;
  return submittedBillingKeyId === activeBillingKeyId;
}
