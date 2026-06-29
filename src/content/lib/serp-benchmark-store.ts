import type { SupabaseClient } from '@supabase/supabase-js';
import type { BenchmarkCacheStore, CachedBenchmarkRow } from '@/content/lib/serp-benchmark-cache';
import type { SerpBenchmark } from '@/content/lib/serp-benchmark';

/**
 * Supabase 기반 SerpBenchmark 캐시 저장소.
 *
 * 테이블 public.serp_benchmark_cache (마이그레이션 031):
 *   keyword text, target_site text, benchmark jsonb, expires_at timestamptz, created_at timestamptz
 *   primary key (keyword, target_site)
 *
 * 전역 캐시(사용자 무관·비민감)라 RLS 정책을 두지 않고 service role(createAdminClient)로만
 * 접근한다(post_rankings 와 동일 패턴). 모든 작업은 graceful — 실패 시 throw 하지 않는다.
 */

const TABLE = 'serp_benchmark_cache';

interface CacheRowRaw {
  benchmark?: unknown;
  expires_at?: unknown;
}

/** jsonb 로 저장된 benchmark 가 최소 형태를 갖췄는지 방어 검증 후 narrow. */
function asBenchmark(raw: unknown): SerpBenchmark | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (
    typeof b.targetCharCount !== 'number' ||
    typeof b.targetH2 !== 'number' ||
    typeof b.targetH3 !== 'number' ||
    typeof b.targetImages !== 'number' ||
    !Array.isArray(b.subtopics) ||
    typeof b.hasFaq !== 'boolean' ||
    (b.confidence !== 'measured' && b.confidence !== 'estimated')
  ) {
    return null;
  }
  return raw as SerpBenchmark;
}

export function createSupabaseBenchmarkStore(client: SupabaseClient): BenchmarkCacheStore {
  return {
    async get(keyword: string, targetSite: string): Promise<CachedBenchmarkRow | null> {
      try {
        const { data, error } = await client
          .from(TABLE)
          .select('benchmark, expires_at')
          .eq('keyword', keyword)
          .eq('target_site', targetSite)
          .maybeSingle();
        if (error || !data) return null;

        const row = data as CacheRowRaw;
        const benchmark = asBenchmark(row.benchmark);
        if (!benchmark) return null;

        const expiresAt = typeof row.expires_at === 'string' ? Date.parse(row.expires_at) : NaN;
        if (!Number.isFinite(expiresAt)) return null;

        return { benchmark, expiresAt };
      } catch {
        return null;
      }
    },

    async set(keyword: string, targetSite: string, row: CachedBenchmarkRow): Promise<void> {
      try {
        await client.from(TABLE).upsert(
          {
            keyword,
            target_site: targetSite,
            benchmark: row.benchmark,
            expires_at: new Date(row.expiresAt).toISOString(),
            created_at: new Date().toISOString(),
          },
          { onConflict: 'keyword,target_site' }
        );
      } catch {
        // 캐시 쓰기 실패는 무시
      }
    },
  };
}
