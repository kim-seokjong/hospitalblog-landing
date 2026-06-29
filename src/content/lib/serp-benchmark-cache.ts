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
