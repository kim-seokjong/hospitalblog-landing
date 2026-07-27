import {
  consumeBlogCheckQuota,
  joinOrStartSingleFlight,
  type BlogCheckLimits,
  type RateLimitDecision,
  type SingleFlightJoin,
} from '../blog-check-limits.ts';
import type { ClinicLookupOutcome } from './types.ts';

/**
 * 병원명 무료진단 — 캐시 키·실행 캡 (순수 로직).
 *
 * 무료 공개 엔드포인트라 남용되면 그대로 비용이 샌다. 방어는 3겹이다:
 *   ① 캐시   — 병원(관리번호) 단위 7일. 캐시 히트는 캡을 소비하지 않는다.
 *   ② 캡     — 진단은 IP당 일 3회 + 전체 일 100회 / 후보검색은 IP당 일 30회
 *   ③ single-flight — 같은 병원 동시 요청은 리더 1회만 실행(팔로워 무과금)
 *
 * 저장소는 blog-check 와 **분리된** Map 을 쓴다. 같은 Map 을 공유하면 한쪽
 * 사용량이 다른 쪽 캡을 잠식한다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

/**
 * 진단 실행 IP당 일일 기본 캡. env: CLINIC_DIAGNOSIS_IP_DAILY_LIMIT
 *
 * ★3회는 너무 낮았다 — 영업 담당자가 병원 몇 곳만 확인해도 바로 막혀서
 *   정작 우리가 못 쓰는 도구가 됐다. 실제 비용 방어선은 전체 캡(아래)이므로
 *   IP 캡은 "한 사람이 종일 돌리는 것"만 막으면 된다.
 */
export const DEFAULT_DIAGNOSIS_IP_LIMIT = 20;
/** 진단 실행 전체 일일 기본 캡. env: CLINIC_DIAGNOSIS_GLOBAL_DAILY_LIMIT */
export const DEFAULT_DIAGNOSIS_GLOBAL_LIMIT = 100;
/** 후보 검색 IP당 일일 기본 캡 (행안부 조회만이라 싸다). env: CLINIC_LOOKUP_IP_DAILY_LIMIT */
export const DEFAULT_LOOKUP_IP_LIMIT = 30;
/** 후보 검색 전체 일일 기본 캡. env: CLINIC_LOOKUP_GLOBAL_DAILY_LIMIT */
export const DEFAULT_LOOKUP_GLOBAL_LIMIT = 1_000;

/** 진단 결과 캐시 TTL — 7일 (blog-check 와 동일 정책). */
export const DIAGNOSIS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * 후보 검색 캐시 TTL — **찾은 결과만** 1일 (행안부 데이터는 일간 갱신).
 * 실패 결과에는 절대 쓰지 않는다 — lookupCacheTtlMs 참조.
 */
export const LOOKUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * "그 이름으로 못 찾았다"(not_found) 캐시 TTL — 5분.
 *
 * ★ 왜 1일에서 5분으로 내렸나 (2026-07-27 장애).
 *   행안부가 09:10~09:25Z 사이 정상 엔벨로프에 0건을 실어 보냈다. 그동안 자기 병원을
 *   검색한 원장은 not_found 를 받았고, 그 응답이 **24시간 캐시에 눌러앉아** 행안부가
 *   복구된 뒤에도 하루 종일 "등록된 병원을 찾지 못했어요"를 봤다. 홈페이지 첫 화면이
 *   이 검색이라 여기서 막히면 진단도 이메일도 전부 도달하지 못한다.
 *
 * 5분인 이유:
 *   · 장애 노출 상한이 곧 이 값이다. 실측 장애 구간이 약 15분이었으므로,
 *     이보다 짧아야 "장애가 끝나면 곧바로 정상"이 성립한다.
 *   · 0 (캐시 없음)으로 두지 않는 이유 — 오타를 고쳐 가며 연타하는 사용자가
 *     같은 문자열을 반복 제출하는 경우가 흔하고, 그때마다 행안부에 최대 3콜이 나간다.
 *     5분이면 그 연타는 흡수하면서 장애 잔상은 남기지 않는다.
 *   · 캐시 히트는 실행 캡을 소비하지 않으므로 캡 방어와는 무관하다.
 */
export const LOOKUP_NOT_FOUND_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * outcome 종류별 캐시 수명(ms). **0 이면 캐시하지 않는다.**
 *
 * 성공(찾은 결과)과 실패의 수명을 반드시 분리한다. 하나의 TTL 로 뭉뚱그리면
 * 외부 API 의 5분짜리 장애가 하루짜리 장애로 증폭된다.
 */
export function lookupCacheTtlMs(kind: ClinicLookupOutcome['kind']): number {
  switch (kind) {
    // 실제로 등록 자료를 받아 본 결과 — 행안부 데이터가 일간 갱신이므로 1일.
    case 'resolved':
    case 'ambiguous':
    case 'needs_region':
    case 'region_miss':
    case 'closed_only':
      return LOOKUP_CACHE_TTL_MS;
    // 정상 응답으로 0건 — 진짜 없을 수도, 행안부가 일시적으로 0건을 뿜는 중일 수도 있다.
    case 'not_found':
      return LOOKUP_NOT_FOUND_CACHE_TTL_MS;
    // 호출 자체가 실패·타임아웃·정체불명 — 아무것도 확인하지 못했으므로 캐시 금지.
    case 'unavailable':
      return 0;
    default: {
      // 새 종류가 생기면 컴파일이 깨진다 — 실패 결과가 조용히 장기 캐시되지 않도록.
      const exhaustive: never = kind;
      void exhaustive;
      return 0; // 모르는 종류는 캐시하지 않는다(안전한 쪽으로 넘어진다).
    }
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function readDiagnosisLimits(env: NodeJS.ProcessEnv = process.env): BlogCheckLimits {
  return {
    ipDaily: parsePositiveInt(env.CLINIC_DIAGNOSIS_IP_DAILY_LIMIT, DEFAULT_DIAGNOSIS_IP_LIMIT),
    globalDaily: parsePositiveInt(env.CLINIC_DIAGNOSIS_GLOBAL_DAILY_LIMIT, DEFAULT_DIAGNOSIS_GLOBAL_LIMIT),
  };
}

export function readLookupLimits(env: NodeJS.ProcessEnv = process.env): BlogCheckLimits {
  return {
    ipDaily: parsePositiveInt(env.CLINIC_LOOKUP_IP_DAILY_LIMIT, DEFAULT_LOOKUP_IP_LIMIT),
    globalDaily: parsePositiveInt(env.CLINIC_LOOKUP_GLOBAL_DAILY_LIMIT, DEFAULT_LOOKUP_GLOBAL_LIMIT),
  };
}

/**
 * 진단 캐시 키.
 *
 * 관리번호만으로는 부족하다 — 같은 병원이라도 사용자가 블로그·홈페이지를 직접
 * 지정하면 결과가 달라지므로 그 값들을 키에 포함한다. 그러지 않으면 A 사용자의
 * 자동 탐색 결과가 B 사용자의 직접 입력 결과를 덮어쓴다.
 * 붙여넣은 본문은 길이가 제각각이라 캐시하지 않는다(키에 'paste' 표시만).
 */
export function diagnosisCacheKey(input: {
  readonly mngNo: string;
  readonly blogId?: string | null;
  readonly siteUrl?: string | null;
  readonly hasPastedBody?: boolean;
}): string {
  const blog = (input.blogId ?? '').trim().toLowerCase();
  const site = (input.siteUrl ?? '').trim().toLowerCase();
  const paste = input.hasPastedBody ? 'paste' : '';
  return `clinicdx:${input.mngNo}|${blog}|${site}|${paste}`;
}

/** 후보 검색 캐시 키 — 이름·지역 정규화 후 조합. */
export function lookupCacheKey(name: string, region: string): string {
  const n = (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const r = (region ?? '').trim().toLowerCase();
  return `cliniclookup:${n}|${r}`;
}

/** 붙여넣은 본문이 있으면 캐시하지 않는다 — 매번 달라지는 입력을 캐시에 남길 이유가 없다. */
export function isCacheable(input: { readonly hasPastedBody?: boolean }): boolean {
  return !input.hasPastedBody;
}

/* ── 실행 캡 (blog-check-limits 재사용, 저장소만 분리) ──── */

const DIAGNOSIS_QUOTA_KEY = '__dp_clinic_dx_quota__';
const LOOKUP_QUOTA_KEY = '__dp_clinic_lookup_quota__';
const DIAGNOSIS_INFLIGHT_KEY = '__dp_clinic_dx_inflight__';
const SHARE_INFLIGHT_KEY = '__dp_clinic_dx_share_inflight__';

function getMap<T>(key: string): Map<string, T> {
  const g = globalThis as Record<string, unknown>;
  if (!(g[key] instanceof Map)) g[key] = new Map<string, T>();
  return g[key] as Map<string, T>;
}

export function getDiagnosisQuotaStore(): Map<string, number> {
  return getMap<number>(DIAGNOSIS_QUOTA_KEY);
}

export function getLookupQuotaStore(): Map<string, number> {
  return getMap<number>(LOOKUP_QUOTA_KEY);
}

export function getDiagnosisInflight<T>(): Map<string, Promise<T>> {
  return getMap<Promise<T>>(DIAGNOSIS_INFLIGHT_KEY);
}

/**
 * 공유 링크 발급 in-flight 저장소 — **리포트 행 중복 생성을 막는 유일한 수단**.
 *
 * ★ 진단 single-flight 는 리더 1명만 진단을 돌리게 하지만, 공유 링크 발급은 그
 *   바깥에 있었다. 같은 병원을 두 명이 동시에 진단하면 리더·팔로워가 각자
 *   `clinic_diagnosis_reports` 에 행을 만들어 **같은 진단에 토큰이 2개** 생겼다.
 *   "캐시된 토큰을 재사용하므로 행이 요청마다 늘지 않는다"는 주석은 **순차 요청에서만** 참이다.
 *   그래서 발급 자체를 캐시 키 단위로 한 번만 돌게 묶는다.
 */
export function getShareInflight<T>(): Map<string, Promise<T>> {
  return getMap<Promise<T>>(SHARE_INFLIGHT_KEY);
}

/**
 * 같은 키의 동시 호출을 하나로 묶는다 (캡 소비 없음).
 * joinOrStartSingleFlight 와 달리 **쿼터를 소비하지 않는다** — 공유 링크 발급은
 * 진단 캡 안에서 이미 허용된 요청의 부산물이라 별도 과금 대상이 아니다.
 */
export function shareOnce<T>(inflight: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = start().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export function consumeDiagnosisQuota(ip: string, env: NodeJS.ProcessEnv = process.env): RateLimitDecision {
  return consumeBlogCheckQuota(getDiagnosisQuotaStore(), { ip, limits: readDiagnosisLimits(env) });
}

export function consumeLookupQuota(ip: string, env: NodeJS.ProcessEnv = process.env): RateLimitDecision {
  return consumeBlogCheckQuota(getLookupQuotaStore(), { ip, limits: readLookupLimits(env) });
}

export { joinOrStartSingleFlight, type SingleFlightJoin };
export { extractClientIp } from '../blog-check-limits.ts';

/** 캡 초과 시 사용자에게 보여줄 문구. */
export function limitMessage(reason: 'ip_limit' | 'global_limit' | 'user_limit'): string {
  if (reason === 'global_limit') {
    return '오늘 무료 진단 사용량이 모두 소진됐어요. 내일 다시 시도해 주세요.';
  }
  // 캡 숫자를 문구에 박아두면 캡을 바꿀 때마다 어긋난다 → 숫자 없이 안내한다.
  return '오늘 이용 가능한 무료 진단 횟수를 다 쓰셨어요. 내일 다시 시도하거나 상담으로 문의해 주세요.';
}
