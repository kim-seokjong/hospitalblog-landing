import {
  buildRegistrySeeds,
  decideLookup,
  normalizeClinicName,
  splitRegionHint,
  MAX_CANDIDATES,
  REGISTRY_SCAN_CAP,
} from './registry.ts';
import type { ClinicCandidate, ClinicLookupOutcome } from './types.ts';

/**
 * 병원 조회 **폴백 명부** — 심평원 공개자료 기반 자체 테이블(clinic_directory).
 *
 * ★ 왜 존재하나 (2026-07-27 장애).
 *   홈페이지 첫 화면 전체가 행정안전부 '건강_의원 조회서비스' 하나에 걸려 있었다.
 *   행안부가 HTTP 200 + 정상 엔벨로프에 **0건**을 실어 보낸 15분 동안, 실존 병원
 *   12곳이 전부 "그런 병원 없음"으로 표시됐다. 외부 API 하나가 첫 관문의 단일
 *   장애점이면 그 API가 죽는 날 서비스가 죽는다.
 *
 * 원칙:
 *   · 행안부가 살아 있으면 **행안부가 정본**이다. 이 모듈은 행안부가 0건이거나
 *     호출 자체가 실패했을 때만 내려온다.
 *   · 우리 DB라 LIKE 가 싸다. 그래도 스캔 상한·질의 상한은 그대로 둔다(폭주 방지).
 *   · 식별자는 'hira:' 접두사를 붙여 행안부 관리번호와 **키 공간을 분리**한다.
 *     그래야 서버가 접두사만 보고 어느 원천으로 재검증할지 정할 수 있다.
 *
 * 행안부 대비 구조적 이점 하나 — 이름 정규화.
 *   행안부 LIKE 는 저장된 문자열의 부분일치라 "플로르 성형외과 의원"처럼 공백이 낀
 *   상호는 붙여 쓴 입력에 0건이 나왔다. 여기서는 공백을 제거한 `name_norm` 을 검색
 *   대상으로 두어 그 문제 자체가 생기지 않는다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 * 실제 DB 접근은 directory-db.ts 가 맡고, 이 모듈은 그 함수를 주입받는다.
 */

/** 폴백 식별자 접두사 — 행안부 MNG_NO 와 절대 겹치지 않는다. */
export const DIRECTORY_ID_PREFIX = 'hira:';

/** 한 질의당 가져올 최대 행 수. */
export const DIRECTORY_SCAN_CAP = REGISTRY_SCAN_CAP;
/** 질의 시도 상한 — 우리 DB라도 무한정 훑지 않는다. */
export const MAX_DIRECTORY_QUERIES = 4;

/** 이 식별자가 폴백 명부의 것인가. */
export function isDirectoryMngNo(mngNo: string): boolean {
  return typeof mngNo === 'string' && mngNo.startsWith(DIRECTORY_ID_PREFIX);
}

/** clinic_directory 한 행 (DB 컬럼 그대로). */
export interface DirectoryRow {
  readonly mng_no: string;
  readonly name: string;
  readonly road_address?: string | null;
  readonly province?: string | null;
  readonly region?: string | null;
  readonly institution_type?: string | null;
  readonly specialty?: string | null;
  readonly subjects?: readonly string[] | null;
  readonly phone?: string | null;
  readonly opened_on?: string | null;
  readonly source_version?: string | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * DB 행 → ClinicCandidate.
 *
 * 폴백 명부는 **현재 운영 중인 요양기관 스냅샷**이라 폐업 구분이 없다.
 * 그래서 active 는 항상 true 로 두되, statusLabel 에 자료 출처를 밝혀
 * 원장이 "행안부가 확인해 준 영업상태"와 혼동하지 않게 한다.
 */
export function toDirectoryCandidate(row: unknown): ClinicCandidate | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as DirectoryRow & Record<string, unknown>;
  const mngNo = text(r.mng_no);
  const name = text(r.name);
  if (!mngNo || !name) return null;
  if (!isDirectoryMngNo(mngNo)) return null;

  const subjects = Array.isArray(r.subjects)
    ? r.subjects.map((s) => text(s)).filter((s) => s.length > 0)
    : [];

  return {
    mngNo,
    name,
    roadAddress: text(r.road_address),
    lotAddress: '',
    region: text(r.region),
    province: text(r.province),
    subjects,
    specialty: text(r.specialty),
    institutionType: text(r.institution_type),
    phone: text(r.phone),
    active: true,
    statusLabel: '심평원 공개자료 기준',
    openedOn: text(r.opened_on).slice(0, 10),
    closedOn: '',
    source: 'directory',
    sourceVersion: text(r.source_version),
  };
}

/**
 * LIKE 패턴에 그대로 넣으면 안 되는 문자를 털어낸다.
 * `%`·`_` 를 사용자가 넣으면 전체 스캔이 되고, `\` 는 이스케이프를 깨뜨린다.
 */
export function sanitizeLikeTerm(value: string): string {
  return (value ?? '').replace(/[%_\\]/g, '').trim();
}

/**
 * 검색 조각 목록. 행안부와 같은 시드 전략을 쓰되 **공백을 제거한 형태**로 만든다
 * (name_norm 이 공백 제거본이라 공백이 남아 있으면 영영 매칭되지 않는다).
 */
export function buildDirectoryTerms(name: string): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seed of buildRegistrySeeds(name)) {
    const term = sanitizeLikeTerm(normalizeClinicName(seed));
    if (term.length < 2) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }
  return out;
}

export interface DirectoryQuery {
  /** name_norm LIKE '%term%' — 이미 정규화·세니타이즈된 값. */
  readonly term: string;
  /** road_address LIKE '%region%'. ''이면 지역 필터 없음. */
  readonly region: string;
  readonly limit: number;
}

export type DirectorySearchResult =
  | { readonly ok: true; readonly rows: readonly DirectoryRow[]; readonly total: number }
  | { readonly ok: false; readonly message: string };

/** DB 질의 어댑터 — directory-db.ts 가 구현한다. 절대 throw 하지 않는다. */
export type DirectorySearch = (query: DirectoryQuery) => Promise<DirectorySearchResult>;

/**
 * 명부 가시성 확인 결과.
 *
 * `ok:true && visibleRows === 0` 은 "이 자격증명으로는 명부가 한 줄도 안 보인다"는
 * 뜻이다 — 79,562 건이 적재돼 있으므로 정상 상태에서는 나올 수 없다.
 * (RLS 활성 + SELECT 정책 없음 → service_role 이 아닌 키는 오류 없이 빈 결과를 받는다.)
 */
export interface DirectoryProbeResult {
  readonly ok: boolean;
  readonly visibleRows: number;
}

/** 명부 가시성 확인 어댑터 — directory-db.ts 가 구현한다. 절대 throw 하지 않는다. */
export type DirectoryProbe = () => Promise<DirectoryProbeResult>;

export interface DirectoryLookupResult {
  /**
   * 폴백 명부를 **실제로 조회할 수 있었는가**.
   * false 면 호출부는 행안부의 원래 판정을 그대로 유지해야 한다 —
   * 폴백이 고장 난 것을 "그런 병원 없음"으로 바꿔 말하면 안 된다.
   */
  readonly usable: boolean;
  /** 병원을 찾았을 때만 채워진다. 못 찾았으면 null. */
  readonly outcome: ClinicLookupOutcome | null;
  /** 실제 수행한 질의 수 (로그용). */
  readonly queries: number;
  /**
   * 질의로 실제 받아온 행 수 합계 — **운영 진단용**.
   *
   * 2026-07-28: outcome=null 이 "질의를 안 했다"·"행이 0건이다"·"행은 왔는데
   * 후보 변환에서 전부 탈락했다" 셋 중 어느 것인지 밖에서 가릴 수 없어
   * 원인 규명이 길어졌다. queries 와 함께 보면 셋이 즉시 갈린다.
   */
  readonly rowsSeen: number;
  /** 후보 변환(toDirectoryCandidate)을 통과한 행 수 합계. */
  readonly candidatesSeen: number;
  /**
   * 실제로 질의에 쓴 검색어들 — **운영 진단용**.
   *
   * 2026-07-28: 같은 이름이 로컬에서는 검색어 2개로 풀려 찾아지는데 프로덕션은
   * 1개만 만들어 0건이 났다. 무엇으로 찾고 있는지 모르면 더 좁힐 수가 없다.
   * 사용자가 방금 입력한 병원명의 파생형이라 새로 노출되는 정보가 없다.
   */
  readonly terms: readonly string[];
  /** 이름에서 분리해 낸 지역 힌트 ('' 이면 지역 필터 없음). */
  readonly regionUsed: string;
}

/**
 * 폴백 명부에서 병원을 찾는다.
 *
 * 행안부와 같은 순서로 좁힌다: 시드별로 시도하고 첫 히트에서 멈춘다.
 * 지역을 걸었는데 전부 0건이면 지역 없이 한 번 더 본다(다른 지역 병원임을 명시).
 */
export async function lookupDirectory(
  rawName: string,
  options: { readonly search: DirectorySearch; readonly region?: string },
): Promise<DirectoryLookupResult> {
  const parsed = splitRegionHint(rawName, options.region);
  const empty = {
    usable: true,
    outcome: null,
    queries: 0,
    rowsSeen: 0,
    candidatesSeen: 0,
    terms: [] as readonly string[],
    regionUsed: parsed.region,
  } as const;
  if (normalizeClinicName(parsed.name).length < 2) return empty;

  const terms = buildDirectoryTerms(parsed.name);
  if (terms.length === 0) return empty;

  const regionFilter = sanitizeLikeTerm(parsed.region);
  const attempts: Array<{ term: string; region: string }> = terms.map((term) => ({
    term,
    region: regionFilter,
  }));
  if (regionFilter) attempts.push({ term: terms[terms.length - 1], region: '' });

  let anySuccess = false;
  let queries = 0;
  let rowsSeen = 0;
  let candidatesSeen = 0;

  for (const attempt of attempts.slice(0, MAX_DIRECTORY_QUERIES)) {
    const result = await options.search({
      term: attempt.term,
      region: attempt.region,
      limit: DIRECTORY_SCAN_CAP,
    });
    queries += 1;
    if (!result.ok) continue;
    anySuccess = true;
    rowsSeen += result.rows.length;
    if (result.rows.length === 0) continue;

    const candidates = result.rows
      .map(toDirectoryCandidate)
      .filter((c): c is ClinicCandidate => c !== null);
    candidatesSeen += candidates.length;
    if (candidates.length === 0) continue;

    const outcome = decideLookup(candidates, parsed.name, {
      truncated: result.total > candidates.length,
      totalCount: result.total,
      hasRegion: attempt.region !== '',
    });

    // 지역을 입력했는데 지역 필터를 뺀 시도에서 나왔다면 **그 지역의 병원이 아니다.**
    if (regionFilter && attempt.region === '') {
      return {
        usable: true,
        outcome: toRegionMiss(outcome, parsed.region, result.total > candidates.length),
        queries,
        rowsSeen,
        candidatesSeen,
        terms,
        regionUsed: parsed.region,
      };
    }
    return {
      usable: true,
      outcome,
      queries,
      rowsSeen,
      candidatesSeen,
      terms,
      regionUsed: parsed.region,
    };
  }

  return {
    usable: anySuccess,
    outcome: null,
    queries,
    rowsSeen,
    candidatesSeen,
    terms,
    regionUsed: parsed.region,
  };
}

/** 지역 필터를 뺀 결과를 region_miss 로 강등한다 (자동 확정 금지). */
function toRegionMiss(
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

/* ── 행안부 + 폴백 합성 ──────────────────────────────────── */

/**
 * 행안부 판정만으로 끝내도 되는가.
 *
 * 폴백으로 내려가는 경우는 딱 둘이다:
 *   · not_found   — 행안부가 "없다"고 했지만, 그게 장애일 수도 있다(이번 사고가 정확히 그것)
 *   · unavailable — 행안부를 아예 못 불렀다
 * 나머지(resolved·ambiguous·needs_region·region_miss·closed_only)는 행안부가 실제로
 * 자료를 보여준 것이므로 **정본을 뒤집지 않는다.**
 */
export function shouldTryDirectory(outcome: ClinicLookupOutcome): boolean {
  return outcome.kind === 'not_found' || outcome.kind === 'unavailable';
}

export interface CombinedLookup {
  readonly outcome: ClinicLookupOutcome;
  /** 폴백 명부에서 나온 결과인가 — 화면·로그에서 출처를 밝히는 데 쓴다. */
  readonly usedDirectory: boolean;
  /** 폴백까지 시도했는데 못 찾았는가 (정직한 안내 문구 판단용). */
  readonly directoryTried: boolean;
  /**
   * 폴백 경로가 실제로 어디까지 갔는지 — **운영 진단용**.
   *
   * 2026-07-28 에 "화면은 그런 병원 없음, 로그는 조용함" 상태를 밖에서 가를 방법이
   * 없어 원인 규명이 몇 시간 늘어졌다. 어느 갈래로 빠졌는지는 민감정보가 아니므로
   * 응답에 실어 다음번엔 한 번의 호출로 판정되게 한다.
   *
   *  · skipped          : 행안부 판정이 확정적이라 폴백을 타지 않았다
   *  · client_missing   : 폴백 클라이언트를 만들지 못했다(서비스 키 문제)
   *  · query_failed     : 폴백 질의가 전부 실패했다
   *  · invisible        : 질의는 됐지만 명부가 한 줄도 안 보인다(권한/RLS)
   *  · searched_no_hit  : 명부는 보이는데 이 이름이 없다 (= 진짜 없음)
   *  · hit              : 폴백이 찾아냈다
   */
  readonly directoryStage:
    | 'skipped'
    | 'client_missing'
    | 'query_failed'
    | 'invisible'
    | 'searched_no_hit'
    | 'hit';
  /** 명부 가시성 확인에서 실제로 보인 행 수 (확인하지 않았으면 null). */
  readonly directoryVisibleRows: number | null;
  /** 폴백 질의 수 / 받아온 행 수 / 후보 변환 통과 수 — 운영 진단용. */
  readonly directoryQueries: number;
  readonly directoryRowsSeen: number;
  readonly directoryCandidatesSeen: number;
  /** 실제 사용한 검색어와 지역 힌트 — 운영 진단용. */
  readonly directoryTerms: readonly string[];
  readonly directoryRegion: string;
}

/**
 * 행안부 판정 + 폴백을 합친다.
 *
 * ⚠️ 폴백이 아무것도 못 찾았을 때 **행안부의 판정을 바꾸지 않는다.**
 *    행안부가 unavailable 이었다면 결과도 unavailable 이다("조회가 원활하지 않다").
 *    그걸 not_found("그런 병원이 없다")로 바꾸면 이번 장애를 그대로 재현하는 셈이다.
 */
export async function combineWithDirectory(
  registryOutcome: ClinicLookupOutcome,
  rawName: string,
  options: {
    readonly search: DirectorySearch | null;
    readonly region?: string;
    /** 이름 검색이 0건일 때 명부 가시성을 1회 확인한다. 없으면 확인을 건너뛴다. */
    readonly probe?: DirectoryProbe | null;
  },
): Promise<CombinedLookup> {
  if (!shouldTryDirectory(registryOutcome)) {
    return {
      outcome: registryOutcome,
      usedDirectory: false,
      directoryTried: false,
      directoryStage: 'skipped',
      directoryVisibleRows: null,
      directoryQueries: 0,
      directoryRowsSeen: 0,
      directoryCandidatesSeen: 0,
      directoryTerms: [],
      directoryRegion: '',
    };
  }

  // 폴백을 아예 만들지 못했다 = 설정 장애(서비스 키 누락·무효 등).
  // 행안부의 not_found 를 그대로 내보내면 "그런 병원 없음"이 된다 — 금지.
  if (!options.search) {
    return {
      outcome: degradeUnverifiedNotFound(registryOutcome, 'search_unavailable'),
      usedDirectory: false,
      directoryTried: false,
      directoryStage: 'client_missing',
      directoryVisibleRows: null,
      directoryQueries: 0,
      directoryRowsSeen: 0,
      directoryCandidatesSeen: 0,
      directoryTerms: [],
      directoryRegion: '',
    };
  }

  const fallback = await lookupDirectory(rawName, { search: options.search, region: options.region });
  if (fallback.outcome) {
    return {
      outcome: fallback.outcome,
      usedDirectory: true,
      directoryTried: true,
      directoryStage: 'hit',
      directoryVisibleRows: null,
      directoryQueries: fallback.queries,
      directoryRowsSeen: fallback.rowsSeen,
      directoryCandidatesSeen: fallback.candidatesSeen,
      directoryTerms: fallback.terms,
      directoryRegion: fallback.regionUsed,
    };
  }
  // 폴백 쿼리가 **전부 실패**했다면 "폴백에도 없다"가 아니라 "확인하지 못했다"이다.
  if (!fallback.usable) {
    return {
      outcome: degradeUnverifiedNotFound(registryOutcome, 'query_failed'),
      usedDirectory: false,
      directoryTried: false,
      directoryStage: 'query_failed',
      directoryVisibleRows: null,
      directoryQueries: fallback.queries,
      directoryRowsSeen: fallback.rowsSeen,
      directoryCandidatesSeen: fallback.candidatesSeen,
      directoryTerms: fallback.terms,
      directoryRegion: fallback.regionUsed,
    };
  }

  /**
   * 여기까지 왔다 = 질의는 전부 성공했는데 이름으로 한 건도 못 찾았다.
   * 대부분은 정말 없는 병원이지만, **명부 자체가 안 보이는 상태**도 똑같이 생겼다.
   * clinic_directory 는 RLS 활성 + SELECT 정책 없음이라 service_role 이 아닌 키로
   * 읽으면 PostgREST 가 **오류 없이 200 + 빈 배열**을 준다(마이그 057 에서 확인).
   * 그 둘을 가르지 않으면 설정 사고가 "그런 병원 없음"으로 둔갑한다.
   * 그래서 이 경로에서만 명부 가시성을 1회 확인한다.
   */
  let visibleRows: number | null = null;
  if (options.probe) {
    const probe = await options.probe();
    visibleRows = probe.ok ? probe.visibleRows : null;
    if (!probe.ok || probe.visibleRows === 0) {
      return {
        outcome: degradeUnverifiedNotFound(registryOutcome, 'directory_invisible'),
        usedDirectory: false,
        directoryTried: false,
        directoryStage: 'invisible',
        directoryVisibleRows: visibleRows,
        directoryQueries: fallback.queries,
        directoryRowsSeen: fallback.rowsSeen,
        directoryCandidatesSeen: fallback.candidatesSeen,
        directoryTerms: fallback.terms,
        directoryRegion: fallback.regionUsed,
      };
    }
  }
  return {
    outcome: registryOutcome,
    usedDirectory: false,
    directoryTried: fallback.usable,
    directoryStage: 'searched_no_hit',
    directoryVisibleRows: visibleRows,
    directoryQueries: fallback.queries,
    directoryRowsSeen: fallback.rowsSeen,
    directoryCandidatesSeen: fallback.candidatesSeen,
    directoryTerms: fallback.terms,
    directoryRegion: fallback.regionUsed,
  };
}

/**
 * 폴백을 **확인하지 못한** 상태에서 행안부의 not_found 를 그대로 내보내지 않는다.
 *
 * ★ 근거는 2026-07-27 사고다 — 행안부가 HTTP 200 + 0건을 주는 동안 실존 병원
 *   12곳이 전부 "그런 병원 없음"으로 표시됐다. 폴백은 정본이 0건일 때 **판정을
 *   뒤집을 수 있는 유일한 근거**이므로, 그것을 확인하지 못한 채로는 "없다"고
 *   말할 자격이 없다.
 *
 *   ⚠️ 이 방어를 2026-07-28 에 넣으면서 "그날도 같은 장애가 재발 중"이라고 적었으나
 *      **그건 오진이었다**(요청 인코딩이 깨져 있었을 뿐, 프로덕션은 정상이었다).
 *      방어 자체는 7/27 사고에 대해 여전히 타당해서 유지한다.
 *
 * 행안부가 이미 unavailable 이었다면 그대로 둔다(사유가 더 구체적이다).
 * 폴백이 정상 동작해 "정말 없음"을 확인한 경로는 여기로 오지 않는다.
 */
function degradeUnverifiedNotFound(
  registryOutcome: ClinicLookupOutcome,
  cause: 'search_unavailable' | 'query_failed' | 'directory_invisible',
): ClinicLookupOutcome {
  if (registryOutcome.kind !== 'not_found') return registryOutcome;
  console.error(
    `[clinic-diagnosis/directory] 폴백 확인 불가(${cause}) — not_found 를 unavailable 로 강등한다. ` +
      '운영 확인 필요: SUPABASE_SERVICE_ROLE_KEY 및 clinic_directory 접근.',
  );
  return { kind: 'unavailable', reason: 'fetch_failed' };
}
