/**
 * 병원 서브도메인 블로그 — 저자 바이라인 + Physician 스키마 파생 (순수 로직 모듈).
 *
 * ⚠️ 컴플라이언스 대원칙(중대): 자격을 지어내지 않는다 — 프로필의 사실만 쓴다.
 *  - profiles.position 이 임상 역할(원장·부원장)이고 full_name 이 있을 때에만
 *    저자를 그 인물(Person)로 표기한다: "작성: {full_name} {position}".
 *  - position 이 마케터·원무·간호사·기타이거나 full_name 이 없으면 저자를
 *    병원(Organization)으로 표기한다 — 의사인 척(개인 저자) 하지 않는다.
 *  - '전문의'·board certified 등 검증 불가 자격은 어떤 경우에도 자동 삽입하지
 *    않는다. hospital_type(진료과)은 '병원의 진료과'일 뿐, 그 인물의 전문의
 *    자격 증명이 아니므로 인물 자격 단정에 쓰지 않는다.
 *  - Physician 스키마는 임상 역할일 때에만 파생하며, medicalSpecialty 는
 *    hospital_type 을 '병원의 진료과(진료 분야)'로만 반영한다.
 *
 * 스키마-본문 일치 원칙: 여기서 만든 바이라인 텍스트가 페이지/발행본에 실제로
 * 보일 때에만 JSON-LD author/Physician 에도 대응 값이 들어간다(호출부가 함께 렌더).
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

export type JsonLdObject = Record<string, unknown>;

const SCHEMA_CONTEXT = 'https://schema.org';

/** 저자를 개인(Person/Physician)으로 표기할 수 있는 임상 역할. */
export const CLINICAL_ROLES = ['원장', '부원장'] as const;
export type ClinicalRole = (typeof CLINICAL_ROLES)[number];

/** position 이 임상 역할(원장·부원장)인지 판정한다. */
export function isClinicalRole(position: string | null | undefined): position is ClinicalRole {
  const p = (position ?? '').trim();
  return (CLINICAL_ROLES as readonly string[]).includes(p);
}

export interface BylineInput {
  /** 가입자 이름 (profiles.full_name) */
  fullName: string | null | undefined;
  /** 직책 (profiles.position — 원장/부원장/간호사/원무/마케터/기타) */
  position: string | null | undefined;
  /** 병원명 (profiles.hospital_name) — 조직 저자·소속명 */
  hospitalName: string | null | undefined;
  /** 진료과 (profiles.hospital_type) — '병원의 진료과'로만 사용 */
  specialty: string | null | undefined;
}

/**
 * 저자 귀속(attribution).
 *  - person : 임상 역할 + 이름이 있을 때 (개인 저자)
 *  - organization : 그 외 — 병원명이 있을 때 (조직 저자)
 *  - null : 병원명조차 없어 표기할 저자가 없음 (바이라인·author 생략)
 */
export type AuthorAttribution =
  | {
      readonly type: 'person';
      readonly personName: string;
      readonly roleLabel: ClinicalRole;
      readonly hospitalName: string;
      readonly specialty: string;
    }
  | { readonly type: 'organization'; readonly orgName: string }
  | null;

/**
 * 프로필 사실정보로 저자 귀속을 결정한다.
 * 임상 역할(원장·부원장) + 이름이 있을 때만 개인, 그 외엔 병원(조직).
 */
export function resolveAuthorAttribution(input: BylineInput): AuthorAttribution {
  const fullName = (input.fullName ?? '').trim();
  const hospitalName = (input.hospitalName ?? '').trim();
  const specialty = (input.specialty ?? '').trim();

  if (isClinicalRole(input.position) && fullName) {
    return {
      type: 'person',
      personName: fullName,
      roleLabel: (input.position ?? '').trim() as ClinicalRole,
      hospitalName,
      specialty,
    };
  }
  if (hospitalName) {
    return { type: 'organization', orgName: hospitalName };
  }
  return null;
}

/**
 * 화면·발행본 하단에 노출할 바이라인 텍스트. 표기할 저자가 없으면 null.
 *  - person       : "작성: {이름} {직책}"  (예: "작성: 김석종 원장")
 *  - organization : "작성: {병원명}"
 */
export function formatBylineText(attribution: AuthorAttribution): string | null {
  if (!attribution) return null;
  if (attribution.type === 'person') {
    return `작성: ${attribution.personName} ${attribution.roleLabel}`;
  }
  return `작성: ${attribution.orgName}`;
}

/**
 * Article.author 로 넣을 JSON-LD 노드. 표기할 저자가 없으면 null(필드 생략).
 *  - person       : Person (name=이름, jobTitle=직책 — 둘 다 프로필 사실정보)
 *  - organization : Organization (name=병원명)
 */
export function buildAuthorNode(attribution: AuthorAttribution): JsonLdObject | null {
  if (!attribution) return null;
  if (attribution.type === 'person') {
    return {
      '@type': 'Person',
      name: attribution.personName,
      jobTitle: attribution.roleLabel,
    };
  }
  return {
    '@type': 'Organization',
    name: attribution.orgName,
  };
}

/**
 * Physician 스키마 — 저자가 임상 역할(개인)일 때에만 파생한다. 그 외엔 null.
 *  - name           : 인물 이름 (프로필 full_name)
 *  - jobTitle       : 직책 (원장/부원장 — 프로필 position)
 *  - affiliation    : 소속 MedicalClinic(병원명) — 병원명이 있을 때만
 *  - medicalSpecialty: hospital_type 을 '병원의 진료과(진료 분야)'로만 —
 *                      전문의 자격 등 인물 자격 단정은 하지 않는다.
 */
export function buildPhysicianSchema(attribution: AuthorAttribution): JsonLdObject | null {
  if (!attribution || attribution.type !== 'person') return null;

  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Physician',
    name: attribution.personName,
    jobTitle: attribution.roleLabel,
    ...(attribution.hospitalName
      ? { affiliation: { '@type': 'MedicalClinic', name: attribution.hospitalName } }
      : {}),
    ...(attribution.specialty ? { medicalSpecialty: attribution.specialty } : {}),
  };
}
