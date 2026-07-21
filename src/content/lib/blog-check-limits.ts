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
/** 회원당 상세분석 일일 기본 캡. env: BLOG_CHECK_USER_DAILY_LIMIT */
export const DEFAULT_USER_DAILY_LIMIT = 5;

export interface BlogCheckLimits {
  ipDaily: number;
  globalDaily: number;
}

/** 양의 정수 env 파싱 — 비정상 값은 기본값 (절대 throw 안 함). */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** env 에서 캡을 읽는다. 비정상 값은 기본값 (절대 throw 안 함). */
export function readBlogCheckLimits(env: NodeJS.ProcessEnv = process.env): BlogCheckLimits {
  return {
    ipDaily: parsePositiveInt(env.BLOG_CHECK_IP_DAILY_LIMIT, DEFAULT_IP_DAILY_LIMIT),
    globalDaily: parsePositiveInt(env.BLOG_CHECK_GLOBAL_DAILY_LIMIT, DEFAULT_GLOBAL_DAILY_LIMIT),
  };
}

/** 회원당 상세분석 일일 캡을 읽는다 (env BLOG_CHECK_USER_DAILY_LIMIT, 기본 5). */
export function readUserDailyLimit(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInt(env.BLOG_CHECK_USER_DAILY_LIMIT, DEFAULT_USER_DAILY_LIMIT);
}

/** KST(UTC+9) 기준 날짜 키 (yyyy-mm-dd). */
export function kstDayKey(now: number = Date.now()): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * KST 기준 "오늘"의 UTC 경계 [startIso, endIso) — DB(run_at, timestamptz) 일일
 * 카운트 판정용. 예: KST 2026-07-21 은 UTC 2026-07-20T15:00Z ~ 07-21T15:00Z.
 */
export function kstDayRangeUtc(now: number = Date.now()): { startIso: string; endIso: string } {
  const day = kstDayKey(now);
  const start = Date.parse(`${day}T00:00:00+09:00`);
  return {
    startIso: new Date(start).toISOString(),
    endIso: new Date(start + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: 'ip_limit' | 'global_limit' | 'user_limit' };

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

/**
 * 회원당 상세분석 캡 검사 후 통과 시 소비 (인메모리 폴백 경로).
 *
 * 기본 판정은 라우트에서 blog_check_reports 의 오늘(KST) 카운트로 하고,
 * 테이블 미적용(마이그 045 전) 환경에서만 이 인메모리 카운터를 쓴다.
 * store 는 consumeBlogCheckQuota 와 별도 Map 이어야 한다(정리 규칙이 다름).
 */
export function consumeUserQuota(
  store: Map<string, number>,
  input: { userId: string; now?: number; limit: number },
): RateLimitDecision {
  const now = input.now ?? Date.now();
  const day = kstDayKey(now);
  const key = `user:${day}:${input.userId}`;

  // 지난 날짜 키 정리 (무한 성장 방지)
  const prefix = `user:${day}:`;
  for (const k of store.keys()) {
    if (!k.startsWith(prefix)) store.delete(k);
  }

  const count = store.get(key) ?? 0;
  if (count >= input.limit) return { allowed: false, reason: 'user_limit' };
  store.set(key, count + 1);
  return { allowed: true };
}

/**
 * 요청 헤더에서 클라이언트 IP 를 추출한다. 없으면 'unknown'.
 *
 * 신뢰 순서 (Vercel 배포 기준):
 * 1) x-real-ip — Vercel 플랫폼이 엣지에서 실제 접속 IP 로 "덮어써서" 설정한다.
 *    클라이언트가 보낸 동명 헤더는 플랫폼 값으로 대체되므로 위조 불가.
 * 2) x-vercel-forwarded-for — 역시 Vercel 이 설정하는 플랫폼 헤더.
 * 3) x-forwarded-for 첫 값 — 클라이언트가 임의 값을 앞에 끼워 넣을 수 있어
 *    위조 가능. 플랫폼 헤더가 전혀 없는 환경(로컬 등)의 마지막 수단으로만 쓴다.
 */
export function extractClientIp(headers: {
  get(name: string): string | null;
}): string {
  const real = headers.get('x-real-ip');
  if (real && real.trim() && real.trim().length <= 64) return real.trim();

  const vercel = headers.get('x-vercel-forwarded-for');
  if (vercel) {
    const first = vercel.split(',')[0]?.trim();
    if (first && first.length <= 64) return first;
  }

  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first && first.length <= 64) return first;
  }
  return 'unknown';
}
