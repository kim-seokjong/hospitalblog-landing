import { normalizeClinicName, stripInstitutionSuffix } from './registry.ts';
import type { NaverSearchEnv } from './blog-discovery.ts';

/**
 * 보조 소스 — 네이버 지역검색(local.json).
 *
 * 쓰는 값은 **홈페이지 주소(link)** 하나다. 행안부 응답의 HMPG_ADDR 는 실측상
 * 전건 null 이라 홈페이지 주소를 얻을 다른 공식 경로가 없다.
 *
 * ⚠️ telephone 은 **항상 빈 값**이다(30건 실측). 전화번호 소스로 쓰지 말 것 —
 *    대표번호는 행안부 TELNO 를 쓴다.
 * ⚠️ 이름이 다른 병원의 홈페이지를 잘못 붙이면 진단 전체가 틀린 게 되므로,
 *    상호 정규화 일치를 확인한 항목만 채택한다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

const NAVER_LOCAL_SEARCH = 'https://openapi.naver.com/v1/search/local.json';

export const LOCAL_TIMEOUT_MS = 6_000;

export interface LocalPlace {
  readonly name: string;
  readonly category: string;
  readonly roadAddress: string;
  readonly address: string;
  /** 업체가 등록한 홈페이지 주소. 없으면 ''. */
  readonly link: string;
}

function stripMarkup(value: string): string {
  return (value ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
}

/** 네이버 local.json 응답 파싱 (순수 함수). */
export function parseLocalSearch(payload: unknown): readonly LocalPlace[] {
  if (!payload || typeof payload !== 'object') return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((it): it is Record<string, unknown> => Boolean(it) && typeof it === 'object')
    .map((it) => ({
      name: stripMarkup(String(it.title ?? '')),
      category: String(it.category ?? '').trim(),
      roadAddress: String(it.roadAddress ?? '').trim(),
      address: String(it.address ?? '').trim(),
      link: String(it.link ?? '').trim(),
    }));
}

/**
 * 후보 중 우리 병원과 동일하다고 볼 수 있는 항목을 고른다 (순수 함수).
 *
 * 채택 조건 (둘 다 만족):
 *   ① 상호 정규화 일치 — 완전 일치 또는 접미사 제거 일치
 *   ② 지역 힌트가 있으면 주소에 그 지역이 들어 있을 것
 * 하나라도 어긋나면 null — 애매하면 "확인하지 못했다"로 남긴다.
 */
export function pickMatchingPlace(
  places: readonly LocalPlace[],
  clinicName: string,
  regionHint: string,
): LocalPlace | null {
  const target = normalizeClinicName(clinicName);
  const stripped = normalizeClinicName(stripInstitutionSuffix(clinicName));
  const region = (regionHint ?? '').trim();
  if (target.length < 2) return null;

  for (const place of places) {
    const name = normalizeClinicName(place.name);
    const nameMatches =
      name === target ||
      (stripped.length >= 3 && normalizeClinicName(stripInstitutionSuffix(place.name)) === stripped);
    if (!nameMatches) continue;
    if (region) {
      const addr = `${place.roadAddress} ${place.address}`;
      if (!addr.includes(region)) continue;
    }
    return place;
  }
  return null;
}

export interface FindSiteOptions {
  readonly env?: NaverSearchEnv;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** 네이버 지역검색 1회. 실패·타임아웃은 null (절대 throw 안 함). */
export async function searchLocalPlaces(
  query: string,
  options: { env: NaverSearchEnv; fetchImpl: typeof fetch; timeoutMs?: number },
): Promise<readonly LocalPlace[] | null> {
  const clientId = options.env.NAVER_CLIENT_ID?.trim();
  const clientSecret = options.env.NAVER_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const trimmed = (query ?? '').trim();
  if (trimmed.length < 2 || trimmed.length > 60) return null;

  const params = new URLSearchParams({ query: trimmed, display: '5', sort: 'random' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? LOCAL_TIMEOUT_MS);
  try {
    const res = await options.fetchImpl(`${NAVER_LOCAL_SEARCH}?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });
    if (!res.ok) return null;
    return parseLocalSearch(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 병원 홈페이지 주소를 찾는다. 확신이 없으면 null — 남의 홈페이지를 붙이지 않는다.
 */
export async function findClinicSiteUrl(
  clinicName: string,
  regionHint: string,
  options: FindSiteOptions = {},
): Promise<string | null> {
  const env = options.env ?? (process.env as NaverSearchEnv);
  const fetchImpl = options.fetchImpl ?? fetch;
  const query = regionHint ? `${regionHint} ${clinicName}` : clinicName;
  const places = await searchLocalPlaces(query.slice(0, 60), { env, fetchImpl, timeoutMs: options.timeoutMs });
  if (!places) return null;
  const matched = pickMatchingPlace(places, clinicName, regionHint);
  return matched && matched.link ? matched.link : null;
}
