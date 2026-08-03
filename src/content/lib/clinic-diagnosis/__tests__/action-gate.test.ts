import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lockedActionCount,
  lockedActions,
  MAX_LEAD_ACTIONS,
  unlockedActionIds,
} from '../findings.ts';
import type { Finding } from '../types.ts';

/**
 * 회귀 고정 — 2026-08-04.
 *
 * 이메일 전 화면에서 해결방법을 가리는 규칙. 여기서 지키는 것은 전환율이 아니라
 * **가려서는 안 되는 것을 가리지 않기**다.
 */

const f = (over: Partial<Finding> & Pick<Finding, 'id' | 'axis'>): Finding => ({
  label: '항목',
  tone: 'warn',
  state: '상태',
  why: '이유',
  action: '해결방법',
  ourScope: true,
  ...over,
});

/**
 * ⚠️ 의료광고법은 **법 위반 소지**다. 알려주면서 고치는 법만 숨기면 "겁주고 돈 받는"
 *    모양이 되고, 원장이 위반 상태로 방치되면 실제 피해가 난다.
 */
test('의료광고법 항목의 해결방법은 절대 가리지 않는다', () => {
  const findings = [
    f({ id: 'compliance.a', axis: 'compliance' }),
    f({ id: 'compliance.b', axis: 'compliance' }),
    f({ id: 'blog.a', axis: 'blog' }),
    f({ id: 'blog.b', axis: 'blog' }),
  ];
  const unlocked = unlockedActionIds(findings);
  assert.ok(unlocked.has('compliance.a'));
  assert.ok(unlocked.has('compliance.b'));
});

/** 아무것도 안 주면 낚시로 읽힌다 — 하나는 끝까지 보여준다. */
test('의료광고법이 없어도 최소 한 개는 공개한다', () => {
  const findings = [
    f({ id: 'blog.a', axis: 'blog' }),
    f({ id: 'site.a', axis: 'site' }),
    f({ id: 'place.a', axis: 'place' }),
  ];
  const unlocked = unlockedActionIds(findings);
  const openCount = findings.filter((x) => unlocked.has(x.id)).length;
  assert.equal(openCount, 1);
});

/**
 * ⚠️ "잘하고 있는 것" 의 조언까지 세어 "해결 방법 N개" 라고 하면 숫자 부풀리기다.
 *    잠그는 것은 손대야 할 것뿐이고, 그 숫자가 곧 원장이 받게 될 것이다.
 */
test('잘하고 있는 것·확인 못 한 것은 잠그지 않는다', () => {
  const findings = [
    f({ id: 'blog.good', axis: 'blog', tone: 'good', why: null }),
    f({ id: 'ai.unknown', axis: 'ai', tone: 'unknown' }),
    f({ id: 'blog.warn1', axis: 'blog' }),
    f({ id: 'blog.warn2', axis: 'blog' }),
  ];
  const unlocked = unlockedActionIds(findings);
  assert.ok(unlocked.has('blog.good'));
  assert.ok(unlocked.has('ai.unknown'));
  assert.equal(lockedActionCount(findings), 1, '경고 2개 중 1개만 잠긴다');
});

test('잠긴 개수는 실제로 가려진 항목 수와 같다', () => {
  const findings = [
    f({ id: 'compliance.a', axis: 'compliance' }),
    f({ id: 'blog.a', axis: 'blog' }),
    f({ id: 'blog.b', axis: 'blog' }),
    f({ id: 'site.a', axis: 'site' }),
  ];
  const unlocked = unlockedActionIds(findings);
  const locked = findings.filter((x) => !unlocked.has(x.id));
  assert.equal(lockedActionCount(findings), locked.length);
  assert.equal(locked.length, 2, '컴플라이언스 1 + 최악 1 공개 → 2개 잠금');
});

/** 경고가 하나뿐이면 그게 공개되고 잠글 것이 없다 — 0개를 "N개 있다"고 말하면 안 된다. */
test('경고가 하나뿐이면 잠기는 것이 없다', () => {
  const findings = [f({ id: 'blog.only', axis: 'blog' })];
  assert.equal(lockedActionCount(findings), 0);
});

/**
 * ⚠️ 화면이 "N개 보내드립니다" 라고 한 그 N 과 **메일에 실리는 목록이 같아야 한다**.
 *    예전엔 화면은 잠긴 것만 세고 메일은 전부 실어서 숫자가 어긋났다(2026-08-04).
 */
test('화면 개수와 메일 목록이 같은 함수에서 나온다', () => {
  const findings = [
    f({ id: 'compliance.a', axis: 'compliance' }),
    f({ id: 'blog.a', axis: 'blog' }),
    f({ id: 'blog.b', axis: 'blog' }),
    f({ id: 'site.a', axis: 'site' }),
    f({ id: 'blog.good', axis: 'blog', tone: 'good', why: null }),
  ];
  const list = lockedActions(findings);
  assert.equal(list.length, lockedActionCount(findings));
  // 공개된 항목은 메일 목록에 들어가지 않는다 — 이미 화면에서 봤다.
  const unlocked = unlockedActionIds(findings);
  assert.ok(list.every((x) => !unlocked.has(x.id)));
  assert.ok(!list.some((x) => x.axis === 'compliance'));
});

/**
 * ⚠️ **가린 것과 보낼 것이 정확히 같아야 한다** (2026-08-04 교차검증).
 *    상한을 넘겨 가려 놓고 안 보내면 "가려 둔 것을 보내드립니다" 가 거짓이 된다.
 *    상한을 넘는 항목은 잠그지 않고 그대로 보여준다.
 */
test('상한을 넘는 항목은 가리지 않는다 — 가린 것 = 보낼 것', () => {
  const many = Array.from({ length: 20 }, (_, i) => f({ id: `blog.${i}`, axis: 'blog' }));
  const locked = lockedActions(many);
  const unlocked = unlockedActionIds(many);

  assert.equal(locked.length, MAX_LEAD_ACTIONS);
  assert.equal(lockedActionCount(many), MAX_LEAD_ACTIONS);

  // 화면에서 실제로 가려지는 항목 수 == 메일에 실리는 수
  const hiddenOnScreen = many.filter((x) => !unlocked.has(x.id));
  assert.equal(hiddenOnScreen.length, locked.length);
  assert.deepEqual(
    hiddenOnScreen.map((x) => x.id),
    locked.map((x) => x.id),
  );
});

test('빈 목록·잘못된 입력에도 깨지지 않는다', () => {
  assert.equal(lockedActionCount([]), 0);
  assert.equal(unlockedActionIds([]).size, 0);
  assert.equal(lockedActionCount(null as never), 0);
});
