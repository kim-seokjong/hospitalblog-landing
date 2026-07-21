/**
 * 네이버 블로그 무료진단 — 비회원 실행 캡 (순수 로직).
 *
 * 공개 엔드포인트 남용 방어: IP당 일 3회 + 전체 일 100회 (env 로 조절).
 * 저장소는 호출부가 주입하는 Map(globalThis 인메모리) — 서버리스 인스턴스
 * 생존 기간 동안만 유효한 best-effort 캡이다(scoreboard/cache.ts 와 동일 철학).
 * 인스턴스 리셋으로 카운터가 초기화될 수 있으나, 상한이 낮고 결과가 7일
 * 캐시되므로 실질 비용 노출은 제한적이다.
 *
 * 날짜 경계는 KST(UTC+9) 자정 — 한국 사용자 기준으로 "하루 3회"가 직관적이다.
 */

/** IP당 일일 기본 캡. env: BLOG_CHECK_IP_DAILY_LIMIT */
export const DEFAULT_IP_DAILY_LIMIT = 3;
/** 전체 일일 기본 캡. env: BLOG_CHECK_GLOBAL_DAILY_LIMIT */
export const DEFAULT_GLOBAL_DAILY_LIMIT = 100;

export interface BlogCheckLimits {
  ipDaily: number;
  globalDaily: number;
}

/** env 에서 캡을 읽는다. 비정상 값은 기본값 (절대 throw 안 함). */
export function readBlogCheckLimits(env: NodeJS.ProcessEnv = process.env): BlogCheckLimits {
  const parse = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  return {
    ipDaily: parse(env.BLOG_CHECK_IP_DAILY_LIMIT, DEFAULT_IP_DAILY_LIMIT),
    globalDaily: parse(env.BLOG_CHECK_GLOBAL_DAILY_LIMIT, DEFAULT_GLOBAL_DAILY_LIMIT),
  };
}

/** KST(UTC+9) 기준 날짜 키 (yyyy-mm-dd). */
export function kstDayKey(now: number = Date.now()): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: 'ip_limit' | 'global_limit' };

/**
 * 캡 검사 후 통과 시 카운터를 소비한다 (검사·소비 원자 — 단일 함수).
 * store 는 key(string)→count(number) Map. 지난 날짜 키는 정리한다.
 */
export function consumeBlogCheckQuota(
  store: Map<string, number>,
  input: { ip: string; now?: number; limits?: BlogCheckLimits },
): RateLimitDecision {
  const now = input.now ?? Date.now();
  const limits = input.limits ?? {
    ipDaily: DEFAULT_IP_DAILY_LIMIT,
    globalDaily: DEFAULT_GLOBAL_DAILY_LIMIT,
  };
  const day = kstDayKey(now);
  const ipKey = `ip:${day}:${input.ip || 'unknown'}`;
  const globalKey = `global:${day}`;

  // 지난 날짜 키 정리 (무한 성장 방지)
  const prefixIp = `ip:${day}:`;
  for (const key of store.keys()) {
    if (key === globalKey || key.startsWith(prefixIp)) continue;
    store.delete(key);
  }

  const ipCount = store.get(ipKey) ?? 0;
  const globalCount = store.get(globalKey) ?? 0;

  if (globalCount >= limits.globalDaily) return { allowed: false, reason: 'global_limit' };
  if (ipCount >= limits.ipDaily) return { allowed: false, reason: 'ip_limit' };

  store.set(ipKey, ipCount + 1);
  store.set(globalKey, globalCount + 1);
  return { allowed: true };
}

/** 요청 헤더에서 클라이언트 IP 를 추출 (x-forwarded-for 첫 값). 없으면 'unknown'. */
export function extractClientIp(headers: {
  get(name: string): string | null;
}): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first && first.length <= 64) return first;
  }
  const real = headers.get('x-real-ip');
  if (real && real.trim().length <= 64) return real.trim();
  return 'unknown';
}
