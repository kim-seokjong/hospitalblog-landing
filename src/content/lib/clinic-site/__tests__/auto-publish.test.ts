import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDue,
  pickNextPost,
  pickNextPosts,
  isValidCadence,
  maxPostsPerRun,
  CADENCE_MAX_POSTS_PER_RUN,
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
