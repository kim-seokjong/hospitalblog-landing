import type { ClinicCandidate, ClinicLookupOutcome } from './types.ts';

/**
 * 1단계 — 병원 특정 (행정안전부 '건강_의원 조회서비스', data.go.kr 15154874).
 *
 * 이름만으로는 병원을 특정할 수 없다(실측: "미소치과의원" 전국 49곳, LIKE 기준
 * 1,230곳). 그래서 이 모듈은 **자동 확정을 극도로 보수적으로** 한다:
 *   · 영업중 후보가 정확히 1건일 때만 resolved
 *   · 2건 이상이면 주소를 붙여 사용자가 고르게 한다(ambiguous)
 *   · 스캔 상한(100건)을 넘길 만큼 흔한 이름이면 추측하지 않고 지역을 요청한다
 *   · 폐업(SALS_STTS_CD ≠ 01)은 반드시 걸러낸다
 *
 * 검색 시드 전략 (실측 근거):
 *   API 의 LIKE 는 **저장된 문자열의 부분일치**다. 등록 상호에 공백이 끼어 있는
 *   경우가 많아("플로르 성형외과 의원") 사용자가 붙여 쓴 입력은 0건이 나온다.
 *   → ① 입력 그대로 ② 공백 제거 ③ 브랜드 코어(진료과 토큰 앞부분) 순으로
 *      시도하고 첫 히트에서 멈춘다. 최대 4콜.
 *
 * 좌표(CRD_INFO_X/Y)는 WGS84 가 아닌 투영좌표라 쓰지 않는다.
 * HMPG_ADDR(홈페이지)는 실측상 전건 null 이라 홈페이지 축에서 쓰지 않는다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

export const REGISTRY_ENDPOINT = 'https://apis.data.go.kr/1741000/clinics/info';

/** 한 시드당 스캔하는 최대 건수 (API numOfRows 상한과 동일). */
export const REGISTRY_SCAN_CAP = 100;
/** 사용자에게 보여줄 후보 상한. */
export const MAX_CANDIDATES = 8;
/** 시드 시도 상한 — 외부 API 호출 비용 방어. */
export const MAX_REGISTRY_CALLS = 3;
/** 1회 호출 타임아웃(ms). */
/**
 * 1회 호출 타임아웃(ms).
 * ★8초는 부족했다 — 로컬은 1~2초인데 Vercel 서버에서는 10.6초가 걸린다(실측).
 *   그 결과 모든 시도가 중단되어 어떤 병원도 찾지 못하고 있었다.
 */
export const REGISTRY_TIMEOUT_MS = 15_000;
/** 영업/정상 상태코드. */
export const ACTIVE_STATUS_CODE = '01';

/**
 * 브랜드 코어 추출에 쓰는 진료과·기관 토큰.
 * 긴 토큰이 먼저 와야 한다("소아청소년과"가 "소아"보다 먼저 매칭돼야 함).
 */
const SPECIALTY_TOKENS: readonly string[] = [
  '정신건강의학과', '소아청소년과', '마취통증의학과', '구강악안면외과', '영상의학과',
  '재활의학과', '가정의학과', '비뇨의학과', '응급의학과', '진단검사의학과',
  '이비인후과', '산부인과', '성형외과', '정형외과', '신경외과', '흉부외과',
  '비뇨기과', '치과교정과', '통합치의학과', '소아치과',
  '피부과', '신경과', '내과', '외과', '안과', '치과', '한의원', '한방병원', '한방',
  '의원', '병원', '클리닉', '메디컬', '의료재단',
];

/** 기관 종별·접미사 — 정규화 비교에서 떼어낸다. */
const INSTITUTION_SUFFIX = /(치과의원|한의원|한방병원|의원|병원|클리닉)$/u;

/** 시·도 축약형 → 정식 명칭 (지역 힌트 정규화용). */
const PROVINCE_ALIASES: Readonly<Record<string, string>> = {
  서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시',
  광주: '광주광역시', 대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시',
  경기: '경기도', 강원: '강원특별자치도', 충북: '충청북도', 충남: '충청남도',
  전북: '전북특별자치도', 전남: '전라남도', 경북: '경상북도', 경남: '경상남도',
  제주: '제주특별자치도',
};

/** 진료과목 원문 → 우리 진료과목 어휘 매핑. */
const SPECIALTY_ALIASES: Readonly<Record<string, string>> = {
  소아과: '소아청소년과',
  비뇨기과: '비뇨의학과',
  정신과: '정신건강의학과',
  신경정신과: '정신건강의학과',
};

/** 공백 제거 + 소문자 — 이름 동일성 판정의 정본. */
export function normalizeClinicName(value: string): string {
  return (value ?? '').replace(/\s+/g, '').toLowerCase();
}

/** 기관 접미사(의원·병원·클리닉)를 뗀 형태. 2자 미만이 되면 원본 유지. */
export function stripInstitutionSuffix(value: string): string {
  const compact = (value ?? '').trim();
  const stripped = compact.replace(INSTITUTION_SUFFIX, '').trim();
  return stripped.length >= 2 ? stripped : compact;
}

/**
 * 브랜드 코어 — 첫 진료과·기관 토큰 앞부분.
 * "브이비성형외과의원" → "브이비", "플로르 성형외과 의원" → "플로르".
 * 토큰이 맨 앞이거나 코어가 2자 미만이면 '' (호출부가 폴백).
 */
export function deriveBrandCore(name: string): string {
  const value = (name ?? '').trim();
  if (!value) return '';
  // 이름이 진료과 토큰으로 시작하면 브랜드 부분이 없다 ("성형외과의원" → '').
  // 이 가드가 없으면 "성형외과의원"에서 "외과"(index 2)에 걸려 "성형"이 나온다.
  if (SPECIALTY_TOKENS.some((token) => value.startsWith(token))) return '';
  let earliest = -1;
  for (const token of SPECIALTY_TOKENS) {
    const idx = value.indexOf(token);
    if (idx > 0 && (earliest === -1 || idx < earliest)) earliest = idx;
  }
  if (earliest === -1) return '';
  const core = value.slice(0, earliest).trim();
  return core.replace(/\s+/g, '').length >= 2 ? core : '';
}

export interface ParsedQuery {
  /** 지역 힌트를 떼어낸 병원명. */
  readonly name: string;
  /** 주소 LIKE 필터에 쓸 지역 문자열. 없으면 ''. */
  readonly region: string;
}

/**
 * 사용자 입력에서 앞쪽 지역 토큰을 분리한다.
 * "대구 브이비성형외과" → { name: '브이비성형외과', region: '대구광역시' }.
 * 지역 토큰이 없으면 region: ''.
 */
export function splitRegionHint(rawName: string, explicitRegion?: string): ParsedQuery {
  const tokens = (rawName ?? '').trim().split(/\s+/).filter((t) => t.length > 0);
  const regions: string[] = [];
  let i = 0;
  while (i < tokens.length - 1) {
    const token = tokens[i];
    const isProvince = Object.prototype.hasOwnProperty.call(PROVINCE_ALIASES, token);
    const isFullProvince = Object.values(PROVINCE_ALIASES).includes(token);
    const isDistrict = /^[가-힣]{2,6}(시|군|구)$/.test(token);
    if (!isProvince && !isFullProvince && !isDistrict) break;
    regions.push(isProvince ? PROVINCE_ALIASES[token] : token);
    i += 1;
  }
  const name = tokens.slice(i).join(' ');
  const explicit = (explicitRegion ?? '').trim();
  // 명시 지역이 있으면 그것을 쓰고, 없으면 입력에서 뗀 마지막(가장 좁은) 지역을 쓴다.
  const region = explicit || (regions.length > 0 ? regions[regions.length - 1] : '');
  return { name: name || (rawName ?? '').trim(), region: normalizeRegionHint(region) };
}

/** 지역 힌트를 주소 LIKE 에 넣을 형태로 정규화 ('대구' → '대구광역시'). */
export function normalizeRegionHint(region: string): string {
  const value = (region ?? '').trim();
  if (!value) return '';
  return PROVINCE_ALIASES[value] ?? value;
}

/**
 * 검색 시드 목록 (순서대로 시도, 첫 히트에서 중단).
 * 중복·2자 미만은 제거한다.
 */
export function buildRegistrySeeds(name: string): readonly string[] {
  const trimmed = (name ?? '').trim().replace(/\s+/g, ' ');
  const seeds = [trimmed, trimmed.replace(/\s+/g, ''), deriveBrandCore(trimmed), stripInstitutionSuffix(trimmed)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seed of seeds) {
    const value = seed.trim();
    if (value.replace(/\s+/g, '').length < 2) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** 진료과목 원문 목록에서 대표 진료과를 고른다. */
export function pickSpecialty(subjects: readonly string[], institutionType: string): string {
  if (institutionType === '치과의원') return '치과';
  if (institutionType === '한의원' || institutionType === '한방병원') return '한의원';
  for (const subject of subjects) {
    const value = subject.trim();
    if (!value) continue;
    return SPECIALTY_ALIASES[value] ?? value;
  }
  return '';
}

/** 주소에서 시·도 / 구·군 추출. */
export function splitAddress(address: string): { province: string; region: string } {
  const parts = (address ?? '').trim().split(/\s+/).filter((p) => p.length > 0);
  const province = parts[0] ?? '';
  const district = parts.find((p) => /(구|군)$/.test(p) && p !== province) ?? '';
  const city = parts.find((p) => /시$/.test(p) && p !== province) ?? '';
  return { province, region: district || city };
}

/** YYYYMMDD 또는 YYYY-MM-DD → YYYY-MM-DD. 실패 시 ''. */
function normalizeDate(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 8) return '';
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** 행안부 응답 1건 → ClinicCandidate. 관리번호·상호가 없으면 null. */
export function toClinicCandidate(row: unknown): ClinicCandidate | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const mngNo = readString(record, 'MNG_NO');
  const name = readString(record, 'BPLC_NM');
  if (!mngNo || !name) return null;

  const roadAddress = readString(record, 'ROAD_NM_ADDR');
  const lotAddress = readString(record, 'LOTNO_ADDR');
  const { province, region } = splitAddress(roadAddress || lotAddress);
  const institutionType = readString(record, 'MDLCR_INST_BTP_NM');
  const subjects = readString(record, 'MDEXM_SBJCT_CN_NM')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const statusCode = readString(record, 'SALS_STTS_CD');

  return {
    mngNo,
    name,
    roadAddress,
    lotAddress,
    region,
    province,
    subjects,
    specialty: pickSpecialty(subjects, institutionType),
    institutionType,
    phone: readString(record, 'TELNO'),
    active: statusCode === ACTIVE_STATUS_CODE,
    statusLabel: readString(record, 'SALS_STTS_NM') || (statusCode === ACTIVE_STATUS_CODE ? '영업/정상' : '상태 미상'),
    openedOn: normalizeDate(record.LCPMT_YMD),
    closedOn: normalizeDate(record.CLSBIZ_YMD),
  };
}

export interface RegistryPage {
  readonly totalCount: number;
  readonly items: readonly ClinicCandidate[];
}

/**
 * 응답 파싱 결과.
 *
 * ok:false 를 반드시 구분해야 하는 이유 — 공공데이터포털 게이트웨이는 키가
 * 만료되거나 일일 한도를 넘겼을 때 **HTTP 200 에 오류 본문**을 실어 보낸다.
 * 그걸 "0건"으로 읽으면 모든 병원이 "그런 병원 없음"으로 표시되고, 운영자는
 * 장애를 영영 눈치채지 못한다(실제로 그렇게 됐다).
 */
export type RegistryParse =
  | { readonly ok: true; readonly page: RegistryPage }
  | { readonly ok: false; readonly reason: 'key_rejected' | 'service_error'; readonly message: string };

/**
 * 게이트웨이 오류 본문에 등장하는 토큰.
 * 키 문제(만료·미등록·한도 초과·IP 제한)는 운영자가 조치해야 하는 사안이라 따로 뽑는다.
 */
const KEY_ERROR_TOKENS: readonly string[] = [
  'SERVICE_KEY_IS_NOT_REGISTERED',
  'SERVICE KEY IS NOT REGISTERED',
  'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS',
  'SERVICE_ACCESS_DENIED',
  'ACCESS_DENIED',
  'DEADLINE_HAS_EXPIRED',
  'UNREGISTERED_IP',
  'UNAUTHORIZED',
  'TEMPORARILY_DISABLE_THE_SERVICEKEY',
  'NO_OPENAPI_SERVICE_ERROR',
];

/** 어떤 형태의 오류 본문이든 문자열로 훑어 키 문제인지 판정한다. */
function classifyErrorText(text: string): 'key_rejected' | 'service_error' {
  const upper = text.toUpperCase();
  return KEY_ERROR_TOKENS.some((token) => upper.includes(token)) ? 'key_rejected' : 'service_error';
}

/** 성공을 뜻하는 결과 코드 (포털 표준 '00' / 행안부 'INFO-000'). */
function isSuccessCode(code: string): boolean {
  const value = code.trim().toUpperCase();
  return value === '' || value === '00' || value === '0' || value === 'INFO-000' || value === 'INFO-00';
}

/** 응답 어디에 있든 결과 코드/메시지를 찾아낸다 (엔벨로프 변형 대비). */
function readResultCode(root: Record<string, unknown>, response: Record<string, unknown>): { code: string; message: string } {
  for (const holder of [response, root]) {
    const header = holder.header;
    if (header && typeof header === 'object') {
      const h = header as Record<string, unknown>;
      const code = typeof h.resultCode === 'string' ? h.resultCode : '';
      if (code) return { code, message: typeof h.resultMsg === 'string' ? h.resultMsg : '' };
    }
    const result = holder.RESULT;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      const code = typeof r.CODE === 'string' ? r.CODE : '';
      if (code) return { code, message: typeof r.MESSAGE === 'string' ? r.MESSAGE : '' };
    }
  }
  return { code: '', message: '' };
}

/**
 * 행안부 JSON 응답 파싱 (순수 함수).
 *
 * 판정 순서:
 *   ① 게이트웨이 오류 엔벨로프(cmmMsgHeader 등) → 오류
 *   ② 결과 코드가 성공이 아니면 → 오류
 *   ③ items / totalCount 중 하나도 못 알아보면 → 오류(정체불명 응답을 0건으로 읽지 않는다)
 *   ④ 그 외에는 정상 페이지 (0건도 정상 — 진짜로 없는 것)
 */
export function parseRegistryResponse(payload: unknown): RegistryParse {
  if (typeof payload === 'string') {
    return { ok: false, reason: classifyErrorText(payload), message: payload.slice(0, 200) };
  }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'service_error', message: '응답을 해석하지 못했습니다.' };
  }
  const root = payload as Record<string, unknown>;

  // ① 게이트웨이 오류 엔벨로프 — 정상 응답에는 절대 없는 키다.
  const gateway = root.OpenAPI_ServiceResponse ?? root.cmmMsgHeader;
  if (gateway && typeof gateway === 'object') {
    const text = JSON.stringify(gateway);
    return { ok: false, reason: classifyErrorText(text), message: text.slice(0, 200) };
  }

  const response = (root.response && typeof root.response === 'object' ? root.response : root) as Record<string, unknown>;

  // ② 결과 코드
  const result = readResultCode(root, response);
  if (!isSuccessCode(result.code)) {
    const text = `${result.code} ${result.message}`;
    return { ok: false, reason: classifyErrorText(text), message: text.trim().slice(0, 200) };
  }

  const body = (response.body && typeof response.body === 'object' ? response.body : {}) as Record<string, unknown>;

  let rawItems: unknown = body.items;
  if (rawItems && typeof rawItems === 'object' && !Array.isArray(rawItems)) {
    rawItems = (rawItems as Record<string, unknown>).item;
  }

  const hasItemsField = rawItems !== undefined && rawItems !== null;
  const totalRaw = Number(body.totalCount);
  const hasTotalField = body.totalCount !== undefined && Number.isFinite(totalRaw) && totalRaw >= 0;

  // ③ 우리가 아는 형태가 하나도 없다 — "0건"이라고 단정하면 안 된다.
  if (!hasItemsField && !hasTotalField) {
    return {
      ok: false,
      reason: 'service_error',
      message: '알 수 없는 응답 형식입니다(items·totalCount 없음).',
    };
  }

  const list = Array.isArray(rawItems) ? rawItems : [];
  const items = list.map(toClinicCandidate).filter((c): c is ClinicCandidate => c !== null);
  const totalCount = hasTotalField ? Math.floor(totalRaw) : items.length;
  return { ok: true, page: { totalCount, items } };
}

/**
 * 후보 랭킹 — 정확 일치 > 접미사 제거 일치 > 시작 일치 > 부분 일치.
 * 동점이면 영업중 우선, 그다음 이름 짧은 순(브랜드 본체에 가까움).
 */
export function scoreCandidate(candidate: ClinicCandidate, queryName: string): number {
  const target = normalizeClinicName(candidate.name);
  const query = normalizeClinicName(queryName);
  if (!query) return 0;
  if (target === query) return 100;
  if (normalizeClinicName(stripInstitutionSuffix(candidate.name)) === normalizeClinicName(stripInstitutionSuffix(queryName))) {
    return 90;
  }
  if (target.startsWith(query)) return 70;
  if (target.includes(query)) return 50;
  const core = normalizeClinicName(deriveBrandCore(queryName));
  if (core.length >= 2 && target.includes(core)) return 30;
  return 10;
}

export function rankCandidates(
  candidates: readonly ClinicCandidate[],
  queryName: string,
): readonly ClinicCandidate[] {
  return [...candidates].sort((a, b) => {
    const diff = scoreCandidate(b, queryName) - scoreCandidate(a, queryName);
    if (diff !== 0) return diff;
    if (a.active !== b.active) return a.active ? -1 : 1;
    const len = a.name.length - b.name.length;
    if (len !== 0) return len;
    return a.mngNo.localeCompare(b.mngNo);
  });
}

/**
 * 수집된 후보로 최종 판정을 내린다 (순수 함수 — 라우트·테스트 공용).
 *
 * 자동 확정은 **영업중 + 정확 일치(점수 90 이상) 후보가 정확히 1건**일 때만.
 * 그 외에는 사용자가 고르게 한다. 틀린 병원을 자동 확정하면 그 자리에서
 * 신뢰를 잃기 때문에, 애매하면 항상 사용자에게 넘긴다.
 */
export function decideLookup(
  candidates: readonly ClinicCandidate[],
  queryName: string,
  options: { readonly truncated: boolean; readonly totalCount: number; readonly hasRegion: boolean },
): ClinicLookupOutcome {
  if (candidates.length === 0) {
    if (options.truncated || options.totalCount > REGISTRY_SCAN_CAP) {
      return { kind: 'needs_region', candidates: [], totalCount: options.totalCount };
    }
    return { kind: 'not_found' };
  }

  const ranked = rankCandidates(candidates, queryName);
  const active = ranked.filter((c) => c.active);
  if (active.length === 0) {
    return { kind: 'closed_only', candidates: ranked.slice(0, MAX_CANDIDATES) };
  }

  const strong = active.filter((c) => scoreCandidate(c, queryName) >= 90);
  if (strong.length === 1) {
    return { kind: 'resolved', clinic: strong[0] };
  }
  // 정확 일치가 없고 후보만 많으면서 스캔이 잘렸다면 — 추측하지 말고 지역을 받는다.
  if (strong.length === 0 && options.truncated && !options.hasRegion) {
    return { kind: 'needs_region', candidates: active.slice(0, MAX_CANDIDATES), totalCount: options.totalCount };
  }
  if (active.length === 1) {
    return { kind: 'resolved', clinic: active[0] };
  }
  return {
    kind: 'ambiguous',
    candidates: (strong.length > 1 ? strong : active).slice(0, MAX_CANDIDATES),
    truncated: options.truncated,
  };
}

/* ── HTTP 계층 ───────────────────────────────────────────── */

export interface RegistryEnv {
  readonly DATA_GO_SERVICE_KEY?: string;
}

export function isRegistryConfigured(env: RegistryEnv): boolean {
  return typeof env.DATA_GO_SERVICE_KEY === 'string' && env.DATA_GO_SERVICE_KEY.trim().length > 0;
}

export type RegistryFetch =
  | { readonly ok: true; readonly page: RegistryPage }
  | {
      readonly ok: false;
      readonly reason: 'not_configured' | 'key_rejected' | 'service_error' | 'network';
      readonly message: string;
    };

/**
 * 시드 1건 조회. 절대 throw 하지 않는다.
 *
 * ⚠️ 실패를 한 덩어리(null)로 뭉개지 않는다. "키가 거부됐다"와 "네트워크가 죽었다"는
 *    운영상 완전히 다른 사건이고, 둘 다 "그런 병원 없음"과는 더더욱 다르다.
 */
async function fetchRegistryPage(
  seed: string,
  region: string,
  options: { env: RegistryEnv; fetchImpl: typeof fetch; timeoutMs: number },
): Promise<RegistryFetch> {
  const key = (options.env.DATA_GO_SERVICE_KEY ?? '').trim();
  if (!key) return { ok: false, reason: 'not_configured', message: 'DATA_GO_SERVICE_KEY 미설정' };

  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: '1',
    numOfRows: String(REGISTRY_SCAN_CAP),
    returnType: 'json',
    'cond[BPLC_NM::LIKE]': seed,
  });
  if (region) params.set('cond[ROAD_NM_ADDR::LIKE]', region);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await options.fetchImpl(`${REGISTRY_ENDPOINT}?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    // 인증·한도 계열 상태코드는 그 자체로 키 문제다.
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return { ok: false, reason: 'key_rejected', message: `HTTP ${res.status}` };
    }

    // JSON 이 아닌 오류 본문(XML·평문)도 그대로 읽어 원인을 남긴다.
    const text = await res.text();
    if (!res.ok) {
      const reason = classifyErrorText(text) === 'key_rejected' ? 'key_rejected' : 'service_error';
      return { ok: false, reason, message: `HTTP ${res.status} ${text.slice(0, 200)}` };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      // JSON 을 요청했는데 JSON 이 아니면 거의 항상 게이트웨이 오류 본문이다.
      payload = text;
    }

    const parsed = parseRegistryResponse(payload);
    return parsed.ok ? { ok: true, page: parsed.page } : { ok: false, reason: parsed.reason, message: parsed.message };
  } catch (error) {
    return { ok: false, reason: 'network', message: error instanceof Error ? error.message : '알 수 없는 오류' };
  } finally {
    clearTimeout(timer);
  }
}

export interface LookupOptions {
  readonly env?: RegistryEnv;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** 사용자가 별도 입력한 지역 (선택). */
  readonly region?: string;
}

/**
 * 병원명(+선택 지역)으로 후보를 찾는다.
 * 시드를 순서대로 시도하고 첫 히트에서 멈춘다. 전 시드 0건이고 지역을 걸었다면
 * 마지막으로 지역 없이 한 번 더 본다(주소 표기 차이 대비). 최대 MAX_REGISTRY_CALLS 콜.
 */
export async function lookupClinics(
  rawName: string,
  options: LookupOptions = {},
): Promise<ClinicLookupOutcome> {
  const env = options.env ?? (process.env as RegistryEnv);
  if (!isRegistryConfigured(env)) return { kind: 'unavailable', reason: 'not_configured' };

  const parsed = splitRegionHint(rawName, options.region);
  if (normalizeClinicName(parsed.name).length < 2) return { kind: 'not_found' };

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REGISTRY_TIMEOUT_MS;
  const seeds = buildRegistrySeeds(parsed.name);

  const attempts: Array<{ seed: string; region: string }> = seeds.map((seed) => ({ seed, region: parsed.region }));
  if (parsed.region && seeds.length > 0) {
    // 마지막 폴백 — 지역 필터를 빼고 브랜드 코어로 한 번 더.
    attempts.push({ seed: seeds[seeds.length - 1], region: '' });
  }

  /**
   * "빈 결과를 봤다"와 "결과를 못 봤다"를 반드시 나눈다.
   * anySuccess 가 false 인데 not_found 를 돌려주면, 장애 기간 내내 모든 병원이
   * "그런 병원 없음"으로 표시되고 아무도 눈치채지 못한다.
   */
  let anySuccess = false;
  let keyRejected: string | null = null;
  let lastFailure: string | null = null;

  for (const attempt of attempts.slice(0, MAX_REGISTRY_CALLS)) {
    const result = await fetchRegistryPage(attempt.seed, attempt.region, { env, fetchImpl, timeoutMs });

    if (!result.ok) {
      if (result.reason === 'key_rejected' && keyRejected === null) keyRejected = result.message;
      lastFailure = `${result.reason}: ${result.message}`;
      continue;
    }

    anySuccess = true;
    const page = result.page;
    if (page.items.length === 0) continue;

    const outcome = decideLookup(page.items, parsed.name, {
      truncated: page.totalCount > page.items.length,
      totalCount: page.totalCount,
      hasRegion: attempt.region !== '',
    });

    // 사용자가 지역을 넣었는데 지역 필터를 뺀 폴백에서 결과가 나왔다면,
    // 그건 **입력한 지역의 병원이 아니다.** 자동 확정하지 않고 그 사실을 명시한다.
    if (parsed.region && attempt.region === '') {
      return relaxToRegionMiss(outcome, parsed.region, page.totalCount > page.items.length);
    }
    return outcome;
  }

  if (keyRejected !== null) {
    // 운영자가 봐야 하는 유일한 사건 — 조용히 넘기지 않는다.
    console.error('[clinic-diagnosis/registry] 행안부 서비스 키가 거부됐습니다(만료·한도·IP 확인 필요):', keyRejected);
    return { kind: 'unavailable', reason: 'key_rejected' };
  }
  if (!anySuccess) {
    console.error('[clinic-diagnosis/registry] 행안부 조회 전건 실패:', lastFailure ?? '원인 미상');
    return { kind: 'unavailable', reason: 'fetch_failed' };
  }
  return { kind: 'not_found' };
}

/** 지역 필터를 뺀 폴백 결과를 region_miss 로 강등한다 (자동 확정 금지). */
function relaxToRegionMiss(
  outcome: ClinicLookupOutcome,
  region: string,
  truncated: boolean,
): ClinicLookupOutcome {
  const candidates: readonly ClinicCandidate[] =
    outcome.kind === 'resolved'
      ? [outcome.clinic]
      : outcome.kind === 'ambiguous' || outcome.kind === 'needs_region' || outcome.kind === 'closed_only'
        ? outcome.candidates
        : [];
  if (candidates.length === 0) return outcome;
  return { kind: 'region_miss', region, candidates: candidates.slice(0, MAX_CANDIDATES), truncated };
}

/** 관리번호로 후보 1건을 다시 확정한다 (2단계 진입 전 서버 재검증용). */
export async function findClinicByMngNo(
  mngNo: string,
  name: string,
  options: LookupOptions = {},
): Promise<ClinicCandidate | null> {
  const outcome = await lookupClinics(name, options);
  const pool: readonly ClinicCandidate[] =
    outcome.kind === 'resolved'
      ? [outcome.clinic]
      : outcome.kind === 'ambiguous' ||
          outcome.kind === 'needs_region' ||
          outcome.kind === 'closed_only' ||
          outcome.kind === 'region_miss'
        ? outcome.candidates
        : [];
  return pool.find((c) => c.mngNo === mngNo) ?? null;
}
