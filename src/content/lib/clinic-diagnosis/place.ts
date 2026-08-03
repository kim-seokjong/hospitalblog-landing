/**
 * 네이버 플레이스 축 — 등록 상태 · 등록 키워드 · 지역 3단계 노출 순위.
 *
 * ★ 왜 필요한가.
 *   병원은 지역 장사다. "범어동 치과"를 검색한 사람은 오늘 갈 병원을 찾는 사람이라
 *   플레이스 노출이 블로그보다 내원에 더 직접 연결된다. 그런데 원장 대부분은
 *   플레이스를 "등록해 둔 것" 으로만 알고 **지금 몇 번째로 보이는지는 모른다.**
 *
 * ★ 지역 3단계(동 → 구 → 시)로 넓히는 이유.
 *   단일 순위 하나는 정보가 아니다. 낙차가 정보다 — "범어동에선 2위인데 수성구로
 *   넓히면 첫 화면에 없다" 가 원장이 실제로 느끼는 문제다. 게다가 쿼리에 지역명을
 *   박으면 검색자 위치에 따른 개인화 영향이 줄어 **순위가 재현된다**(플레이스 순위는
 *   보통 GPS 위치에 좌우돼 서버에서 뽑은 값이 실제와 어긋난다).
 *
 * ⚠️ **상위 5개까지만 볼 수 있다.** 서버 렌더 HTML 에 실리는 플레이스가 5건이고,
 *    `start` 파라미터는 무시된다(2026-08-03 실측). 그래서 "27위" 같은 숫자는 못 낸다.
 *    대신 **"환자가 첫 화면에서 보는 범위에 있는가"** 로 말한다 — 이게 더 정직하고,
 *    사실 원장에게 더 중요한 질문이다. 5위 밖은 `outside_top` 으로 명시하며,
 *    **"미확인"과 절대 뭉개지 않는다**(그 구분이 이 진단의 신뢰다).
 *
 * ⚠️ 경쟁 병원 이름은 리포트에 싣지 않는다. 회사 규칙상 타 병원 비교·비방 광고가
 *    금지되고, "1위 OO치과 대비" 는 그 선에 걸린다. 우리 병원 위치만 말한다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

import { normalizeClinicName, stripInstitutionSuffix } from './registry.ts';

/** 서버 렌더 HTML 이 실어 주는 플레이스 개수 — 이 값이 우리가 볼 수 있는 전부다. */
export const PLACE_TOP_N = 5;

/** 등록 키워드 중 순위를 재 볼 최대 개수 (업종 1개는 별도로 항상 본다). */
export const MAX_PLACE_KEYWORDS = 2;

export const PLACE_TIMEOUT_MS = 7_000;

const PLACE_SEARCH = 'https://m.search.naver.com/search.naver';
const PLACE_DETAIL = 'https://m.place.naver.com/hospital';

/** 모바일 검색 결과를 받기 위한 UA — 데스크톱 UA 로는 플레이스 블록 구조가 다르다. */
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/* ── 파싱 (순수) ─────────────────────────────────────────── */

export interface PlaceListing {
  readonly id: string;
  readonly name: string;
}

/**
 * 검색 결과 HTML → **노출 순서대로** 병원 목록.
 *
 * 순서는 문서에 링크가 등장하는 차례에서 나온다(실측 검증). 이름은 같은 문서의
 * `__APOLLO_STATE__` 안 `HospitalSummary:<id>` 에서 끌어온다 — 링크 주변 마크업은
 * React 컴포넌트라 구조가 자주 바뀌지만 이 상태 객체는 안정적이다.
 */
export function parsePlaceListings(html: string): readonly PlaceListing[] {
  if (!html) return [];

  /**
   * ⚠️ 이름을 담는 상태 객체의 **타입 이름이 화면마다 다르다**(2026-08-03 실측).
   *    업종+지역 검색은 `HospitalSummary:<id>`, 상호 단독 검색은
   *    `PlaceListBusinessesItem:<id>` 였다. 타입을 고정하면 한쪽 경로가 조용히
   *    빈 이름이 되고, 그러면 **자기 병원을 못 찾아 "미등록"으로 보고**한다.
   *    그래서 타입은 묶지 않고 `<무엇이든>:<숫자 id>` 형태만 본다.
   */
  const names = new Map<string, string>();
  const nameRe = /"[A-Za-z]+:(\d+)":\{[^{}]*?"name":"([^"]*)"/g;
  for (let m = nameRe.exec(html); m; m = nameRe.exec(html)) {
    if (!names.has(m[1])) names.set(m[1], cleanPlaceName(m[2]));
  }

  const seen = new Set<string>();
  const out: PlaceListing[] = [];
  // 경로 세그먼트도 화면마다 다르다 — /hospital/ 과 /place/ 를 모두 받는다.
  const linkRe = /place\.naver\.com\/(?:hospital|place)\/(\d+)/g;
  for (let m = linkRe.exec(html); m; m = linkRe.exec(html)) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: names.get(id) ?? '' });
    if (out.length >= PLACE_TOP_N) break;
  }
  return out;
}

/** JSON 문자열 이스케이프(\uXXXX 등)를 되돌린다. 실패하면 원문 그대로. */
function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw.replace(/(?<!\\)"/g, '\\"')}"`) as string;
  } catch {
    return raw;
  }
}

/**
 * 표시용 이름 정리 — 검색어 강조 마크업(`<mark>`)을 걷어낸다.
 *
 * 이게 남으면 이름 비교가 전부 어긋나 **자기 병원을 못 찾는다**(상호 단독 검색
 * 응답이 실제로 `<mark>서울베리굿치과의원</mark>` 였다).
 */
function cleanPlaceName(raw: string): string {
  return decodeJsonString(raw)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .trim();
}

export interface PlaceProfile {
  /** 플레이스 업종 (예: '치과'). 없으면 ''. */
  readonly category: string;
  /** 업주가 스마트플레이스에 **직접 등록한** 키워드. */
  readonly keywords: readonly string[];
}

/**
 * 플레이스 상세 HTML → 업종 + 등록 키워드.
 *
 * ★ 등록 키워드를 쓰는 이유(대표 지시 2026-08-03): 우리 키워드 엔진이 뽑은 것보다
 *   **그 병원이 실제로 내건 항목**이 설득력이 있다. "임플란트를 걸어 두셨는데
 *   범어동 임플란트로는 첫 화면에 안 보입니다" 는 반박이 안 된다.
 */
export function parsePlaceProfile(html: string): PlaceProfile {
  if (!html) return { category: '', keywords: [] };
  const category = /"category":"([^"]{1,40})"/.exec(html)?.[1] ?? '';
  const listRaw = /"keywordList":\[([^\]]*)\]/.exec(html)?.[1] ?? '';
  const keywords = listRaw
    ? listRaw
        .split(',')
        .map((s) => decodeJsonString(s.trim().replace(/^"|"$/g, '')))
        .filter(Boolean)
    : [];
  return { category: decodeJsonString(category), keywords };
}

/* ── 지역 3단계 ──────────────────────────────────────────── */

export type PlaceScopeKind = 'dong' | 'gu' | 'city';

export interface PlaceScope {
  readonly kind: PlaceScopeKind;
  /** 검색어에 쓸 지역 토큰 (예: '범어동'). */
  readonly region: string;
}

/**
 * 지번주소에서 동·리를 뽑는다.
 *
 * 도로명주소에는 동이 없다(예: '대구광역시 수성구 동대구로 123'). 지번주소를 써야 한다.
 * '산123' 같은 번지 조각이나 '동구'처럼 **구 이름에 붙은 동**을 잘못 집지 않도록,
 * 2글자 이상이고 뒤에 번지가 오는 형태만 인정한다.
 */
export function extractDong(lotAddress: string): string {
  const addr = (lotAddress ?? '').trim();
  if (!addr) return '';
  const m = /(?:^|\s)([가-힣]{2,10}(?:\d+)?[동리])(?=\s|$)/u.exec(addr);
  if (!m) return '';
  const token = m[1];
  // '읍/면' 단위가 함께 있는 주소에서 '리'만 집으면 지역이 너무 좁다 — 그대로 둔다.
  return token;
}

/**
 * 동 → 구 → 시 3단계. 값이 없거나 앞 단계와 같으면 건너뛴다(같은 검색을 두 번 하지 않는다).
 */
export function buildPlaceScopes(input: {
  readonly lotAddress: string;
  readonly region: string;
  readonly shortProvince: string;
}): readonly PlaceScope[] {
  const out: PlaceScope[] = [];
  const push = (kind: PlaceScopeKind, region: string) => {
    const value = (region ?? '').trim();
    if (!value) return;
    if (out.some((s) => s.region === value)) return;
    out.push({ kind, region: value });
  };
  push('dong', extractDong(input.lotAddress));
  push('gu', input.region);
  push('city', input.shortProvince);
  return out;
}

/* ── 키워드 정제 ─────────────────────────────────────────── */

/**
 * 등록 키워드에서 **지역명이 이미 박힌 것**을 걸러낸다.
 *
 * 업주는 '수성구범어동치과' 처럼 지역을 넣어 등록하는 일이 흔한데, 여기에 다시
 * 지역을 붙이면 '범어동 수성구범어동치과' 같은 아무도 검색하지 않는 말이 된다.
 * 지역 토큰을 떼고 남은 것이 업종과 같아지면 중복이므로 버린다.
 */
export function sanitizePlaceKeywords(
  keywords: readonly string[],
  regionTokens: readonly string[],
  category: string,
): readonly string[] {
  const cat = (category ?? '').trim();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    let value = (raw ?? '').replace(/\s+/g, '').trim();
    if (!value) continue;
    for (const token of regionTokens) {
      if (token) value = value.split(token).join('');
    }
    if (value.length < 2 || value.length > 20) continue;
    if (cat && value === cat) continue; // 업종과 중복 — 업종은 따로 본다
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/* ── 순위 판정 ───────────────────────────────────────────── */

export type PlaceRankState = 'ranked' | 'outside_top' | 'unchecked';

export interface PlaceRank {
  readonly keyword: string;
  readonly scope: PlaceScopeKind;
  readonly region: string;
  /** 실제로 검색한 문자열 — 원장이 직접 쳐 보고 검증할 수 있어야 한다. */
  readonly query: string;
  readonly state: PlaceRankState;
  /** 1~PLACE_TOP_N. outside_top·unchecked 면 null. */
  readonly rank: number | null;
}

/**
 * 목록에서 우리 병원의 자리를 찾는다.
 *
 * 이름은 정규화 후 완전 일치 또는 기관 접미사(의원/치과의원 등)를 뗀 일치만 인정한다 —
 * 부분 일치를 허용하면 '라온치과'가 '라온미소치과'로 잡혀 **엉뚱한 순위**를 보고하게 된다.
 */
export function findClinicRank(
  listings: readonly PlaceListing[],
  clinicName: string,
): number | null {
  const target = normalizeClinicName(clinicName);
  const stripped = normalizeClinicName(stripInstitutionSuffix(clinicName));
  if (target.length < 2) return null;
  for (let i = 0; i < listings.length; i += 1) {
    const name = normalizeClinicName(listings[i].name);
    if (!name) continue;
    if (name === target) return i + 1;
    if (
      stripped.length >= 3 &&
      normalizeClinicName(stripInstitutionSuffix(listings[i].name)) === stripped
    ) {
      return i + 1;
    }
  }
  return null;
}

/* ── 조회 (never throws) ─────────────────────────────────── */

export interface PlaceFetchOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

async function getText(url: string, options: PlaceFetchOptions): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? PLACE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'User-Agent': MOBILE_UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function placeSearchUrl(query: string): string {
  const params = new URLSearchParams({ where: 'm_place', query });
  return `${PLACE_SEARCH}?${params.toString()}`;
}

export function placeDetailUrl(placeId: string): string {
  return `${PLACE_DETAIL}/${encodeURIComponent(placeId)}/home`;
}

/** 검색 1회 → 노출 순서. 실패하면 null(빈 배열과 구분한다). */
export async function fetchPlaceListings(
  query: string,
  options: PlaceFetchOptions = {},
): Promise<readonly PlaceListing[] | null> {
  const trimmed = (query ?? '').trim();
  if (trimmed.length < 2 || trimmed.length > 60) return null;
  const html = await getText(placeSearchUrl(trimmed), options);
  if (html === null) return null;
  return parsePlaceListings(html);
}

/** 상세 1회 → 업종·등록 키워드. 실패하면 null. */
export async function fetchPlaceProfile(
  placeId: string,
  options: PlaceFetchOptions = {},
): Promise<PlaceProfile | null> {
  if (!/^\d{1,20}$/.test(placeId ?? '')) return null;
  const html = await getText(placeDetailUrl(placeId), options);
  if (html === null) return null;
  return parsePlaceProfile(html);
}

/* ── 축 측정 ─────────────────────────────────────────────── */

/** 순위 조회 동시 실행 수 — 남의 서버를 두드리는 일이라 낮게 잡는다. */
const RANK_CONCURRENCY = 3;
/** 축 전체 예산(ms). 넘으면 남은 조합은 `unchecked` 로 남기고 끝낸다. */
export const PLACE_DEADLINE_MS = 20_000;

export interface MeasurePlaceInput {
  readonly clinicName: string;
  readonly lotAddress: string;
  readonly region: string;
  readonly shortProvince: string;
}

export interface PlaceAxisResult {
  readonly checked: boolean;
  readonly presence: 'found' | 'not_found' | 'unknown';
  readonly placeId: string | null;
  readonly placeName: string | null;
  readonly category: string | null;
  readonly registeredKeywords: readonly string[];
  readonly measuredKeywords: readonly string[];
  readonly ranks: readonly PlaceRank[];
  readonly rankChecked: boolean;
  readonly topN: number;
}

export const EMPTY_PLACE_RESULT: PlaceAxisResult = {
  checked: false,
  presence: 'unknown',
  placeId: null,
  placeName: null,
  category: null,
  registeredKeywords: [],
  measuredKeywords: [],
  ranks: [],
  rankChecked: false,
  topN: PLACE_TOP_N,
};

/** 병원명으로 플레이스를 특정한다. 이름이 확실히 일치할 때만 채택한다. */
async function resolvePlace(
  input: MeasurePlaceInput,
  options: PlaceFetchOptions,
): Promise<{ listing: PlaceListing | null; reachable: boolean }> {
  /**
   * 상호 단독 질의를 먼저 한다 — 지역을 앞에 붙이면 오히려 안 잡히는 경우가 있다
   * (naver-local.ts 에서 실측된 것과 같은 성질). 못 찾으면 지역을 붙여 한 번 더 본다.
   */
  const queries = [input.clinicName, `${input.region} ${input.clinicName}`.trim()];
  let reachable = false;
  for (const query of queries) {
    const listings = await fetchPlaceListings(query, options);
    if (listings === null) continue;
    reachable = true;
    const rank = findClinicRank(listings, input.clinicName);
    if (rank !== null) return { listing: listings[rank - 1], reachable };
  }
  return { listing: null, reachable };
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * 플레이스 축 1건 측정. **절대 throw 하지 않는다** — 다른 축과 같은 규칙이다.
 *
 * ⚠️ 여기서 던지면 나머지 축을 다 측정해 놓고 진단 전체가 실패한다. 2026-07-27 에
 *    조회 하나가 죽어서 첫 화면이 통째로 멈춘 적이 있다.
 */
export async function measurePlace(
  input: MeasurePlaceInput,
  options: PlaceFetchOptions & { readonly now?: number; readonly deadlineMs?: number } = {},
): Promise<PlaceAxisResult> {
  const startedAt = options.now ?? Date.now();
  const deadline = startedAt + (options.deadlineMs ?? PLACE_DEADLINE_MS);
  const outOfTime = () => Date.now() > deadline;

  const { listing, reachable } = await resolvePlace(input, options);
  if (!listing) {
    return {
      ...EMPTY_PLACE_RESULT,
      checked: reachable,
      presence: reachable ? 'not_found' : 'unknown',
    };
  }

  const profile = (await fetchPlaceProfile(listing.id, options)) ?? { category: '', keywords: [] };
  const scopes = buildPlaceScopes(input);
  const regionTokens = scopes.map((s) => s.region);
  const cleaned = sanitizePlaceKeywords(profile.keywords, regionTokens, profile.category);

  /**
   * 업종은 **항상** 본다 — "범어동 치과" 는 환자가 가장 많이 치는 말이고,
   * 등록 키워드가 하나도 없는 병원에서도 이 한 줄은 나와야 한다.
   */
  const measured = [profile.category, ...cleaned.slice(0, MAX_PLACE_KEYWORDS)].filter(
    (k) => k && k.length >= 2,
  );

  const combos = scopes.flatMap((scope) =>
    measured.map((keyword) => ({ scope, keyword, query: `${scope.region} ${keyword}` })),
  );

  const ranks = await runWithConcurrency(combos, RANK_CONCURRENCY, async (combo): Promise<PlaceRank> => {
    const base = {
      keyword: combo.keyword,
      scope: combo.scope.kind,
      region: combo.scope.region,
      query: combo.query,
    } as const;
    if (outOfTime()) return { ...base, state: 'unchecked', rank: null };
    const listings = await fetchPlaceListings(combo.query, options);
    if (listings === null) return { ...base, state: 'unchecked', rank: null };
    const rank = findClinicRank(listings, input.clinicName);
    return rank === null
      ? { ...base, state: 'outside_top', rank: null }
      : { ...base, state: 'ranked', rank };
  });

  return {
    checked: true,
    presence: 'found',
    placeId: listing.id,
    placeName: listing.name || null,
    category: profile.category || null,
    registeredKeywords: profile.keywords,
    measuredKeywords: measured,
    ranks,
    rankChecked: ranks.some((r) => r.state !== 'unchecked'),
    topN: PLACE_TOP_N,
  };
}
