/**
 * 경쟁 종합 비교(스코어보드) 공용 인메모리 TTL 캐시.
 *
 * - 외부 API 쿼터 보호용 (YouTube Data API·소셜 공개 페이지 등).
 * - 서버리스 인스턴스 생존 기간 동안만 유효한 best-effort 캐시.
 *   (인스턴스 재시작 시 사라져도 기능은 정상 동작 — 재조회만 발생)
 * - globalThis 에 붙여 dev HMR·모듈 재평가에도 살아남게 한다.
 */

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const GLOBAL_KEY = '__dp_scoreboard_cache__';

function getStore(): Map<string, CacheEntry> {
  const g = globalThis as Record<string, unknown>;
  if (!(g[GLOBAL_KEY] instanceof Map)) {
    g[GLOBAL_KEY] = new Map<string, CacheEntry>();
  }
  return g[GLOBAL_KEY] as Map<string, CacheEntry>;
}

/** 기본 TTL: 6시간 */
export const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/** 캐시 조회. 만료됐거나 없으면 null. */
export function cacheGet<T>(key: string): T | null {
  const store = getStore();
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

/** 캐시 저장 (새 엔트리 객체 생성 — 기존 엔트리 변형 없음). */
export function cacheSet(key: string, value: unknown, ttlMs: number = DEFAULT_TTL_MS): void {
  const store = getStore();
  // 무한 성장 방지: 500개 초과 시 만료분 정리 후에도 크면 가장 오래된 것부터 제거
  if (store.size > 500) {
    const now = Date.now();
    for (const [k, v] of store) {
      if (now > v.expiresAt) store.delete(k);
    }
    while (store.size > 500) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}
