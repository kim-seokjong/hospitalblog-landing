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
 *
 * 질의 순서가 중요하다(실측):
 *   "중구 브이비성형외과의원" → 결과 0건
 *   "브이비성형외과의원"      → 1건 (vb.vbeauty.co.kr)
 * 지역을 앞에 붙이면 오히려 안 잡히는 경우가 있어 **상호 단독 질의를 먼저** 한다.
 * 그래도 못 찾으면 지역을 붙여 한 번 더 본다(동명 병원이 많아 상호 단독으로는
 * 다른 지역 병원만 올라오는 경우 대비). 지역 일치 검증은 두 경로 모두에 적용되므로
 * 순서를 바꿔도 "다른 지역 병원의 홈페이지를 붙이는" 일은 생기지 않는다.
 */
/**
 * 지역검색이 준 대표 링크의 **종류**.
 *
 * ⛔2026-09-09 실측: 표본 8곳 중 **3곳의 대표 링크가 홈페이지가 아니었다.**
 *     글로미의원      → instagram.com/glowme_clinic
 *     아산더본의원    → blog.naver.com/asan_thebone
 *     연센트럴치과의원 → blog.naver.com/hellodentkim1
 *   그런데 진단은 종류를 안 보고 이걸 **홈페이지로 재고 점수까지 매겼다.**
 *   인스타 페이지에 대고 "검색·AI가 읽을 6가지 중 2가지" 라고 말한 셈이다.
 *
 * ★「못 봤다」와 「잘못 봤다」는 다르다. 뒤쪽이 훨씬 나쁘다 — 원장이 화면을 보고
 *   "이건 우리 홈페이지가 아닌데" 하는 순간 진단 전체의 신뢰가 없어진다.
 */
export type LocalLinkKind = 'site' | 'blog' | 'social' | 'none';

/** 대표 링크가 홈페이지인가, 블로그인가, SNS 인가 (순수 함수). */
export function classifyLocalLink(rawUrl: string): LocalLinkKind {
  const url = (rawUrl ?? '').trim().toLowerCase();
  if (!url) return 'none';
  const host = url.replace(/^https?:\/\//, '').split(/[/?#]/)[0] ?? '';
  if (!host || !host.includes('.')) return 'none';
  if (/(^|\.)blog\.naver\.com$|(^|\.)blog\.me$|(^|\.)tistory\.com$|(^|\.)brunch\.co\.kr$|(^|\.)post\.naver\.com$/.test(host)) {
    return 'blog';
  }
  if (/(^|\.)instagram\.com$|(^|\.)facebook\.com$|(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)cafe\.naver\.com$|(^|\.)pf\.kakao\.com$|(^|\.)band\.us$|(^|\.)x\.com$|(^|\.)twitter\.com$/.test(host)) {
    return 'social';
  }
  // ⚠️modoo.at·네이버 스마트스토어 같은 「네이버가 만들어 주는 페이지」는 홈페이지로 본다.
  //   병원이 그걸 홈페이지로 쓰고 있으면 실제로 그게 홈페이지다.
  return 'site';
}

export interface ClinicLocalLink {
  readonly url: string;
  readonly kind: LocalLinkKind;
}

/**
 * 병원 대표 링크를 찾는다 — **종류까지 함께** 돌려준다.
 *
 * 질의 순서가 중요하다(실측):
 *   "중구 브이비성형외과의원" → 결과 0건
 *   "브이비성형외과의원"      → 1건 (vb.vbeauty.co.kr)
 */
export async function findClinicLocalLink(
  clinicName: string,
  regionHint: string,
  options: FindSiteOptions = {},
): Promise<ClinicLocalLink | null> {
  const env = options.env ?? (process.env as NaverSearchEnv);
  const fetchImpl = options.fetchImpl ?? fetch;

  const queries = regionHint ? [clinicName, `${regionHint} ${clinicName}`] : [clinicName];
  for (const query of queries) {
    const places = await searchLocalPlaces(query.slice(0, 60), { env, fetchImpl, timeoutMs: options.timeoutMs });
    if (!places || places.length === 0) continue;
    const matched = pickMatchingPlace(places, clinicName, regionHint);
    if (matched?.link) return { url: matched.link, kind: classifyLocalLink(matched.link) };
  }
  return null;
}

/**
 * 병원 **홈페이지** 주소만 돌려준다. 블로그·SNS 면 null 이다.
 *
 * ⚠️이 함수는 예전 이름을 그대로 두되 **동작이 바뀌었다**(2026-09-09).
 *   버려진 블로그·SNS 주소는 호출부가 `findClinicLocalLink` 로 따로 받아
 *   블로그·소셜 축의 근거로 돌려 쓴다 — 정보를 버리지 않는다.
 */
export async function findClinicSiteUrl(
  clinicName: string,
  regionHint: string,
  options: FindSiteOptions = {},
): Promise<string | null> {
  const found = await findClinicLocalLink(clinicName, regionHint, options);
  return found && found.kind === 'site' ? found.url : null;
}
