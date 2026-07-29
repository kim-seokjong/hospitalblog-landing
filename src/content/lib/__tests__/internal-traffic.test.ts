import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInternalUserIds,
  readInternalUserIds,
  isInternalUserId,
  hasInternalCookie,
  resolveInternalOptAction,
  INTERNAL_COOKIE,
  INTERNAL_COOKIE_VALUE,
  INTERNAL_COOKIE_MAX_AGE_SEC,
  INTERNAL_OPT_PARAM,
  INTERNAL_USER_IDS_ENV,
} from '../internal-traffic.ts';

// 테스트용 더미 UUID (실계정 아님 — 코드·테스트 어디에도 실제 user_id 를 박지 않는다).
const INTERNAL_A = '11111111-2222-4333-8444-555555555555';
const INTERNAL_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
/** 실제 고객 계정 자리 — 이 값이 제외되면 매출로 이어질 활동을 지워버리는 것이다. */
const CUSTOMER = '99999999-8888-4777-8666-555544443333';

// ── ★ 최우선: 실제 고객은 절대 제외되지 않는다 ──
test('isInternalUserId: 목록에 없는 고객 계정은 반드시 기록된다', () => {
  const internal = parseInternalUserIds(`${INTERNAL_A},${INTERNAL_B}`);
  assert.equal(isInternalUserId(CUSTOMER, internal), false);
  assert.equal(isInternalUserId(INTERNAL_A, internal), true);
  assert.equal(isInternalUserId(INTERNAL_B, internal), true);
});

test('isInternalUserId: 부분·접두어 일치로 고객이 휩쓸리지 않는다', () => {
  const internal = parseInternalUserIds(INTERNAL_A);
  // 앞부분만 같은 다른 UUID
  assert.equal(isInternalUserId('11111111-2222-4333-8444-555555555556', internal), false);
  // 내부 id 를 접두어로 갖는 문자열
  assert.equal(isInternalUserId(`${INTERNAL_A}0`, internal), false);
  assert.equal(isInternalUserId('1111', internal), false);
});

test('isInternalUserId: 목록이 비면 아무도 제외되지 않는다 (안전한 기본값)', () => {
  assert.equal(isInternalUserId(INTERNAL_A, []), false);
  assert.equal(isInternalUserId(CUSTOMER, []), false);
});

test('isInternalUserId: 비로그인(null/빈 문자열)은 계정 기준으로 제외하지 않는다', () => {
  const internal = parseInternalUserIds(INTERNAL_A);
  assert.equal(isInternalUserId(null, internal), false);
  assert.equal(isInternalUserId(undefined, internal), false);
  assert.equal(isInternalUserId('', internal), false);
});

test('isInternalUserId: user_id 대소문자 차이는 같은 계정으로 본다', () => {
  const internal = parseInternalUserIds(INTERNAL_A.toUpperCase());
  assert.equal(isInternalUserId(INTERNAL_A, internal), true);
  assert.equal(isInternalUserId(INTERNAL_A.toUpperCase(), internal), true);
});

// ── env 파싱 — 실패는 전부 "아무도 제외 안 함" 쪽으로 기운다 ──
test('parseInternalUserIds: 공백·빈 항목·중복을 정리한다', () => {
  assert.deepEqual(
    [...parseInternalUserIds(`  ${INTERNAL_A} , ${INTERNAL_B} , ${INTERNAL_A} , `)],
    [INTERNAL_A, INTERNAL_B],
  );
});

test('parseInternalUserIds: 비었거나 잘못된 형식이면 아무도 제외되지 않는다', () => {
  for (const raw of [undefined, null, '', '   ', ',,,', 'not-a-uuid', 'terro6936@naver.com', '*', 'all']) {
    assert.deepEqual([...parseInternalUserIds(raw)], [], `제외 목록이 비어야 한다: ${String(raw)}`);
  }
});

test('parseInternalUserIds: 유효한 값만 남기고 잘못된 항목은 버린다', () => {
  assert.deepEqual([...parseInternalUserIds(`bogus,${INTERNAL_A},,123`)], [INTERNAL_A]);
});

test('parseInternalUserIds: 반환 목록은 동결돼 있다 (호출부가 오염시킬 수 없음)', () => {
  const ids = parseInternalUserIds(INTERNAL_A);
  assert.equal(Object.isFrozen(ids), true);
});

test('readInternalUserIds: env 키 미설정이면 빈 목록', () => {
  assert.deepEqual([...readInternalUserIds({} as NodeJS.ProcessEnv)], []);
  assert.deepEqual(
    [...readInternalUserIds({ [INTERNAL_USER_IDS_ENV]: `${INTERNAL_A}` } as NodeJS.ProcessEnv)],
    [INTERNAL_A],
  );
  // 실제 고객이 env 에 없으면 당연히 기록된다.
  const ids = readInternalUserIds({ [INTERNAL_USER_IDS_ENV]: INTERNAL_A } as NodeJS.ProcessEnv);
  assert.equal(isInternalUserId(CUSTOMER, ids), false);
});

// ── 쿠키 기반 옵트아웃 ──
test('hasInternalCookie: 정확히 "1" 일 때만 내부 트래픽', () => {
  assert.equal(hasInternalCookie(INTERNAL_COOKIE_VALUE), true);
  assert.equal(hasInternalCookie('1'), true);
  assert.equal(hasInternalCookie('0'), false);
  assert.equal(hasInternalCookie(''), false);
  assert.equal(hasInternalCookie('true'), false);
  assert.equal(hasInternalCookie(undefined), false);
  assert.equal(hasInternalCookie(null), false);
});

test('resolveInternalOptAction: 켜기', () => {
  for (const raw of ['1', 'true', 'on', ' TRUE ', 'On']) {
    assert.equal(resolveInternalOptAction(raw), 'enable', `enable 이어야 한다: ${raw}`);
  }
});

test('resolveInternalOptAction: 끄기 — 되돌릴 수단이 반드시 있어야 한다', () => {
  for (const raw of ['0', 'false', 'off', ' OFF ']) {
    assert.equal(resolveInternalOptAction(raw), 'disable', `disable 이어야 한다: ${raw}`);
  }
});

test('resolveInternalOptAction: 없거나 모르는 값이면 관여하지 않는다', () => {
  for (const raw of [null, undefined, '', '  ', '2', 'yes', 'no', 'internal']) {
    assert.equal(resolveInternalOptAction(raw), 'none', `none 이어야 한다: ${String(raw)}`);
  }
});

// ── 상수 계약 (라우트·미들웨어가 이 이름에 의존한다) ──
test('내부 트래픽 상수 계약', () => {
  assert.equal(INTERNAL_COOKIE, 'dp_internal');
  assert.equal(INTERNAL_OPT_PARAM, 'dp_internal');
  assert.equal(INTERNAL_COOKIE_VALUE, '1');
  // 1년 — 기기·브라우저마다 한 번만 켜면 되도록.
  assert.equal(INTERNAL_COOKIE_MAX_AGE_SEC, 60 * 60 * 24 * 365);
});
