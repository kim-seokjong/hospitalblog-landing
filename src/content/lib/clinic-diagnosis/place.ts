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
import { fetchKeywordVolumes, normalizeKeyword } from '../keyword-volume.ts';

/** 서버 렌더 HTML 이 실어 주는 플레이스 개수 — 이 값이 우리가 볼 수 있는 전부다. */
export const PLACE_TOP_N = 5;

/** 등록 키워드 중 순위를 재 볼 최대 개수 (업종 1개는 별도로 항상 본다). */
export const MAX_PLACE_KEYWORDS = 2;

/**
 * 순위를 재 볼 최소 월 검색량 (전국, PC+모바일).
 *
 * ★ 왜 필요한가 (2026-08-04 실측).
 *   등록 키워드를 그대로 쓰면 `레진빌드업충치치료` 같은 롱테일이 섞이는데, 이런 말은
 *   **동·구·시 세 단계 모두 1위**로 나온다. 경쟁이 없으니 당연하고, 그 1위는 성과가
 *   아니다. 걸러내지 않으면 리포트가 "잘하고 있다" 는 착시를 만든다.
 *
 * 30 인 이유: 네이버는 10 미만을 `< 10` 으로만 주고 우리 파서가 5로 읽는다(추정치).
 * 그 언저리는 사실상 0 이므로, 추정 구간을 확실히 넘는 값에서 끊는다. 지역을 붙이면
 * 실제 검색량은 더 줄지만, 여기서 거르려는 것은 **아무도 안 쓰는 말**이지
 * "지역 조합의 검색량" 이 아니다.
 */
export const MIN_PLACE_KEYWORD_VOLUME = 30;

/** 순위를 잴 키워드 하나 — 검색량을 함께 들고 다닌다. */
export interface PlaceKeywordPick {
  readonly keyword: string;
  readonly volume: number | null;
  readonly anchor: boolean;
}

/**
 * 검색량으로 잴 키워드를 고른다 (순수 함수).
 *
 * ⚠️ 업종은 **검색량과 무관하게 항상** 남긴다. "범어동 치과" 는 환자가 가장 많이 치는
 *    말이고, 등록 키워드가 하나도 없는 병원에서도 이 한 줄은 나와야 한다.
 * ⚠️ 검색량을 못 구했으면(`volumes` 비어 있음) **거르지 않는다.** 조회 실패를 이유로
 *    멀쩡한 키워드를 버리면, 키가 잠깐 죽은 날 리포트가 통째로 빈약해진다.
 */
export function selectPlaceKeywords(
  category: string,
  candidates: readonly string[],
  volumes: Readonly<Record<string, { total: number }>>,
  volumeChecked: boolean,
  limit: number = MAX_PLACE_KEYWORDS,
): {
  readonly measured: readonly PlaceKeywordPick[];
  /** 검색량이 바닥이라 뺀 것 — "이 말은 의미가 없다" 고 말할 수 있는 것. */
  readonly lowVolume: readonly PlaceKeywordPick[];
  /**
   * 검색량은 충분한데 **측정 상한에 밀린** 것.
   * ⚠️ 이걸 lowVolume 과 합치면 "검색량이 거의 없다" 는 **거짓말**이 된다.
   */
  readonly overLimit: readonly PlaceKeywordPick[];
} {
  const lookup = new Map<string, number>();
  for (const [kw, v] of Object.entries(volumes ?? {})) {
    lookup.set(normalizeKeyword(kw), v?.total ?? 0);
  }
  const volumeOf = (kw: string): number | null => {
    const hit = lookup.get(normalizeKeyword(kw));
    return hit === undefined ? null : hit;
  };

  const measured: PlaceKeywordPick[] = [];
  const cat = (category ?? '').trim();
  if (cat) measured.push({ keyword: cat, volume: volumeOf(cat), anchor: true });

  const scored = candidates.map((keyword) => ({ keyword, volume: volumeOf(keyword), anchor: false }));

  if (!volumeChecked) {
    // 검색량을 못 봤다 — 등록 순서대로 앞에서 자른다(기존 동작).
    return {
      measured: [...measured, ...scored.slice(0, limit)],
      lowVolume: [],
      overLimit: scored.slice(limit),
    };
  }

  /**
   * ⚠️ `volume === null` 은 **검색량이 낮은 것이 아니라 모르는 것**이다
   *    (2026-08-04 지적). 응답에 그 키워드 행이 빠지는 경우가 있는데, 이걸 0 으로
   *    읽어 "거의 검색되지 않는다" 고 보고하면 **없는 사실을 말하는 것**이다.
   *    모르는 것은 거르지 않고 뒤로 미룰 뿐이다.
   */
  const known = scored.filter((s) => s.volume !== null);
  const unknown = scored.filter((s) => s.volume === null);

  const passed = known
    .filter((s) => (s.volume as number) >= MIN_PLACE_KEYWORD_VOLUME)
    .sort((a, b) => (b.volume as number) - (a.volume as number));
  const lowVolume = known.filter((s) => (s.volume as number) < MIN_PLACE_KEYWORD_VOLUME);

  // 검색량을 아는 것부터, 그다음 모르는 것 — 모른다고 버리지는 않는다.
  const ranked = [...passed, ...unknown];

  return {
    measured: [...measured, ...ranked.slice(0, limit)],
    lowVolume,
    overLimit: ranked.slice(limit),
  };
}

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
  /**
   * 표시용 주소 (예: '대구 수성구 범어동'). 없으면 ''.
   *
   * ⚠️ 이름만으로 병원을 고르면 **다른 지역의 동명 병원**을 자기 병원으로 확정한다.
   *    실측에서 '서울베리굿치과의원' 을 검색하니 서울 서대문구 '베리굿치과의원' 이
   *    같은 목록에 올라왔다. 주소는 그걸 가르는 유일한 단서다.
   */
  readonly address: string;
}

/**
 * `"타입:id":{...}` 블록을 id 별로 모은다.
 *
 * 이름과 주소가 **서로 다른 상태 객체**에 흩어져 있는 화면이 있어(같은 id 로 여러 개)
 * 조각을 이어 붙인 뒤 필드를 찾는다.
 */
function sliceEntityBlobs(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const keyRe = /"[A-Za-z]+:(\d+)":\{/g;
  for (let m = keyRe.exec(html); m; m = keyRe.exec(html)) {
    const id = m[1];
    const start = m.index + m[0].length;
    const blob = html.slice(start, start + 1200);
    out.set(id, (out.get(id) ?? '') + blob);
  }
  return out;
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
  const blobs = sliceEntityBlobs(html);
  const fieldOf = (id: string, keys: readonly string[]): string => {
    const blob = blobs.get(id);
    if (!blob) return '';
    for (const key of keys) {
      const m = new RegExp(`"${key}":"([^"]*)"`).exec(blob);
      if (m && m[1]) return cleanPlaceName(m[1]);
    }
    return '';
  };

  const seen = new Set<string>();
  const out: PlaceListing[] = [];
  // 경로 세그먼트도 화면마다 다르다 — /hospital/ 과 /place/ 를 모두 받는다.
  const linkRe = /place\.naver\.com\/(?:hospital|place)\/(\d+)/g;
  for (let m = linkRe.exec(html); m; m = linkRe.exec(html)) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: fieldOf(id, ['name']),
      address: fieldOf(id, ['commonAddress', 'fullAddress', 'roadAddress', 'address']),
    });
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
  /**
   * `keywordList` **필드 자체를 찾았는가.**
   *
   * ⚠️ "등록 키워드가 빈 배열" 과 "필드 구조가 바뀌어 못 읽음" 은 완전히 다르다.
   *    둘을 뭉치면 마크업이 바뀐 날 **등록해 둔 원장에게 "등록 안 하셨다"** 고 말한다.
   */
  readonly keywordFieldFound: boolean;
  /** 업종 필드를 찾았는가 — 상세 파싱이 통째로 깨졌는지 판정하는 데 쓴다. */
  readonly categoryFieldFound: boolean;
}

/**
 * 플레이스 상세 HTML → 업종 + 등록 키워드.
 *
 * ★ 등록 키워드를 쓰는 이유(대표 지시 2026-08-03): 우리 키워드 엔진이 뽑은 것보다
 *   **그 병원이 실제로 내건 항목**이 설득력이 있다. "임플란트를 걸어 두셨는데
 *   범어동 임플란트로는 첫 화면에 안 보입니다" 는 반박이 안 된다.
 */
export function parsePlaceProfile(html: string): PlaceProfile {
  if (!html) {
    return { category: '', keywords: [], keywordFieldFound: false, categoryFieldFound: false };
  }
  const categoryMatch = /"category":"([^"]{1,40})"/.exec(html);
  const listMatch = /"keywordList":\[([^\]]*)\]/.exec(html);
  const listRaw = listMatch?.[1] ?? '';
  const keywords = listRaw.trim()
    ? listRaw
        .split(',')
        .map((s) => decodeJsonString(s.trim().replace(/^"|"$/g, '')))
        .filter(Boolean)
    : [];
  return {
    category: decodeJsonString(categoryMatch?.[1] ?? ''),
    keywords,
    keywordFieldFound: listMatch !== null,
    categoryFieldFound: categoryMatch !== null,
  };
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
  /** 검색광고 자격증명을 읽을 환경 — 검색량 필터에만 쓴다. */
  readonly env?: NodeJS.ProcessEnv;
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
  /** 상세 페이지를 실제로 읽었는가 — false 면 "키워드 없음" 이라고 말하면 안 된다. */
  readonly profileChecked: boolean;
  /** keywordList 필드 자체를 찾았는가 — 빈 등록과 파싱 실패를 가른다. */
  readonly keywordFieldFound: boolean;
  readonly measuredKeywords: readonly PlaceKeywordPick[];
  readonly lowVolumeKeywords: readonly PlaceKeywordPick[];
  readonly overLimitKeywords: readonly PlaceKeywordPick[];
  readonly volumeChecked: boolean;
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
  profileChecked: false,
  keywordFieldFound: false,
  measuredKeywords: [],
  lowVolumeKeywords: [],
  overLimitKeywords: [],
  volumeChecked: false,
  ranks: [],
  rankChecked: false,
  topN: PLACE_TOP_N,
};

/**
 * 이 목록 항목이 **우리 지역의 병원**인가.
 *
 * ⚠️ 이름만 보면 안 된다 — '서울베리굿치과의원' 을 검색하면 서울 서대문구
 *    '베리굿치과의원' 이 같은 목록에 올라온다(실측). 이름이 정규화 후 같아지는
 *    동명 병원은 전국에 흔하고, 잘못 고르면 **남의 순위를 원장 순위로 보고**한다.
 *
 * 주소를 못 읽었으면(빈 문자열) 통과시키지 않는다 — 확인 못 한 것을 맞다고 하지 않는다.
 */
/**
 * 주소에서 구·군 토큰을 뽑는다.
 *
 * ⚠️ 시·도 이름 자체가 `구` 로 끝나는 경우가 있다('대구'). 그걸 구로 읽으면
 *    전국 매칭이 무너지므로 시·도 토큰은 건너뛴다.
 */
export function districtOf(address: string, shortProvince: string): string {
  /**
   * ⚠️ 구 이름은 **한 글자짜리가 흔하다**(동구·서구·남구·북구·중구). 앞에 2글자
   *    이상을 요구하면 대구 동구 같은 곳이 전부 "구를 못 읽음" 으로 빠져 시·도
   *    폴백으로 통과해 버린다 — 2026-08-04 에 실제로 그렇게 났다.
   */
  return administrativeTokens(address, shortProvince).find((t) => /[구군]$/u.test(t)) ?? '';
}

/**
 * 지역 판정 3값 — **"확인했다" 와 "모른다" 를 절대 뭉개지 않는다.**
 *
 *  match    : 우리 지역이 맞다
 *  mismatch : 다른 지역이다
 *  unknown  : 주소로는 판정할 수 없다 (주소가 비었거나 구·군을 못 읽었다)
 */
export type RegionMatch = 'match' | 'mismatch' | 'unknown';

/**
 * 주소에서 **행정구역 토큰을 전부** 모은다 (시·도 자리는 제외).
 *
 * ⚠️ `구·군` 만 보면 안 된다 (2026-08-04 지적):
 *   · 제주는 `제주시`·`서귀포시` 처럼 **행정시**가 그 자리를 대신한다
 *   · 경기도는 `성남시 분당구` 처럼 **두 단계**가 함께 온다
 *   그래서 하나만 집어 비교하면 성남시를 집어 분당구와 다르다고 판정해 버린다.
 *   전부 모아 두고 **하나라도 맞으면 맞다**로 본다.
 */
export function administrativeTokens(address: string, shortProvince: string): readonly string[] {
  const city = (shortProvince ?? '').trim();
  const tokens = (address ?? '').trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  /**
   * 앞 토큰(시·도 자리)은 건너뛴다 — '대구' 는 `구` 로 끝나지만 시·도다.
   *
   * ⚠️ 그 뒤 토큰은 **완전히 같을 때만** 건너뛴다. `startsWith` 로 걸렀더니
   *    '제주특별자치도 **제주시**' 의 행정시가 시·도 이름으로 시작한다는 이유로
   *    통째로 사라져, 제주 지역 병원이 전부 미확인으로 빠졌다(2026-08-04).
   */
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (city && token === city) continue;
    if (/^[가-힣]{1,10}[구군시]$/.test(token)) out.push(token);
  }
  return out;
}

/** 시·도 표기의 뿌리 이름 ('세종시'·'제주특별자치도' → '세종'·'제주'). */
function provinceBase(value: string): string {
  return (value ?? '')
    .trim()
    .replace(/(특별자치도|특별자치시|특별시|광역시|자치시|자치도|시|도)$/u, '');
}

export function matchesRegion(
  listing: PlaceListing,
  region: string,
  shortProvince: string,
): RegionMatch {
  const address = (listing.address ?? '').trim();
  if (!address) return 'unknown';

  const gu = (region ?? '').trim();
  const tokens = administrativeTokens(address, shortProvince);

  /** 행정구역이 적혀 있으면 그중 하나가 우리 지역이어야 한다. */
  if (tokens.length > 0) return gu && tokens.includes(gu) ? 'match' : 'mismatch';

  const base = provinceBase(shortProvince);
  const compact = address.replace(/\s+/g, '');

  /**
   * 세종처럼 **구·군이 아예 없는 단층 지역**은 시·도 일치가 곧 지역 일치다
   * (오귀속 위험이 없다). 그 외에는 통과시키지 않는다.
   */
  if (gu && base && provinceBase(gu) === base) {
    return compact.includes(base) ? 'match' : 'mismatch';
  }

  /**
   * ⚠️ 구·군을 못 읽었으면 **시·도 폴백으로 통과시키지 않는다**(2026-08-04 지적).
   *    "같은 시면 맞다" 로 두면, 대구 수성구 '동명치과' 를 찾는데 주소가
   *    `대구광역시 동대구로 123` 처럼 구가 안 적힌 대구 동구 '동명치과' 가 통과해
   *    **그 병원의 키워드와 순위를 원장 것으로 보고**하게 된다.
   *    다른 시·도인 것이 분명할 때만 mismatch, 그 외에는 모른다고 한다.
   */
  if (base && !compact.includes(base)) return 'mismatch';
  return 'unknown';
}

/** 병원명으로 플레이스를 특정한다. 이름·지역이 모두 맞을 때만 채택한다. */
async function resolvePlace(
  input: MeasurePlaceInput,
  options: PlaceFetchOptions,
): Promise<{ listing: PlaceListing | null; sawAnyListing: boolean }> {
  /**
   * 상호 단독 질의를 먼저 한다 — 지역을 앞에 붙이면 오히려 안 잡히는 경우가 있다
   * (naver-local.ts 에서 실측된 것과 같은 성질). 못 찾으면 지역을 붙여 한 번 더 본다.
   */
  const queries = [input.clinicName, `${input.region} ${input.clinicName}`.trim()];
  let sawAnyListing = false;
  let nameMatchedWithoutAddress = false;
  for (const query of queries) {
    const listings = await fetchPlaceListings(query, options);
    if (listings === null || listings.length === 0) continue;
    /**
     * ⚠️ 링크만 읽히고 **이름·주소가 비어 있으면 목록을 읽은 것이 아니다**
     *    (2026-08-04 지적). 상태 객체 구조만 바뀌어도 id 는 그대로 나오는데,
     *    그걸 "정상 조회" 로 세면 등록된 병원을 "미등록" 으로 보고하게 된다.
     */
    if (listings.some((l) => l.name && l.address)) sawAnyListing = true;
    for (const listing of listings) {
      if (findClinicRank([listing], input.clinicName) === null) continue;
      /**
       * ⚠️ 이름은 맞는데 **지역을 확인 못 했으면 "없다" 가 아니라 "모른다"** 이다
       *    (2026-08-04 지적). 주소 필드가 비었거나 구·군을 못 읽은 경우가 여기다.
       *    이걸 not_found 로 보고하면 **등록된 병원에게 "등록 안 돼 있다"** 고 말하고,
       *    반대로 통과시키면 **같은 시 다른 구의 동명 병원**을 원장 병원으로 확정한다.
       *    둘 다 안 된다 — 모른다고 말한다.
       */
      const region = matchesRegion(listing, input.region, input.shortProvince);
      if (region === 'unknown') {
        nameMatchedWithoutAddress = true;
        continue;
      }
      if (region === 'mismatch') continue;
      return { listing, sawAnyListing };
    }
  }
  // 이름이 맞는 후보를 봤지만 지역을 확인하지 못했다면 단정하지 않는다.
  return { listing: null, sawAnyListing: sawAnyListing && !nameMatchedWithoutAddress };
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

  const { listing, sawAnyListing } = await resolvePlace(input, options);
  if (!listing) {
    /**
     * ⚠️ **목록을 한 번도 못 읽었으면 "미등록" 이라고 하지 않는다.**
     *    HTTP 200 이어도 네이버가 마크업을 바꾸면 파서가 빈 배열을 돌려주는데,
     *    그걸 not_found 로 보고하면 **등록된 병원에게 "등록 안 돼 있다"** 고 말하게 된다.
     *    실제로 개발 중 경로·마크업 차이로 그 사고가 났다.
     *    목록은 정상적으로 읽혔는데 그 안에 우리 병원이 없을 때만 not_found 다.
     */
    return {
      ...EMPTY_PLACE_RESULT,
      checked: sawAnyListing,
      presence: sawAnyListing ? 'not_found' : 'unknown',
    };
  }

  const fetchedProfile = await fetchPlaceProfile(listing.id, options);
  /**
   * ⚠️ HTTP 200 이 곧 "읽었다" 가 아니다 — 필드 구조가 바뀌면 파서는 조용히 빈 값을
   *    돌려준다. **예상한 필드를 실제로 찾았을 때만** 읽은 것으로 센다.
   */
  const profileChecked =
    fetchedProfile !== null &&
    (fetchedProfile.keywordFieldFound || fetchedProfile.categoryFieldFound);
  const profile = fetchedProfile ?? {
    category: '',
    keywords: [],
    keywordFieldFound: false,
    categoryFieldFound: false,
  };
  const scopes = buildPlaceScopes(input);
  const regionTokens = scopes.map((s) => s.region);
  const cleaned = sanitizePlaceKeywords(profile.keywords, regionTokens, profile.category);

  /**
   * 검색량으로 거른다 — 아무도 안 치는 말의 "1위" 는 성과가 아니다.
   *
   * 검색광고 키가 없거나 조회가 실패하면 `available:false` 가 오고, 그때는 **거르지
   * 않는다**(기존 동작). 조회 실패를 이유로 리포트를 빈약하게 만들지 않는다.
   */
  const volumeResult = await fetchKeywordVolumes(
    [profile.category, ...cleaned].filter((k) => k && k.length >= 2),
    { env: options.env, fetchImpl: options.fetchImpl },
  ).catch(() => ({ available: false, volumes: {} }));

  const { measured, lowVolume, overLimit } = selectPlaceKeywords(
    profile.category,
    cleaned,
    volumeResult.volumes,
    volumeResult.available,
  );

  const combos = scopes.flatMap((scope) =>
    measured.map((pick) => ({
      scope,
      keyword: pick.keyword,
      query: `${scope.region} ${pick.keyword}`,
    })),
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
    // 빈 목록은 "5위 밖" 이 아니라 **못 읽은 것**이다 — 마크업이 바뀌면 여기가 먼저 빈다.
    if (listings === null || listings.length === 0) {
      return { ...base, state: 'unchecked', rank: null };
    }
    /**
     * ⚠️ 순위는 **place id 로** 판정한다. 이름 비교로 하면 정규화 후 같아지는
     *    동명 병원이 목록에 함께 있을 때 **남의 순위를 원장 순위로 보고**한다.
     *    병원은 이미 주소까지 확인해 확정했으므로 id 가 정본이다.
     */
    const index = listings.findIndex((l) => l.id === listing.id);
    return index === -1
      ? { ...base, state: 'outside_top', rank: null }
      : { ...base, state: 'ranked', rank: index + 1 };
  });

  return {
    checked: true,
    presence: 'found',
    placeId: listing.id,
    placeName: listing.name || null,
    category: profile.category || null,
    registeredKeywords: profile.keywords,
    profileChecked,
    keywordFieldFound: profile.keywordFieldFound,
    measuredKeywords: measured,
    lowVolumeKeywords: lowVolume,
    overLimitKeywords: overLimit,
    volumeChecked: volumeResult.available,
    ranks,
    rankChecked: ranks.some((r) => r.state !== 'unchecked'),
    topN: PLACE_TOP_N,
  };
}
