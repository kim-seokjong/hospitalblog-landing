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
export const MAX_REGISTRY_CALLS = 4;
/** 1회 호출 타임아웃(ms). */
export const REGISTRY_TIMEOUT_MS = 8_000;
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

/** 행안부 JSON 응답 파싱 (순수 함수). 형태가 어긋나면 빈 페이지. */
export function parseRegistryResponse(payload: unknown): RegistryPage {
  if (!payload || typeof payload !== 'object') return { totalCount: 0, items: [] };
  const root = payload as Record<string, unknown>;
  const response = (root.response && typeof root.response === 'object' ? root.response : root) as Record<string, unknown>;
  const body = (response.body && typeof response.body === 'object' ? response.body : {}) as Record<string, unknown>;

  let rawItems: unknown = body.items;
  if (rawItems && typeof rawItems === 'object' && !Array.isArray(rawItems)) {
    rawItems = (rawItems as Record<string, unknown>).item;
  }
  const list = Array.isArray(rawItems) ? rawItems : [];
  const items = list
    .map(toClinicCandidate)
    .filter((c): c is ClinicCandidate => c !== null);

  const totalRaw = Number(body.totalCount);
  const totalCount = Number.isFinite(totalRaw) && totalRaw >= 0 ? Math.floor(totalRaw) : items.length;
  return { totalCount, items };
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

/** 시드 1건 조회. 실패·타임아웃은 null (절대 throw 안 함). */
async function fetchRegistryPage(
  seed: string,
  region: string,
  options: { env: RegistryEnv; fetchImpl: typeof fetch; timeoutMs: number },
): Promise<RegistryPage | null> {
  const key = (options.env.DATA_GO_SERVICE_KEY ?? '').trim();
  if (!key) return null;

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
    if (!res.ok) return null;
    return parseRegistryResponse(await res.json());
  } catch {
    return null;
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

  let anyCallSucceeded = false;
  for (const attempt of attempts.slice(0, MAX_REGISTRY_CALLS)) {
    const page = await fetchRegistryPage(attempt.seed, attempt.region, { env, fetchImpl, timeoutMs });
    if (page === null) continue;
    anyCallSucceeded = true;
    if (page.items.length === 0) continue;
    return decideLookup(page.items, parsed.name, {
      truncated: page.totalCount > page.items.length,
      totalCount: page.totalCount,
      hasRegion: attempt.region !== '',
    });
  }

  if (!anyCallSucceeded) return { kind: 'unavailable', reason: 'fetch_failed' };
  return { kind: 'not_found' };
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
      : outcome.kind === 'ambiguous' || outcome.kind === 'needs_region' || outcome.kind === 'closed_only'
        ? outcome.candidates
        : [];
  return pool.find((c) => c.mngNo === mngNo) ?? null;
}
