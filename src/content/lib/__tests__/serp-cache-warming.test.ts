import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectWarmKeywords,
  warmSerpCache,
  WARM_KEYWORD_LIMIT,
  SERP_BENCHMARK_TTL_MS,
  type BenchmarkCacheStore,
  type CachedBenchmarkRow,
} from '../serp-benchmark-cache.ts';
import { SEED_KEYWORDS_BY_SPECIALTY, getDefaultSeedKeywords } from '../serp-warm-seeds.ts';
import { isAuthorizedCron } from '../../../dev/lib/cron-auth.ts';
import type { SerpBenchmark } from '../serp-benchmark.ts';

function makeBenchmark(overrides: Partial<SerpBenchmark> = {}): SerpBenchmark {
  return {
    targetCharCount: 1800,
    targetH2: 5,
    targetH3: 3,
    targetImages: 5,
    subtopics: ['원인'],
    hasFaq: true,
    confidence: 'measured',
    sampleSize: 3,
    competitionLevel: 'medium',
    ...overrides,
  };
}

function makeFakeStore() {
  const map = new Map<string, CachedBenchmarkRow>();
  const calls = { set: 0 };
  const store: BenchmarkCacheStore = {
    async get(keyword, targetSite) {
      return map.get(`${keyword}|${targetSite}`) ?? null;
    },
    async set(keyword, targetSite, row) {
      calls.set++;
      map.set(`${keyword}|${targetSite}`, row);
    },
  };
  return { store, calls, map };
}

// ── selectWarmKeywords: 빈도 집계 + 정렬 ──
test('selectWarmKeywords: 자주 쓰인 키워드 우선', () => {
  const out = selectWarmKeywords(['보톡스', '보톡스', '필러'], [], 10);
  assert.deepEqual(out, ['보톡스', '필러']);
});

test('selectWarmKeywords: 정규화 중복 합산(공백/대소문자)', () => {
  const out = selectWarmKeywords(['레이저 토닝', '레이저  토닝', '필러'], [], 10);
  // '레이저 토닝'/'레이저  토닝' 동일 정규화 → 1개(빈도2)로, 필러보다 앞
  assert.equal(out.length, 2);
  assert.equal(out[0], '레이저 토닝');
  assert.equal(out[1], '필러');
});

test('selectWarmKeywords: limit 으로 cap', () => {
  const out = selectWarmKeywords(['a', 'b', 'c', 'd'], [], 2);
  assert.equal(out.length, 2);
});

test('selectWarmKeywords: 부족하면 시드로 채움(중복 제외)', () => {
  const out = selectWarmKeywords(['보톡스'], ['보톡스', '필러', '리프팅'], 3);
  // 시드의 '보톡스'는 이미 있으므로 제외
  assert.deepEqual(out, ['보톡스', '필러', '리프팅']);
});

test('selectWarmKeywords: 글 키워드 없으면 시드만', () => {
  const out = selectWarmKeywords([], ['여드름 원인', '기미 관리'], 5);
  assert.deepEqual(out, ['여드름 원인', '기미 관리']);
});

test('selectWarmKeywords: null/빈문자 필터', () => {
  const out = selectWarmKeywords([null, '', '   ', '보톡스'], [], 10);
  assert.deepEqual(out, ['보톡스']);
});

// ── 시드 데이터 무결성 ──
test('getDefaultSeedKeywords: 진료과 시드 평탄화·비어있지 않음', () => {
  const seeds = getDefaultSeedKeywords();
  assert.ok(seeds.length >= 15);
  assert.ok(seeds.includes('여드름 원인'));
  // 진료과 키 존재
  assert.ok(Object.keys(SEED_KEYWORDS_BY_SPECIALTY).length >= 15);
});

// ── warmSerpCache: 성공 경로(사이트별 upsert) ──
test('warmSerpCache: 성공 시 키워드×사이트 만큼 캐시 저장', async () => {
  const { store, calls, map } = makeFakeStore();
  const result = await warmSerpCache({
    keywords: ['보톡스', '필러'],
    targetSites: ['naver', 'google'],
    store,
    compute: async () => makeBenchmark(),
    now: 1_000_000,
  });
  assert.equal(result.attempted, 2);
  assert.equal(result.succeeded, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.cachedEntries, 4); // 2 키워드 × 2 사이트
  assert.equal(calls.set, 4);
  // 만료시각 = now + TTL
  assert.equal(map.get('보톡스|naver')!.expiresAt, 1_000_000 + SERP_BENCHMARK_TTL_MS);
  assert.ok(map.get('보톡스|google'));
});

// ── warmSerpCache: compute null → skipped (저장 안 함) ──
test('warmSerpCache: 벤치마크 산출 불가(null)는 skipped', async () => {
  const { store, calls } = makeFakeStore();
  const result = await warmSerpCache({
    keywords: ['보톡스', '필러'],
    targetSites: ['naver'],
    store,
    compute: async (kw) => (kw === '필러' ? null : makeBenchmark()),
  });
  assert.equal(result.succeeded, 1);
  assert.equal(result.skipped, 1);
  assert.equal(calls.set, 1);
});

// ── warmSerpCache: 일부 키워드 compute throw → 계속 진행 ──
test('warmSerpCache: 키워드 처리 실패는 graceful(계속 진행)', async () => {
  const { store } = makeFakeStore();
  const result = await warmSerpCache({
    keywords: ['보톡스', '필러', '리프팅'],
    targetSites: ['naver'],
    store,
    compute: async (kw) => {
      if (kw === '필러') throw new Error('claude down');
      return makeBenchmark();
    },
    concurrency: 1,
  });
  assert.equal(result.attempted, 3);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].reason, /claude down/);
});

// ── warmSerpCache: store.set throw → 캐시 실패 기록, 죽지 않음 ──
test('warmSerpCache: 저장소 set 실패도 graceful', async () => {
  const brokenStore: BenchmarkCacheStore = {
    async get() { return null; },
    async set() { throw new Error('db down'); },
  };
  const result = await warmSerpCache({
    keywords: ['보톡스'],
    targetSites: ['naver', 'google'],
    store: brokenStore,
    compute: async () => makeBenchmark(),
  });
  // compute 는 성공 → succeeded 1, 하지만 저장 실패 2건 기록, cachedEntries 0
  assert.equal(result.succeeded, 1);
  assert.equal(result.cachedEntries, 0);
  assert.equal(result.failures.length, 2);
});

// ── warmSerpCache: 빈 키워드 목록 ──
test('warmSerpCache: 빈 목록이면 아무것도 안 함', async () => {
  const { store, calls } = makeFakeStore();
  const result = await warmSerpCache({
    keywords: [],
    targetSites: ['naver'],
    store,
    compute: async () => makeBenchmark(),
  });
  assert.equal(result.attempted, 0);
  assert.equal(calls.set, 0);
});

test('WARM_KEYWORD_LIMIT: 비용 가드 상수 노출', () => {
  assert.equal(typeof WARM_KEYWORD_LIMIT, 'number');
  assert.ok(WARM_KEYWORD_LIMIT > 0);
});

// ── isAuthorizedCron: 인증 가드 ──
function fakeReq(authHeader: string | null) {
  return { headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? authHeader : null) } };
}

test('isAuthorizedCron: CRON_SECRET 미설정이면 거부', () => {
  const prev = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    assert.equal(isAuthorizedCron(fakeReq('Bearer anything') as never), false);
  } finally {
    if (prev !== undefined) process.env.CRON_SECRET = prev;
  }
});

test('isAuthorizedCron: 올바른 Bearer 면 허용, 틀리면 거부', () => {
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 's3cret';
  try {
    assert.equal(isAuthorizedCron(fakeReq('Bearer s3cret') as never), true);
    assert.equal(isAuthorizedCron(fakeReq('Bearer wrong') as never), false);
    assert.equal(isAuthorizedCron(fakeReq(null) as never), false);
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  }
});
