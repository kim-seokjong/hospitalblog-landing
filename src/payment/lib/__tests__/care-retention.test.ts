import test from 'node:test';
import assert from 'node:assert/strict';
import { isActiveCareSubscription, isSameContract } from '../care-entitlement-rules.ts';

/**
 * 회귀 고정 — 2026-08-03 주간점검 교차검증.
 *
 * 케어 위임 자격증명은 병원 네이버 계정 비밀번호다. 여기서 지키는 것:
 *   · 구독 근거가 없으면 활성으로 보지 않는다 (애매하면 막는 쪽)
 *   · **지난 계약의 위임으로 새 계약의 계정을 열 수 없다**
 *   · 단, 판별 근거가 아예 없으면(마이그 미적용) 기존 고객을 잠그지 않는다
 */

const NOW = Date.parse('2026-08-03T00:00:00Z');
const FUTURE = '2026-09-01T00:00:00Z';
const PAST = '2026-07-01T00:00:00Z';

test('활성 케어 구독만 유효하다', () => {
  assert.equal(isActiveCareSubscription('standard_care', FUTURE, NOW), true);
  assert.equal(isActiveCareSubscription('growth_care', FUTURE, NOW), true);
});

test('케어가 아닌 플랜은 위임 근거가 아니다', () => {
  assert.equal(isActiveCareSubscription('standard', FUTURE, NOW), false);
  assert.equal(isActiveCareSubscription('growth8_standard', FUTURE, NOW), false);
  assert.equal(isActiveCareSubscription('free', FUTURE, NOW), false);
});

test('만료된 케어 구독은 근거가 아니다', () => {
  assert.equal(isActiveCareSubscription('standard_care', PAST, NOW), false);
});

/**
 * 케어 플랜은 결제 기반이라 만료일이 반드시 있다. 없다는 것은 상태가 깨졌다는
 * 뜻이므로 **유효로 보지 않는다** — 자격증명 열람은 애매할 때 막는 쪽이다.
 */
test('만료일이 없거나 깨진 값은 유효로 보지 않는다', () => {
  assert.equal(isActiveCareSubscription('standard_care', null, NOW), false);
  assert.equal(isActiveCareSubscription('standard_care', undefined, NOW), false);
  assert.equal(isActiveCareSubscription('standard_care', '깨진값', NOW), false);
  assert.equal(isActiveCareSubscription(null, FUTURE, NOW), false);
});

/**
 * 계약 인스턴스 = 제출 당시의 활성 빌링키 id.
 * 갱신은 같은 빌링키 행을 쓰고, 해지 후 재구독은 새 행을 만든다.
 */
test('같은 빌링키 = 같은 계약 (갱신은 통과)', () => {
  assert.equal(isSameContract('key-1', 'key-1'), true);
});

test('빌링키가 다르면 지난 계약의 위임이다 — 재구독해도 못 연다', () => {
  assert.equal(isSameContract('key-1', 'key-2'), false);
});

test('활성 빌링키가 없으면 지금 계약이 성립하지 않는다', () => {
  assert.equal(isSameContract('key-1', null), false);
});

/**
 * ⚠️ 계약 정보가 비어 있으면 **열지 않는다**(fail-closed).
 *
 *    처음엔 "구버전 행을 잠그면 서비스가 멈춘다" 며 통과시켰다가 뒤집었다 —
 *    그러면 기존 행은 마이그레이션 후에도 계약 방어가 영구히 꺼진 채 남는다.
 *    기존 행은 마이그 060 이 백필하므로 잠기지 않고, 백필도 안 되는 행은
 *    실제로 계약이 불분명한 행이다.
 *    (마이그 미적용 환경은 호출부가 이 검사를 통째로 건너뛴다.)
 */
test('계약 정보가 비어 있으면 열지 않는다', () => {
  assert.equal(isSameContract(null, 'key-1'), false);
  assert.equal(isSameContract(undefined, 'key-1'), false);
  assert.equal(isSameContract(null, null), false);
});
