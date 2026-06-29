import type { SerpBenchmark } from '@/content/lib/serp-benchmark';

/**
 * 상위노출 역분석 벤치마크 캐싱 (순수 로직).
 *
 * SerpBenchmark 는 키워드(+게시 사이트) 단위의 전역 자원이다(사용자 무관, PII 없음).
 * 같은 키워드로 재생성할 때 매번 네이버 검색·본문 fetch·Claude 분석을 반복하면
 * 레이턴시·비용이 크므로, TTL 동안 캐시를 재사용한다.
 *
 * 설계:
 * - 저장소는 인터페이스(BenchmarkCacheStore)로 추상화 → Supabase 구현은 별도 파일,
 *   순수 캐시 로직(정규화/만료/get-or-compute)은 외부 의존 없이 단위테스트 가능.
 * - 모든 저장소 접근은 graceful: 실패하면 캐시를 무시하고 compute 로 진행한다
 *   (캐시 장애가 생성 플로우를 깨면 안 됨).
 * - 캐시 키는 정규화(NFC·trim·연속공백 1칸·소문자)해 표기 차이로 인한 미스를 줄인다.
 */

export type { SerpBenchmark } from '@/content/lib/serp-benchmark';

/** 기본 TTL — 7일. 상위노출 분포는 자주 바뀌지 않으므로 과한 재계산을 피한다. */
export const SERP_BENCHMARK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedBenchmarkRow {
  benchmark: SerpBenchmark;
  /** 만료 시각(epoch ms). 이 시각을 지나면 무효(재계산). */
  expiresAt: number;
}

/**
 * 캐시 저장소 추상화. 구현은 keyword/targetSite 를 키로 1행을 보관한다.
 * 어떤 구현도 실패 시 throw 하지 않고 graceful 하게 동작해야 한다(get→null, set→무시).
 */
export interface BenchmarkCacheStore {
  get(keyword: string, targetSite: string): Promise<CachedBenchmarkRow | null>;
  set(keyword: string, targetSite: string, row: CachedBenchmarkRow): Promise<void>;
}

/**
 * 상위노출 역분석 토글 해석 — 기본 ON. 명시적 false 일 때만 OFF.
 * 미지정/구버전 요청은 ON(하위 호환). OFF면 호출측은 벤치마크 산출/주입/동적체크를 스킵.
 */
export function shouldRunReverseAnalysis(raw: unknown): boolean {
  return raw !== false;
}

/** 캐시 키 정규화 — 표기 차이(공백/대소문자/유니코드 정규화)를 흡수한다. */
export function normalizeCacheKey(keyword: string): string {
  if (typeof keyword !== 'string') return '';
  return keyword.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 게시 사이트 정규화 — 'google' 만 google, 그 외는 모두 naver(하위 호환). */
export function normalizeTargetSite(targetSite: string | undefined | null): string {
  return targetSite === 'google' ? 'google' : 'naver';
}

/** 캐시 행이 아직 유효한지(만료 전인지). */
export function isCacheValid(row: CachedBenchmarkRow, now: number): boolean {
  return typeof row.expiresAt === 'number' && row.expiresAt > now;
}

export interface GetOrComputeOptions {
  keyword: string;
  targetSite?: string | null;
  /** null 이면 캐시 비활성(항상 compute). */
  store: BenchmarkCacheStore | null;
  /** 캐시 미스/만료 시 실제 벤치마크 산출. null 가능(산출 불가). */
  compute: () => Promise<SerpBenchmark | null>;
  now?: number;
  ttlMs?: number;
}

/**
 * 캐시 우선 벤치마크 조회. 히트(유효)면 캐시 반환, 미스/만료면 compute 후 저장.
 * 캐시 읽기/쓰기 실패는 모두 무시하고 compute 결과를 우선한다(graceful).
 */
export async function getOrComputeBenchmark(opts: GetOrComputeOptions): Promise<SerpBenchmark | null> {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? SERP_BENCHMARK_TTL_MS;
  const key = normalizeCacheKey(opts.keyword);
  const site = normalizeTargetSite(opts.targetSite);

  if (key === '') {
    // 빈 키워드는 캐시하지 않고 compute 에 위임(compute 가 null 처리).
    return opts.compute();
  }

  // 1) 캐시 조회 (graceful)
  if (opts.store) {
    try {
      const cached = await opts.store.get(key, site);
      if (cached && isCacheValid(cached, now)) {
        return cached.benchmark;
      }
    } catch {
      // 캐시 읽기 실패는 무시 — compute 로 진행
    }
  }

  // 2) 미스/만료/장애 → 재계산
  const fresh = await opts.compute();

  // 3) 저장 (산출 성공 + 저장소 있을 때만, graceful)
  if (fresh && opts.store) {
    try {
      await opts.store.set(key, site, { benchmark: fresh, expiresAt: now + ttlMs });
    } catch {
      // 캐시 쓰기 실패는 무시 — 결과는 그대로 반환
    }
  }

  return fresh;
}

// ─────────────────────────────────────────────────────────────
// 캐시 워밍 (주 1회 Cron) — 자주 쓰는 키워드의 벤치마크를 미리 계산·캐시
//
// 이 파일에 두는 이유: normalizeCacheKey/normalizeTargetSite/TTL 을 같은 파일에서
// 재사용하면 단위테스트 러너(node --experimental-strip-types)가 @/ alias 를 해석하지
// 못하는 제약을 피하면서 중복 구현 없이 캐시 로직을 공유할 수 있다.
// ─────────────────────────────────────────────────────────────

/** 워밍 대상 키워드 상한(비용 가드). */
export const WARM_KEYWORD_LIMIT = 30;
/** 워밍 대상 게시 사이트. 벤치마크는 사이트 무관하게 동일 산출이라 1회 계산 후 양쪽에 upsert. */
export const WARM_TARGET_SITES: readonly string[] = ['naver', 'google'];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown';
}

/**
 * 워밍 대상 키워드 선정.
 * 1) 실제 글 키워드를 정규화·빈도 집계해 많이 쓰인 순으로 고른다(대표 표기는 첫 등장 원문).
 * 2) limit 에 못 미치면 진료과별 시드 키워드로 채운다(데이터 부족 폴백, 중복 제외).
 * 반환은 limit 개 이하의 대표 키워드(검색에 쓸 원문 형태).
 */
export function selectWarmKeywords(
  postKeywords: readonly (string | null | undefined)[],
  seedKeywords: readonly string[],
  limit: number = WARM_KEYWORD_LIMIT
): string[] {
  const chosen: string[] = [];
  const seen = new Set<string>();

  // 1) 실제 글 키워드 빈도 집계 (정규화 키 기준 중복 합산)
  const counts = new Map<string, { rep: string; count: number; order: number }>();
  let order = 0;
  for (const raw of postKeywords) {
    if (typeof raw !== 'string') continue;
    const rep = raw.trim();
    if (rep === '') continue;
    const norm = normalizeCacheKey(rep);
    if (norm === '') continue;
    const existing = counts.get(norm);
    if (existing) {
      counts.set(norm, { ...existing, count: existing.count + 1 });
    } else {
      counts.set(norm, { rep, count: 1, order: order++ });
    }
  }

  const ranked = Array.from(counts.entries()).sort(
    (a, b) => b[1].count - a[1].count || a[1].order - b[1].order
  );
  for (const [norm, v] of ranked) {
    if (chosen.length >= limit) break;
    if (seen.has(norm)) continue;
    seen.add(norm);
    chosen.push(v.rep);
  }

  // 2) 부족하면 시드로 채움
  for (const seed of seedKeywords) {
    if (chosen.length >= limit) break;
    if (typeof seed !== 'string') continue;
    const rep = seed.trim();
    if (rep === '') continue;
    const norm = normalizeCacheKey(rep);
    if (norm === '' || seen.has(norm)) continue;
    seen.add(norm);
    chosen.push(rep);
  }

  return chosen;
}

export interface WarmResult {
  /** 시도한 키워드 수 */
  attempted: number;
  /** 벤치마크 산출+캐시 저장에 성공한 키워드 수 */
  succeeded: number;
  /** 벤치마크 산출 불가(compute null)로 건너뛴 키워드 수 */
  skipped: number;
  /** 처리 중 예외가 난 키워드 수 */
  failed: number;
  /** store.set 성공 건수(키워드 × 사이트) */
  cachedEntries: number;
  failures: Array<{ keyword: string; reason: string }>;
}

export interface WarmSerpCacheOptions {
  keywords: readonly string[];
  targetSites: readonly string[];
  store: BenchmarkCacheStore;
  /** 키워드별 벤치마크 산출기(buildSerpBenchmark 주입). null 반환 가능. */
  compute: (keyword: string) => Promise<SerpBenchmark | null>;
  concurrency?: number;
  now?: number;
  ttlMs?: number;
}

/**
 * 키워드 목록의 벤치마크를 강제 재계산해 캐시에 upsert(만료 무관 갱신).
 * 벤치마크는 사이트 무관 동일 산출이므로 키워드당 1회 계산 후 모든 사이트 키에 저장(비용 절감).
 * 키워드별 try/catch 로 일부 실패해도 계속 진행하며, 어떤 실패도 throw 하지 않는다(graceful).
 */
export async function warmSerpCache(opts: WarmSerpCacheOptions): Promise<WarmResult> {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? SERP_BENCHMARK_TTL_MS;
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const sites = opts.targetSites.length > 0 ? opts.targetSites : ['naver'];
  const keywords = opts.keywords;

  const result: WarmResult = {
    attempted: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    cachedEntries: 0,
    failures: [],
  };

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const idx = cursor++;
      if (idx >= keywords.length) break;
      const keyword = keywords[idx];
      result.attempted++;
      try {
        const benchmark = await opts.compute(keyword);
        if (!benchmark) {
          result.skipped++;
          continue;
        }
        const key = normalizeCacheKey(keyword);
        if (key === '') {
          result.skipped++;
          continue;
        }
        for (const site of sites) {
          try {
            await opts.store.set(key, normalizeTargetSite(site), {
              benchmark,
              expiresAt: now + ttlMs,
            });
            result.cachedEntries++;
          } catch (e) {
            result.failures.push({ keyword, reason: `set ${site}: ${errMsg(e)}` });
          }
        }
        result.succeeded++;
      } catch (e) {
        result.failed++;
        result.failures.push({ keyword, reason: errMsg(e) });
      }
    }
  };

  const workerCount = Math.min(concurrency, Math.max(1, keywords.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return result;
}
