import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDue,
  pickNextPost,
  pickNextPosts,
  isValidCadence,
  maxPostsPerRun,
  CADENCE_MAX_POSTS_PER_RUN,
  remainingDailyQuota,
  needsDailyQuotaCheck,
  rotationOffset,
  kstDayIndex,
  kstDayStartIso,
} from '../auto-publish.ts';

const NOW = new Date('2026-07-12T02:00:00.000Z');

test('isDue: off 는 항상 false (opt-in — 켜지 않으면 발행 안 함)', () => {
  assert.equal(isDue('off', null, NOW), false);
  assert.equal(isDue('off', '2020-01-01T00:00:00.000Z', NOW), false);
});

test('isDue: lastRun 이 없으면(최초) due=true', () => {
  assert.equal(isDue('weekly', null, NOW), true);
  assert.equal(isDue('biweekly', undefined, NOW), true);
});

test('isDue: lastRun 파싱 불가면 due=true (graceful)', () => {
  assert.equal(isDue('weekly', 'not-a-date', NOW), true);
});

test('isDue weekly: 7일 경계', () => {
  const sixDays = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDays = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDays = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(isDue('weekly', sixDays, NOW), false);
  assert.equal(isDue('weekly', sevenDays, NOW), true); // 정확히 7일 경과 → 발행
  assert.equal(isDue('weekly', eightDays, NOW), true);
});

test('isDue biweekly: 14일 경계', () => {
  const thirteenDays = new Date(NOW.getTime() - 13 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDays = new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(isDue('biweekly', thirteenDays, NOW), false);
  assert.equal(isDue('biweekly', fourteenDays, NOW), true);
});

test('isValidCadence: 허용값만 통과', () => {
  assert.equal(isValidCadence('off'), true);
  assert.equal(isValidCadence('auto'), true);
  assert.equal(isValidCadence('weekly'), true);
  assert.equal(isValidCadence('biweekly'), true);
  assert.equal(isValidCadence('daily'), false);
  assert.equal(isValidCadence(''), false);
  assert.equal(isValidCadence(null), false);
  assert.equal(isValidCadence(undefined), false);
});

test('pickNextPost: 후보 0이면 null (대상 없음 — graceful)', () => {
  assert.equal(pickNextPost([]), null);
});

test('pickNextPost: 가장 오래된 생성순 1편 선택', () => {
  const picked = pickNextPost([
    { id: 'b', createdAt: '2026-07-05T00:00:00.000Z' },
    { id: 'a', createdAt: '2026-07-01T00:00:00.000Z' }, // 가장 오래됨
    { id: 'c', createdAt: '2026-07-10T00:00:00.000Z' },
  ]);
  assert.equal(picked?.id, 'a');
});

test('pickNextPost: created_at 동률이면 id 사전순 안정 선택', () => {
  const picked = pickNextPost([
    { id: 'z', createdAt: '2026-07-01T00:00:00.000Z' },
    { id: 'a', createdAt: '2026-07-01T00:00:00.000Z' },
  ]);
  assert.equal(picked?.id, 'a');
});

test('pickNextPost: created_at 파싱 불가 후보는 뒤로 밀려 유효 후보가 우선', () => {
  const picked = pickNextPost([
    { id: 'bad', createdAt: 'invalid' },
    { id: 'good', createdAt: '2026-07-03T00:00:00.000Z' },
  ]);
  assert.equal(picked?.id, 'good');
});

test('pickNextPost: 후보가 1편이면 그 글', () => {
  const picked = pickNextPost([{ id: 'only', createdAt: '2026-07-03T00:00:00.000Z' }]);
  assert.equal(picked?.id, 'only');
});

// ---------------------------------------------------------------------------
// 'auto' 주기 (검수 통과 시 바로 발행)
// ---------------------------------------------------------------------------

test("isDue auto: lastRun 과 무관하게 항상 true (대기 없음)", () => {
  assert.equal(isDue('auto', null, NOW), true);
  assert.equal(isDue('auto', NOW.toISOString(), NOW), true);
  const oneMinuteAgo = new Date(NOW.getTime() - 60_000).toISOString();
  assert.equal(isDue('auto', oneMinuteAgo, NOW), true);
});

test('maxPostsPerRun: off=0, auto=3(하루 최대 3편), weekly/biweekly=1(기존 동작 유지)', () => {
  assert.equal(maxPostsPerRun('off'), 0);
  assert.equal(maxPostsPerRun('auto'), 3);
  assert.equal(maxPostsPerRun('weekly'), 1);
  assert.equal(maxPostsPerRun('biweekly'), 1);
  assert.equal(CADENCE_MAX_POSTS_PER_RUN.auto, 3);
});

test('pickNextPosts: 오래된 순으로 limit 편까지 선택한다', () => {
  const picked = pickNextPosts(
    [
      { id: 'd', createdAt: '2026-07-10T00:00:00.000Z' },
      { id: 'a', createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 'c', createdAt: '2026-07-07T00:00:00.000Z' },
      { id: 'b', createdAt: '2026-07-03T00:00:00.000Z' },
    ],
    3,
  );
  assert.deepEqual(picked.map((p) => p.id), ['a', 'b', 'c']);
});

test('pickNextPosts: 후보가 limit 보다 적으면 있는 만큼만', () => {
  const picked = pickNextPosts([{ id: 'only', createdAt: '2026-07-03T00:00:00.000Z' }], 3);
  assert.deepEqual(picked.map((p) => p.id), ['only']);
});

test('pickNextPosts: limit 0 이하 · 후보 0 이면 빈 배열', () => {
  assert.deepEqual(pickNextPosts([], 3), []);
  assert.deepEqual(pickNextPosts([{ id: 'a', createdAt: '2026-07-01T00:00:00.000Z' }], 0), []);
  assert.deepEqual(pickNextPosts([{ id: 'a', createdAt: '2026-07-01T00:00:00.000Z' }], -1), []);
});

test('pickNextPosts: 입력 배열을 변형하지 않는다 (불변)', () => {
  const input = [
    { id: 'b', createdAt: '2026-07-05T00:00:00.000Z' },
    { id: 'a', createdAt: '2026-07-01T00:00:00.000Z' },
  ];
  const snapshot = JSON.stringify(input);
  pickNextPosts(input, 2);
  assert.equal(JSON.stringify(input), snapshot);
});

test('pickNextPosts: 동률·파싱불가 처리가 pickNextPost 와 동일하다', () => {
  const candidates = [
    { id: 'bad', createdAt: 'invalid' },
    { id: 'z', createdAt: '2026-07-01T00:00:00.000Z' },
    { id: 'a', createdAt: '2026-07-01T00:00:00.000Z' },
  ];
  assert.equal(pickNextPosts(candidates, 1)[0].id, pickNextPost(candidates)?.id);
  assert.deepEqual(pickNextPosts(candidates, 3).map((p) => p.id), ['a', 'z', 'bad']);
});

// ---------------------------------------------------------------------------
// [차단 2 회귀] 하루 상한이 cron 호출 횟수와 무관하게 강제된다
// ---------------------------------------------------------------------------

test('★ 같은 날 cron 이 두 번 돌아도 총 3편을 넘지 않는다', () => {
  const cadence = 'auto';
  // 1회차: 오늘 발행 0편 → 3편 몫
  const first = remainingDailyQuota(cadence, 0);
  assert.equal(first, 3);

  // 2회차(재시도/수동 재실행): DB 에 이미 3편 → 몫 0
  const second = remainingDailyQuota(cadence, first);
  assert.equal(second, 0, '두 번째 실행은 한 편도 발행하면 안 된다');

  // 3회차도 마찬가지
  assert.equal(remainingDailyQuota(cadence, first + second), 0);
});

test('★ 부분 발행 후 재실행하면 남은 몫만 발행한다', () => {
  assert.equal(remainingDailyQuota('auto', 1), 2);
  assert.equal(remainingDailyQuota('auto', 2), 1);
  assert.equal(remainingDailyQuota('auto', 3), 0);
  // 어떤 이유로든 상한을 넘겨 있어도 음수가 아니라 0
  assert.equal(remainingDailyQuota('auto', 9), 0);
});

test('remainingDailyQuota: weekly/biweekly 는 하루 1편, off 는 0편', () => {
  assert.equal(remainingDailyQuota('weekly', 0), 1);
  assert.equal(remainingDailyQuota('weekly', 1), 0);
  assert.equal(remainingDailyQuota('biweekly', 0), 1);
  assert.equal(remainingDailyQuota('off', 0), 0);
});

test('remainingDailyQuota: 잘못된 집계값(음수·NaN)은 0편으로 간주해 몫을 준다', () => {
  assert.equal(remainingDailyQuota('auto', -5), 3);
  assert.equal(remainingDailyQuota('auto', Number.NaN), 3);
});

test('kstDayStartIso: KST 자정 경계를 UTC 로 정확히 변환한다', () => {
  // 2026-07-26 00:30 KST = 2026-07-25 15:30 UTC → 경계는 2026-07-25T15:00:00Z
  assert.equal(kstDayStartIso(new Date('2026-07-25T15:30:00.000Z')), '2026-07-25T15:00:00.000Z');
  // 같은 KST 하루 안(2026-07-26 23:00 KST = 14:00 UTC)이면 경계가 같다
  assert.equal(kstDayStartIso(new Date('2026-07-26T14:00:00.000Z')), '2026-07-25T15:00:00.000Z');
  // KST 자정 직전(2026-07-25 23:59 KST = 14:59 UTC)은 전날 경계
  assert.equal(kstDayStartIso(new Date('2026-07-25T14:59:00.000Z')), '2026-07-24T15:00:00.000Z');
});

test('kstDayIndex: KST 자정마다 1 씩 증가한다', () => {
  const a = kstDayIndex(new Date('2026-07-25T14:59:59.000Z')); // KST 7/25 23:59
  const b = kstDayIndex(new Date('2026-07-25T15:00:00.000Z')); // KST 7/26 00:00
  assert.equal(b - a, 1);
});

// ---------------------------------------------------------------------------
// [차단 3 회귀] 201번째 병원도 언젠가 반드시 처리된다
// ---------------------------------------------------------------------------

test('★ 201번째 병원도 회전 순회로 결국 처리된다 (영구 기아 없음)', () => {
  const total = 250;
  const windowSize = 200;
  // 250명 → 창 2개(0~199, 200~249). 이틀이면 전원 커버.
  const covered = new Set<number>();
  for (let day = 0; day < 2; day++) {
    const offset = rotationOffset(total, windowSize, day);
    for (let i = offset; i < Math.min(offset + windowSize, total); i++) covered.add(i);
  }
  assert.equal(covered.size, total, '2일 안에 250명 전원이 창에 들어와야 한다');
  assert.ok(covered.has(200), '201번째(0-based 200) 병원이 반드시 포함돼야 한다');
});

test('★ 대규모(2,000곳)에서도 ceil(total/window)일 안에 전원 커버된다', () => {
  const total = 2000;
  const windowSize = 200;
  const days = Math.ceil(total / windowSize); // 10일
  const covered = new Set<number>();
  for (let day = 0; day < days; day++) {
    const offset = rotationOffset(total, windowSize, day);
    for (let i = offset; i < Math.min(offset + windowSize, total); i++) covered.add(i);
  }
  assert.equal(covered.size, total);
});

test('rotationOffset: 전원이 한 창에 들어오면 회전하지 않는다 (기존 동작 유지)', () => {
  assert.equal(rotationOffset(50, 200, 0), 0);
  assert.equal(rotationOffset(50, 200, 12345), 0);
  assert.equal(rotationOffset(200, 200, 7), 0);
});

test('rotationOffset: 같은 날은 같은 창 (재시도가 순회를 건너뛰지 않는다)', () => {
  assert.equal(rotationOffset(1000, 200, 42), rotationOffset(1000, 200, 42));
  // 다음 날은 다음 창
  assert.notEqual(rotationOffset(1000, 200, 42), rotationOffset(1000, 200, 43));
});

test('rotationOffset: 음수 dayIndex·0 이하 입력도 안전하다', () => {
  assert.equal(rotationOffset(1000, 200, -1), 800);
  assert.equal(rotationOffset(0, 200, 5), 0);
  assert.equal(rotationOffset(1000, 0, 5), 0);
  assert.ok(rotationOffset(1000, 200, -12345) >= 0);
});

test('★ 일일 DB 집계 강제는 auto 에만 적용된다 (weekly/biweekly 동작 불변)', () => {
  assert.equal(needsDailyQuotaCheck('auto'), true);
  // weekly/biweekly 는 isDue(last_run 간격)가 이미 재발행을 막는다.
  // 여기에 일일 집계를 걸면 "그날 수동 발행한 회원"의 cron 이 밀려 동작이 바뀐다.
  assert.equal(needsDailyQuotaCheck('weekly'), false);
  assert.equal(needsDailyQuotaCheck('biweekly'), false);
  assert.equal(needsDailyQuotaCheck('off'), false);
});
