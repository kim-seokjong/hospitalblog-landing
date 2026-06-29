import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCacheKey,
  normalizeTargetSite,
  isCacheValid,
  shouldRunReverseAnalysis,
  getOrComputeBenchmark,
  SERP_BENCHMARK_TTL_MS,
  type BenchmarkCacheStore,
  type CachedBenchmarkRow,
} from '../serp-benchmark-cache.ts';
import type { SerpBenchmark } from '../serp-benchmark.ts';

function makeBenchmark(overrides: Partial<SerpBenchmark> = {}): SerpBenchmark {
  return {
    targetCharCount: 1800,
    targetH2: 5,
    targetH3: 3,
    targetImages: 5,
    subtopics: ['원인', '치료'],
    hasFaq: true,
    confidence: 'measured',
    sampleSize: 3,
    competitionLevel: 'medium',
    ...overrides,
  };
}

/** 인메모리 가짜 저장소 + 호출 카운터. */
function makeFakeStore() {
  const map = new Map<string, CachedBenchmarkRow>();
  const calls = { get: 0, set: 0 };
  const store: BenchmarkCacheStore = {
    async get(keyword, targetSite) {
      calls.get++;
      return map.get(`${keyword}|${targetSite}`) ?? null;
    },
    async set(keyword, targetSite, row) {
      calls.set++;
      map.set(`${keyword}|${targetSite}`, row);
    },
  };
  return { store, calls, map };
}

// ── normalizeCacheKey ──
test('normalizeCacheKey: trim + 연속공백 1칸 + 소문자', () => {
  assert.equal(normalizeCacheKey('  보톡스   시술 '), '보톡스 시술');
  assert.equal(normalizeCacheKey('Botox\tToning'), 'botox toning');
  assert.equal(normalizeCacheKey(''), '');
  // 타입 외 입력 방어
  assert.equal(normalizeCacheKey(undefined as unknown as string), '');
});

// ── normalizeTargetSite ──
test('normalizeTargetSite: google 만 google, 그 외 naver', () => {
  assert.equal(normalizeTargetSite('google'), 'google');
  assert.equal(normalizeTargetSite('naver'), 'naver');
  assert.equal(normalizeTargetSite(undefined), 'naver');
  assert.equal(normalizeTargetSite('something'), 'naver');
});

// ── isCacheValid ──
test('isCacheValid: 만료 전 true, 만료 후 false', () => {
  const row: CachedBenchmarkRow = { benchmark: makeBenchmark(), expiresAt: 1000 };
  assert.equal(isCacheValid(row, 999), true);
  assert.equal(isCacheValid(row, 1000), false);
  assert.equal(isCacheValid(row, 1001), false);
});

// ── shouldRunReverseAnalysis (토글 기본 ON) ──
test('shouldRunReverseAnalysis: 기본 ON, 명시적 false 만 OFF', () => {
  assert.equal(shouldRunReverseAnalysis(undefined), true); // 구버전/미지정 → ON
  assert.equal(shouldRunReverseAnalysis(true), true);
  assert.equal(shouldRunReverseAnalysis(false), false); // OFF
});

// ── getOrComputeBenchmark: 미스 → compute + 저장 ──
test('getOrComputeBenchmark: 캐시 미스면 compute 후 저장(set)', async () => {
  const { store, calls, map } = makeFakeStore();
  let computed = 0;
  const result = await getOrComputeBenchmark({
    keyword: '보톡스',
    targetSite: 'naver',
    store,
    now: 1_000_000,
    compute: async () => { computed++; return makeBenchmark(); },
  });
  assert.ok(result);
  assert.equal(computed, 1);
  assert.equal(calls.get, 1);
  assert.equal(calls.set, 1);
  // 저장된 만료시각 = now + TTL
  const saved = map.get('보톡스|naver');
  assert.equal(saved!.expiresAt, 1_000_000 + SERP_BENCHMARK_TTL_MS);
});

// ── getOrComputeBenchmark: 히트 → compute 안 함 ──
test('getOrComputeBenchmark: 유효 캐시 히트면 compute 호출 안 함', async () => {
  const { store, calls } = makeFakeStore();
  await store.set('보톡스', 'naver', { benchmark: makeBenchmark({ targetCharCount: 2222 }), expiresAt: 2_000_000 });
  let computed = 0;
  const result = await getOrComputeBenchmark({
    keyword: ' 보톡스 ', // 정규화로 동일 키
    targetSite: 'naver',
    store,
    now: 1_000_000, // 만료 전
    compute: async () => { computed++; return makeBenchmark(); },
  });
  assert.equal(computed, 0);
  assert.equal(result!.targetCharCount, 2222);
  assert.equal(calls.set, 1); // 최초 seeding 1회뿐, 재저장 없음
});

// ── getOrComputeBenchmark: 만료 → 재계산 ──
test('getOrComputeBenchmark: 만료된 캐시는 재계산', async () => {
  const { store } = makeFakeStore();
  await store.set('보톡스', 'naver', { benchmark: makeBenchmark({ targetCharCount: 1111 }), expiresAt: 500 });
  let computed = 0;
  const result = await getOrComputeBenchmark({
    keyword: '보톡스',
    targetSite: 'naver',
    store,
    now: 1000, // expiresAt(500) 지남 → 만료
    compute: async () => { computed++; return makeBenchmark({ targetCharCount: 3333 }); },
  });
  assert.equal(computed, 1);
  assert.equal(result!.targetCharCount, 3333);
});

// ── getOrComputeBenchmark: 사이트별 캐시 분리 ──
test('getOrComputeBenchmark: naver/google 캐시 키 분리', async () => {
  const { store, map } = makeFakeStore();
  await getOrComputeBenchmark({ keyword: '보톡스', targetSite: 'naver', store, now: 0, compute: async () => makeBenchmark({ targetCharCount: 1500 }) });
  await getOrComputeBenchmark({ keyword: '보톡스', targetSite: 'google', store, now: 0, compute: async () => makeBenchmark({ targetCharCount: 2200 }) });
  assert.equal(map.get('보톡스|naver')!.benchmark.targetCharCount, 1500);
  assert.equal(map.get('보톡스|google')!.benchmark.targetCharCount, 2200);
});

// ── getOrComputeBenchmark: store 없으면 항상 compute (캐시 비활성) ──
test('getOrComputeBenchmark: store=null 이면 항상 compute', async () => {
  let computed = 0;
  const result = await getOrComputeBenchmark({
    keyword: '보톡스',
    store: null,
    compute: async () => { computed++; return makeBenchmark(); },
  });
  assert.equal(computed, 1);
  assert.ok(result);
});

// ── getOrComputeBenchmark: compute 가 null 이면 저장 안 함 ──
test('getOrComputeBenchmark: compute null 결과는 캐시에 저장하지 않음', async () => {
  const { store, calls } = makeFakeStore();
  const result = await getOrComputeBenchmark({
    keyword: '보톡스',
    store,
    now: 0,
    compute: async () => null,
  });
  assert.equal(result, null);
  assert.equal(calls.set, 0);
});

// ── getOrComputeBenchmark: 저장소 장애는 graceful (compute 결과 우선) ──
test('getOrComputeBenchmark: store.get/set 이 throw 해도 compute 결과 반환', async () => {
  const brokenStore: BenchmarkCacheStore = {
    async get() { throw new Error('db down'); },
    async set() { throw new Error('db down'); },
  };
  let computed = 0;
  const result = await getOrComputeBenchmark({
    keyword: '보톡스',
    store: brokenStore,
    compute: async () => { computed++; return makeBenchmark({ targetCharCount: 1777 }); },
  });
  assert.equal(computed, 1);
  assert.equal(result!.targetCharCount, 1777);
});

// ── getOrComputeBenchmark: 빈 키워드는 캐시 우회하고 compute 위임 ──
test('getOrComputeBenchmark: 빈 키워드는 저장소 접근 없이 compute', async () => {
  const { store, calls } = makeFakeStore();
  const result = await getOrComputeBenchmark({
    keyword: '   ',
    store,
    compute: async () => null,
  });
  assert.equal(result, null);
  assert.equal(calls.get, 0);
  assert.equal(calls.set, 0);
});
