/**
 * 진료과 보정 — 행안부 표기를 심평원 명부(clinic_directory)로 덮어쓴다.
 *
 * ## 왜 필요한가 (2026-08-05 실측)
 *
 * 병원 특정의 정본은 행정안전부 인허가 자료다(폐업·주소 최신성이 가장 좋다).
 * 그런데 그 자료의 `MDCR_SBJT_CONT`(진료과목)는 **개설 신고 순서**라서
 * 대표 과목이 첫 번째로 오지 않는다. `pickSpecialty()` 는 첫 번째 값을 쓰므로
 * 아래처럼 원장이 보면 바로 틀린 줄 아는 값이 화면에 나갔다.
 *
 * | 병원 | 행안부 기준 표시 | 실제(심평원 표시과목) |
 * |---|---|---|
 * | 신암카톨릭비뇨기과의원 | 피부과 | 비뇨의학과 |
 * | 칠곡제이(J)성형외과의원 | 신경외과 | 성형외과 |
 * | 올포스킨피부과의원 | 내과 | 피부과 |
 * | 시티여성의원 | 성형외과 | 산부인과 |
 * | 9988정형외과의원 | 내과 | 정형외과 |
 *
 * 무료 진단은 원장이 우리를 처음 만나는 화면이다. 자기 병원 진료과가 틀린 채로
 * 나오면 그 뒤에 무슨 분석을 붙여도 읽히지 않는다.
 *
 * ## 원칙
 *
 * - **보정은 진료과 한 필드만 한다.** 주소·전화·영업상태는 행안부가 정본이다.
 * - 이름(공백 제거·소문자)과 시·도가 **둘 다** 맞을 때만 바꾼다.
 * - 같은 이름이 그 시·도에 여러 곳이면 **바꾸지 않는다**(엉뚱한 과로 덮어쓰는 것이
 *   틀린 채 두는 것보다 나쁘다).
 * - 명부 조회가 실패하거나 느리면 조용히 원본을 쓴다 — 보정 때문에 진단이 멈추면 안 된다.
 * - 치과의원·한의원은 기관 종별로 이미 확정되므로 건드리지 않는다.
 */
import { normalizeClinicName } from './registry.ts';
import type { ClinicCandidate } from './types.ts';

/** 명부 조회 타임아웃. 진단 전체 시간에 얹히는 값이라 짧게 잡는다. */
export const REFINE_TIMEOUT_MS = 3_000;

/** 명부 응답 상한 — 넘으면 잘린 결과로 판단하게 되므로 보정을 포기한다. */
export const ROW_LIMIT = 200;

/** 종별로 진료과가 확정되는 기관 — 보정 대상이 아니다. */
const TYPE_FIXED = new Set(['치과의원', '치과병원', '한의원', '한방병원']);

interface DirectoryRow {
  readonly name_norm: string;
  readonly province: string;
  readonly specialty: string;
  readonly institution_type?: string | null;
}

/**
 * 시·도 표기 통일. 같은 곳인데 표기가 달라 보정이 조용히 실패하는 것을 막는다
 * ("서울"↔"서울특별시", "강원도"↔"강원특별자치도", "전라북도"↔"전북특별자치도" 등).
 */
const PROVINCE_ALIASES: Readonly<Record<string, string>> = {
  서울: '서울', 서울특별시: '서울',
  부산: '부산', 부산광역시: '부산',
  대구: '대구', 대구광역시: '대구',
  인천: '인천', 인천광역시: '인천',
  광주: '광주', 광주광역시: '광주',
  대전: '대전', 대전광역시: '대전',
  울산: '울산', 울산광역시: '울산',
  세종: '세종', 세종시: '세종', 세종특별자치시: '세종',
  경기: '경기', 경기도: '경기',
  강원: '강원', 강원도: '강원', 강원특별자치도: '강원',
  충북: '충북', 충청북도: '충북',
  충남: '충남', 충청남도: '충남',
  전북: '전북', 전라북도: '전북', 전북특별자치도: '전북',
  전남: '전남', 전라남도: '전남',
  경북: '경북', 경상북도: '경북',
  경남: '경남', 경상남도: '경남',
  제주: '제주', 제주도: '제주', 제주특별자치도: '제주',
};

export function normalizeProvince(value: string): string {
  const compact = (value ?? '').replace(/\s+/g, '');
  return PROVINCE_ALIASES[compact] ?? compact;
}

/** 기관 종별 표기 통일 — 병원/의원 등 규모 표기는 떼고 계열만 본다. */
function normalizeInstitutionType(value: string | null | undefined): string {
  const compact = (value ?? '').replace(/\s+/g, '');
  if (!compact) return '';
  if (compact.includes('치과')) return '치과';
  if (compact.includes('한의') || compact.includes('한방')) return '한방';
  return '일반';
}

/** 명부 조회기. 테스트에서 갈아끼운다. */
export type SpecialtyLookup = (nameNorms: readonly string[]) => Promise<readonly DirectoryRow[]>;

/**
 * Supabase 는 **동적 import** 로 가져온다 — 이 모듈의 순수 로직이
 * 테스트 러너(node --test)에서 경로 별칭 없이 로드될 수 있어야 한다.
 */
export async function createSpecialtyLookup(
  timeoutMs: number = REFINE_TIMEOUT_MS,
): Promise<SpecialtyLookup | null> {
  let admin: Awaited<ReturnType<typeof import('@/dev/lib/supabase/server')['createAdminClient']>>;
  try {
    const { createAdminClient } = await import('@/dev/lib/supabase/server');
    admin = createAdminClient();
  } catch (e) {
    console.error(
      '[clinic-diagnosis/specialty] 명부 클라이언트 생성 실패:',
      e instanceof Error ? e.message : e,
    );
    return null;
  }
  return async (nameNorms) => {
    if (nameNorms.length === 0) return [];
    const { data, error } = await admin
      .from('clinic_directory')
      .select('name_norm,province,specialty,institution_type')
      .in('name_norm', nameNorms as string[])
      // 상한을 넘겨 일부만 돌아오면 "충돌 없음"으로 오판해 잘못 덮어쓸 수 있다.
      // 넉넉히 받아 두고, 넘치면 아래에서 보정을 통째로 포기한다.
      .limit(ROW_LIMIT + 1)
      .abortSignal(AbortSignal.timeout(Math.max(1, timeoutMs)));
    if (error) {
      console.warn('[clinic-diagnosis/specialty] 명부 조회 실패:', error.message);
      return [];
    }
    const rows = (data ?? []) as DirectoryRow[];
    if (rows.length > ROW_LIMIT) {
      console.warn('[clinic-diagnosis/specialty] 명부 응답이 상한 초과 — 보정 생략');
      return [];
    }
    return rows;
  };
}

/** 보정 후보인가 — 종별 확정 기관과 빈 이름은 제외. */
function isRefinable(c: ClinicCandidate): boolean {
  return !TYPE_FIXED.has(c.institutionType ?? '') && normalizeClinicName(c.name).length >= 2;
}

/**
 * 후보들의 진료과를 명부 값으로 보정한다. 원본 배열은 건드리지 않는다.
 * 바꿀 근거가 없으면 그대로 돌려준다 — 실패는 조용히 넘어간다.
 */
export async function refineSpecialties(
  candidates: readonly ClinicCandidate[],
  /** 생략하면 기본 조회기를 만든다. `null` 을 명시하면 보정을 건너뛴다. */
  lookupArg?: SpecialtyLookup | null,
): Promise<readonly ClinicCandidate[]> {
  if (candidates.length === 0) return candidates;
  const targets = candidates.filter(isRefinable);
  if (targets.length === 0) return candidates;
  const lookup = lookupArg === undefined ? await createSpecialtyLookup() : lookupArg;
  if (!lookup) return candidates;

  const norms = Array.from(new Set(targets.map((c) => normalizeClinicName(c.name))));
  let rows: readonly DirectoryRow[];
  try {
    rows = await lookup(norms);
  } catch (e) {
    console.warn(
      '[clinic-diagnosis/specialty] 보정 생략:',
      e instanceof Error ? e.message : e,
    );
    return candidates;
  }
  if (rows.length === 0) return candidates;

  /**
   * (이름, 시·도, 종별) → 진료과.
   *
   * ★같은 키에 행이 **둘 이상이면 과가 같더라도 버린다.** 우리는 이름·시·도·종별만으로
   * 매칭하므로, 그 키에 병원이 여럿이면 지금 보고 있는 병원이 그중 어느 곳인지 알 수 없다.
   * 과가 우연히 같아도 "행안부 후보는 사실 제3의 병원"일 수 있어 잘못된 과를 씌우게 된다.
   * 틀린 채 두는 것보다 엉뚱하게 덮어쓰는 쪽이 나쁘다(Codex 지적, 2026-08-05).
   */
  const byKey = new Map<string, string | null>();
  for (const row of rows) {
    const specialty = (row.specialty ?? '').trim();
    const key = [
      row.name_norm,
      normalizeProvince(row.province ?? ''),
      normalizeInstitutionType(row.institution_type),
    ].join('|');
    if (!specialty) {
      byKey.set(key, null);
      continue;
    }
    byKey.set(key, byKey.has(key) ? null : specialty);
  }
  if (byKey.size === 0) return candidates;

  return candidates.map((c) => {
    if (!isRefinable(c)) return c;
    const key = [
      normalizeClinicName(c.name),
      normalizeProvince(c.province ?? ''),
      normalizeInstitutionType(c.institutionType),
    ].join('|');
    const specialty = byKey.get(key);
    if (!specialty || specialty === c.specialty) return c;
    return { ...c, specialty };
  });
}
