import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DIAGNOSIS_GLOBAL_LIMIT,
  DEFAULT_DIAGNOSIS_IP_LIMIT,
  DEFAULT_LOOKUP_IP_LIMIT,
  diagnosisCacheKey,
  isCacheable,
  joinOrStartSingleFlight,
  limitMessage,
  lookupCacheKey,
  readDiagnosisLimits,
  readLookupLimits,
} from '../limits.ts';
import { consumeBlogCheckQuota } from '../../blog-check-limits.ts';
import { cacheGet, cacheSet } from '../../scoreboard/cache.ts';

/**
 * 무료 공개 엔드포인트의 비용 방어(캐시·캡·single-flight)가 실제로 동작하는지 검증.
 * 라우트가 쓰는 것과 같은 순수 함수를 그대로 돌린다.
 */

/* ── 캐시 키 ────────────────────────────────────────────── */

test('진단 캐시 키는 직접 입력값까지 포함한다 (A의 자동탐색이 B의 수동입력을 덮지 않도록)', () => {
  const auto = diagnosisCacheKey({ mngNo: 'M1' });
  const manualBlog = diagnosisCacheKey({ mngNo: 'M1', blogId: 'myclinic' });
  const manualSite = diagnosisCacheKey({ mngNo: 'M1', siteUrl: 'https://a.co.kr' });
  assert.notEqual(auto, manualBlog);
  assert.notEqual(auto, manualSite);
  assert.notEqual(manualBlog, manualSite);
  // 같은 입력이면 같은 키 (대소문자·공백 무시)
  assert.equal(diagnosisCacheKey({ mngNo: 'M1', blogId: ' MyClinic ' }), manualBlog);
});

test('후보 검색 캐시 키는 이름·지역 표기 흔들림을 흡수한다', () => {
  assert.equal(lookupCacheKey(' 브이비성형외과의원 ', ''), lookupCacheKey('브이비성형외과의원', ''));
  assert.notEqual(lookupCacheKey('미소치과의원', '대구'), lookupCacheKey('미소치과의원', '서울'));
});

test('붙여넣은 본문이 있는 진단은 캐시하지 않는다', () => {
  assert.equal(isCacheable({ hasPastedBody: false }), true);
  assert.equal(isCacheable({}), true);
  assert.equal(isCacheable({ hasPastedBody: true }), false);
});

test('캐시는 저장한 값을 그대로 돌려주고 TTL 이 지나면 버린다', () => {
  const key = `test:clinicdx:${Math.random()}`;
  assert.equal(cacheGet(key), null);
  cacheSet(key, { v: 1 }, 5_000);
  assert.deepEqual(cacheGet(key), { v: 1 });
  // 이미 만료된 TTL 로 덮어쓰면 즉시 미스
  cacheSet(key, { v: 2 }, -1);
  assert.equal(cacheGet(key), null);
});

/* ── 실행 캡 ───────────────────────────────────────────── */

test('env 가 비정상이면 기본 캡으로 떨어진다 (throw 금지)', () => {
  for (const bad of [undefined, '', 'abc', '0', '-5', 'NaN']) {
    const limits = readDiagnosisLimits({ CLINIC_DIAGNOSIS_IP_DAILY_LIMIT: bad } as NodeJS.ProcessEnv);
    assert.equal(limits.ipDaily, DEFAULT_DIAGNOSIS_IP_LIMIT);
  }
  assert.equal(readDiagnosisLimits({} as NodeJS.ProcessEnv).globalDaily, DEFAULT_DIAGNOSIS_GLOBAL_LIMIT);
  assert.equal(readLookupLimits({} as NodeJS.ProcessEnv).ipDaily, DEFAULT_LOOKUP_IP_LIMIT);
  // 정상 값은 반영된다
  assert.equal(
    readDiagnosisLimits({ CLINIC_DIAGNOSIS_IP_DAILY_LIMIT: '7' } as NodeJS.ProcessEnv).ipDaily,
    7,
  );
});

test('IP 캡을 넘으면 차단된다', () => {
  const store = new Map<string, number>();
  const limits = { ipDaily: 3, globalDaily: 100 };
  for (let i = 0; i < 3; i++) {
    assert.equal(consumeBlogCheckQuota(store, { ip: '1.1.1.1', limits }).allowed, true, `${i + 1}번째는 통과해야 한다`);
  }
  const blocked = consumeBlogCheckQuota(store, { ip: '1.1.1.1', limits });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.allowed === false && blocked.reason, 'ip_limit');
  // 다른 IP 는 영향받지 않는다
  assert.equal(consumeBlogCheckQuota(store, { ip: '2.2.2.2', limits }).allowed, true);
});

test('전체 캡이 IP 캡보다 먼저 걸린다', () => {
  const store = new Map<string, number>();
  const limits = { ipDaily: 10, globalDaily: 2 };
  consumeBlogCheckQuota(store, { ip: 'a', limits });
  consumeBlogCheckQuota(store, { ip: 'b', limits });
  const blocked = consumeBlogCheckQuota(store, { ip: 'c', limits });
  assert.equal(blocked.allowed === false && blocked.reason, 'global_limit');
});

test('진단 캡과 후보검색 캡은 저장소가 분리돼 서로 잠식하지 않는다', () => {
  const dxStore = new Map<string, number>();
  const lookupStore = new Map<string, number>();
  const dxLimits = { ipDaily: 3, globalDaily: 100 };
  const lookupLimits = { ipDaily: 30, globalDaily: 1000 };
  for (let i = 0; i < 3; i++) consumeBlogCheckQuota(dxStore, { ip: '1.1.1.1', limits: dxLimits });
  // 진단 캡을 다 썼어도 후보 검색은 계속 가능해야 한다
  assert.equal(consumeBlogCheckQuota(lookupStore, { ip: '1.1.1.1', limits: lookupLimits }).allowed, true);
});

/* ── single-flight ─────────────────────────────────────── */

test('같은 병원 동시 요청은 리더 1회만 실행하고 팔로워는 캡을 소비하지 않는다', async () => {
  const inflight = new Map<string, Promise<string>>();
  let quotaCalls = 0;
  let runs = 0;
  let release: (v: string) => void = () => undefined;
  const gate = new Promise<string>((resolve) => { release = resolve; });

  const start = () => { runs += 1; return gate; };
  const quota = () => { quotaCalls += 1; return { allowed: true as const }; };

  const leader = joinOrStartSingleFlight(inflight, 'clinic:M1', quota, start);
  const follower1 = joinOrStartSingleFlight(inflight, 'clinic:M1', quota, start);
  const follower2 = joinOrStartSingleFlight(inflight, 'clinic:M1', quota, start);

  assert.equal(leader.ok && leader.isLeader, true);
  assert.equal(follower1.ok && follower1.isLeader, false);
  assert.equal(follower2.ok && follower2.isLeader, false);
  assert.equal(runs, 1, '파이프라인은 1회만 돌아야 한다');
  assert.equal(quotaCalls, 1, '팔로워는 캡을 소비하면 안 된다');

  release('done');
  assert.equal(leader.ok && (await leader.promise), 'done');
  assert.equal(follower1.ok && (await follower1.promise), 'done');

  // 완료 후에는 맵에서 빠져 다음 요청이 새로 돈다
  await Promise.resolve();
  assert.equal(inflight.has('clinic:M1'), false);
});

test('캡에 걸리면 파이프라인을 시작조차 하지 않는다', () => {
  const inflight = new Map<string, Promise<string>>();
  let runs = 0;
  const join = joinOrStartSingleFlight(
    inflight,
    'clinic:M1',
    () => ({ allowed: false as const, reason: 'ip_limit' as const }),
    async () => { runs += 1; return 'x'; },
  );
  assert.equal(join.ok, false);
  assert.equal(runs, 0);
  assert.equal(inflight.size, 0);
});

test('다른 병원은 서로 막지 않는다', () => {
  const inflight = new Map<string, Promise<string>>();
  const quota = () => ({ allowed: true as const });
  const a = joinOrStartSingleFlight(inflight, 'clinic:A', quota, () => new Promise<string>(() => undefined));
  const b = joinOrStartSingleFlight(inflight, 'clinic:B', quota, () => new Promise<string>(() => undefined));
  assert.equal(a.ok && a.isLeader, true);
  assert.equal(b.ok && b.isLeader, true);
});

test('limitMessage 는 사유별로 다른 안내를 준다', () => {
  assert.match(limitMessage('global_limit'), /오늘 무료 진단 사용량/);
  assert.match(limitMessage('ip_limit'), /무료 진단 횟수/);
});
