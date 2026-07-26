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
  orderByCursor,
  mergeCursorWindow,
  dueThresholdIso,
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

// ---------------------------------------------------------------------------
// [차단 1 회귀] 앞쪽 회원이 발행 상한을 독식해도 뒤쪽이 결국 처리된다
// ---------------------------------------------------------------------------

const profileList = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${String(i).padStart(4, '0')}` }));

test('★ 앞쪽 회원이 상한을 다 먹어도 뒤쪽 회원이 결국 검사된다 (커서 순회)', () => {
  const all = profileList(200);
  const WINDOW = 200;
  // 한 실행에서 앞쪽 34명만 검사하고 전체 발행 상한(100편)에 걸려 끊기는 상황.
  const EXAMINED_PER_RUN = 34;

  let cursor: string | null = null;
  const examined = new Set<string>();

  for (let run = 0; run < 10; run++) {
    const window = orderByCursor(all, cursor, WINDOW);
    const seen = window.slice(0, EXAMINED_PER_RUN);
    for (const p of seen) examined.add(p.id);
    cursor = seen[seen.length - 1].id; // 마지막으로 검사한 회원
    if (examined.size === all.length) break;
  }

  assert.equal(examined.size, all.length, '10회 실행 안에 200명 전원이 검사돼야 한다');
  assert.ok(examined.has('p0199'), '맨 뒤 회원이 반드시 포함돼야 한다');
});

test('★ 창(200)보다 대상이 많아도 커서가 이어달려 전원 검사된다', () => {
  const all = profileList(1000);
  const WINDOW = 200;
  const EXAMINED_PER_RUN = 34; // 상한에 걸려 매번 앞쪽 34명만

  let cursor: string | null = null;
  const examined = new Set<string>();
  const maxRuns = all.length; // 최악이라도 total 회 안에 끝나야 한다

  let runs = 0;
  while (examined.size < all.length && runs < maxRuns) {
    const window = orderByCursor(all, cursor, WINDOW);
    const seen = window.slice(0, EXAMINED_PER_RUN);
    for (const p of seen) examined.add(p.id);
    cursor = seen[seen.length - 1].id;
    runs++;
  }

  assert.equal(examined.size, all.length, `전원 검사 실패 (runs=${runs})`);
  assert.ok(runs <= Math.ceil(all.length / EXAMINED_PER_RUN) + 1, `너무 오래 걸림: ${runs}회`);
});

test('★ 최악(실행당 1명만 검사)에도 유한 시간 안에 전원 검사된다', () => {
  const all = profileList(50);
  let cursor: string | null = null;
  const examined = new Set<string>();

  for (let run = 0; run < all.length; run++) {
    const window = orderByCursor(all, cursor, 200);
    const seen = window.slice(0, 1); // 첫 회원이 상한을 통째로 먹는 최악 케이스
    examined.add(seen[0].id);
    cursor = seen[0].id;
  }

  assert.equal(examined.size, all.length, 'total 회 실행이면 전원 검사돼야 한다');
});

test('orderByCursor: 커서 다음부터 시작하고 끝에서 앞으로 돌아온다', () => {
  const all = profileList(5); // p0000..p0004
  assert.deepEqual(orderByCursor(all, null, 3).map(p => p.id), ['p0000', 'p0001', 'p0002']);
  assert.deepEqual(orderByCursor(all, 'p0002', 3).map(p => p.id), ['p0003', 'p0004', 'p0000']);
  // 커서가 마지막이면 처음으로 돌아온다
  assert.deepEqual(orderByCursor(all, 'p0004', 2).map(p => p.id), ['p0000', 'p0001']);
  // 삭제된(존재하지 않는) 커서여도 그 다음 위치를 찾는다
  assert.deepEqual(orderByCursor(all, 'p0002x', 2).map(p => p.id), ['p0003', 'p0004']);
});

test('orderByCursor: 창이 전체보다 크면 중복 없이 전원만 담는다', () => {
  const all = profileList(3);
  const window = orderByCursor(all, 'p0001', 100);
  assert.equal(window.length, 3);
  assert.equal(new Set(window.map(p => p.id)).size, 3);
});

test('mergeCursorWindow: 중복 제거 + 상한 적용 (라우트의 두 keyset 쿼리 병합)', () => {
  const after = [{ id: 'b' }, { id: 'c' }];
  const wrapped = [{ id: 'a' }, { id: 'b' }]; // b 는 겹칠 수 있다
  assert.deepEqual(mergeCursorWindow(after, wrapped, 10).map(p => p.id), ['b', 'c', 'a']);
  assert.deepEqual(mergeCursorWindow(after, wrapped, 2).map(p => p.id), ['b', 'c']);
  assert.deepEqual(mergeCursorWindow(after, wrapped, 0), []);
});

test('dueThresholdIso: weekly=7일 전, biweekly=14일 전, auto/off 는 null', () => {
  const now = new Date('2026-07-26T00:00:00.000Z');
  assert.equal(dueThresholdIso('weekly', now), '2026-07-19T00:00:00.000Z');
  assert.equal(dueThresholdIso('biweekly', now), '2026-07-12T00:00:00.000Z');
  assert.equal(dueThresholdIso('auto', now), null);
  assert.equal(dueThresholdIso('off', now), null);
});

test('dueThresholdIso 는 isDue 와 같은 경계를 쓴다 (조건부 update 로 옮겨도 동작 동일)', () => {
  const now = new Date('2026-07-26T00:00:00.000Z');
  const threshold = dueThresholdIso('weekly', now);
  assert.ok(threshold);
  // 임계값과 정확히 같은 시각 = 7일 경과 = 발행 가능
  assert.equal(isDue('weekly', threshold, now), true);
  // 임계값보다 1ms 뒤 = 아직 7일 미만 = 발행 불가
  const justAfter = new Date(Date.parse(threshold) + 1).toISOString();
  assert.equal(isDue('weekly', justAfter, now), false);
});
