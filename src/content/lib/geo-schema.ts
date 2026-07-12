/**
 * GEO Phase A — 생성 글 JSON-LD 스키마 파생 (순수 로직 모듈).
 *
 * 역할:
 *  1) 생성 본문의 구조 블록 파싱 — [핵심 요약]·[자주 묻는 질문](Q1./A1.)·[이미지 N]
 *  2) 파싱 결과 + 병원 프로필(공개 사실정보)로 JSON-LD 파생
 *     - Article  : headline·description·author·datePublished
 *     - FAQPage  : 본문에 실재하는 Q/A 만 파생 (없으면 생략)
 *     - MedicalClinic : 병원명·진료과·지역 (프로필 공개 사실정보만)
 *  3) <script type="application/ld+json"> 삽입용 직렬화 (</ 시퀀스 이스케이프)
 *
 * ⚠️ 가드(중대): 스키마의 모든 텍스트는 본문/프로필에서 "파생"만 한다.
 *    이 모듈은 어떤 문구도 새로 만들지 않는다 — 본문에 없는 효과단정·비교·
 *    최상급 표현이 스키마에 등장할 수 없다. 매출·방문자 수치도 다루지 않는다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 * (geo-tracking.ts 패턴)
 */

// ---------------------------------------------------------------------------
// 입력 타입
// ---------------------------------------------------------------------------

export interface GeoSchemaPost {
  title: string;
  /** 생성 본문 원문 — 플레인 텍스트 + 구조 마커([핵심 요약]/[자주 묻는 질문]/[이미지 N]) */
  content: string;
  /** 발행 시각(ISO). 없으면 저장 시각 등으로 대체 가능, 파싱 불가면 필드 생략 */
  publishedAt?: string | null;
}

export interface GeoHospitalProfile {
  hospitalName: string | null;
  /** 진료과 (profiles.hospital_type — 피부과/치과 등 공개 사실정보) */
  specialty: string | null;
  /** 지역 (profiles.region — 강남구/수성구 등) */
  region: string | null;
  /** 주소 (profiles.hospital_address) — 없으면 생략 */
  address?: string | null;
}

export interface FaqItem {
  question: string;
  answer: string;
}

// ---------------------------------------------------------------------------
// 1) 본문 구조 블록 파싱
// ---------------------------------------------------------------------------

const SUMMARY_BLOCK_RE = /\[핵심 요약\]([\s\S]*?)\[\/핵심 요약\]/;
const FAQ_BLOCK_RE = /\[자주 묻는 질문\]([\s\S]*?)\[\/자주 묻는 질문\]/;
const IMAGE_PLACEHOLDER_RE = /\[이미지\s*\d+\s*:[^\]]*\]/g;

/** 메타 설명 최대 길이(자) — 검색·AI 발췌 관행 기준 */
export const META_DESCRIPTION_MAX = 160;

/** [핵심 요약] 블록의 줄들을 추출한다. 블록이 없으면 빈 배열. */
export function extractSummaryLines(content: string): string[] {
  const match = SUMMARY_BLOCK_RE.exec(content ?? '');
  if (!match) return [];
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * [자주 묻는 질문] 블록에서 Q/A 쌍을 추출한다.
 * 본문에 실재하는 완결 쌍(질문·답변 모두 비어있지 않음)만 반환 — 없으면 빈 배열.
 */
export function extractFaqItems(content: string): FaqItem[] {
  const block = FAQ_BLOCK_RE.exec(content ?? '');
  if (!block) return [];

  const items: FaqItem[] = [];
  // Qn. 질문 (한 줄) ↵ An. 답변 (다음 Q 또는 블록 끝까지, 여러 줄 허용)
  const pairRe = /Q(\d+)[.)]\s*([^\n]+)\n+A\1[.)]\s*([\s\S]*?)(?=\n\s*Q\d+[.)]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(block[1])) !== null) {
    const question = m[2].trim();
    const answer = m[3].replace(/\s+/g, ' ').trim();
    if (question && answer) {
      items.push({ question, answer });
    }
  }
  return items;
}

/** [이미지 N: …] 플레이스홀더를 제거한 본문을 반환한다. */
export function stripImagePlaceholders(content: string): string {
  return (content ?? '').replace(IMAGE_PLACEHOLDER_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** 요약·FAQ 블록과 이미지 플레이스홀더를 제거한 순수 본문. */
export function stripStructureBlocks(content: string): string {
  return stripImagePlaceholders(
    (content ?? '')
      .replace(SUMMARY_BLOCK_RE, '')
      .replace(FAQ_BLOCK_RE, ''),
  );
}

/**
 * 메타 설명(meta description)을 본문에서 파생한다 — 새 문구 생성 없음.
 * 우선순위: [핵심 요약] 줄 결합 → 첫 단락. 길이 상한 초과 시 말줄임.
 */
export function buildMetaDescription(content: string): string {
  const summary = extractSummaryLines(content);
  const source = summary.length > 0
    ? summary.join(' ')
    : (stripStructureBlocks(content).split(/\n{2,}/)[0] ?? '').replace(/\s+/g, ' ').trim();
  if (source.length <= META_DESCRIPTION_MAX) return source;
  return `${source.slice(0, META_DESCRIPTION_MAX - 1)}…`;
}

// ---------------------------------------------------------------------------
// 2) JSON-LD 파생
// ---------------------------------------------------------------------------

export type JsonLdObject = Record<string, unknown>;

const SCHEMA_CONTEXT = 'https://schema.org';

function normalized(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** ISO 파싱 가능한 발행 시각만 통과 — 불가하면 null(필드 생략). */
function safeIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

/** Article 스키마 — headline·description 은 제목·본문에서 파생. */
export function buildArticleSchema(
  post: GeoSchemaPost,
  profile: GeoHospitalProfile,
): JsonLdObject {
  const hospitalName = normalized(profile.hospitalName);
  const datePublished = safeIsoDate(post.publishedAt);

  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Article',
    headline: normalized(post.title),
    description: buildMetaDescription(post.content),
    inLanguage: 'ko',
    ...(hospitalName
      ? { author: { '@type': 'Organization', name: hospitalName } }
      : {}),
    ...(datePublished ? { datePublished } : {}),
  };
}

/**
 * FAQPage 스키마 — 본문 [자주 묻는 질문] 블록에 실재하는 Q/A 에서만 파생.
 * FAQ 가 없으면 null (스키마 생략).
 */
export function buildFaqPageSchema(faqItems: ReadonlyArray<FaqItem>): JsonLdObject | null {
  const valid = faqItems.filter((f) => f.question.trim() && f.answer.trim());
  if (valid.length === 0) return null;

  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'FAQPage',
    mainEntity: valid.map((f) => ({
      '@type': 'Question',
      name: f.question.trim(),
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answer.trim(),
      },
    })),
  };
}

/**
 * MedicalClinic 스키마 — 프로필의 공개 사실정보(병원명·진료과·지역·주소)만 사용.
 * 병원명이 없으면 null (스키마 생략). 매출·방문자 등 수치는 어떤 경우에도 없음.
 */
export function buildMedicalClinicSchema(profile: GeoHospitalProfile): JsonLdObject | null {
  const hospitalName = normalized(profile.hospitalName);
  if (!hospitalName) return null;

  const specialty = normalized(profile.specialty);
  const region = normalized(profile.region);
  const address = normalized(profile.address);

  const postalAddress: JsonLdObject | null = region || address
    ? {
        '@type': 'PostalAddress',
        ...(address ? { streetAddress: address } : {}),
        ...(region ? { addressLocality: region } : {}),
        addressCountry: 'KR',
      }
    : null;

  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'MedicalClinic',
    name: hospitalName,
    ...(specialty ? { medicalSpecialty: specialty } : {}),
    ...(postalAddress ? { address: postalAddress } : {}),
  };
}

/**
 * 글 1편의 JSON-LD 묶음을 파생한다.
 * Article 은 항상, FAQPage 는 본문에 FAQ 가 실재할 때만, MedicalClinic 은
 * 병원명이 있을 때만 포함된다.
 */
export function buildGeoSchemas(
  post: GeoSchemaPost,
  profile: GeoHospitalProfile,
): JsonLdObject[] {
  const schemas: JsonLdObject[] = [buildArticleSchema(post, profile)];

  const faqSchema = buildFaqPageSchema(extractFaqItems(post.content));
  if (faqSchema) schemas.push(faqSchema);

  const clinicSchema = buildMedicalClinicSchema(profile);
  if (clinicSchema) schemas.push(clinicSchema);

  return schemas;
}

// ---------------------------------------------------------------------------
// 3) 직렬화 (XSS 가드)
// ---------------------------------------------------------------------------

/**
 * JSON-LD 를 <script type="application/ld+json"> 삽입용 문자열로 직렬화한다.
 *
 * XSS 가드: 본문 텍스트에 "</script" 시퀀스가 있으면 script 블록이 조기
 * 종료되므로, 모든 "</" 를 "<\/" 로 치환한다 ("\/" 는 유효한 JSON 이스케이프
 * 라 파싱 결과는 동일). 스키마 1개면 객체, 여러 개면 배열로 직렬화.
 */
export function serializeJsonLd(schemas: ReadonlyArray<JsonLdObject>): string {
  const payload: unknown = schemas.length === 1 ? schemas[0] : [...schemas];
  return JSON.stringify(payload, null, 2).replace(/<\//g, '<\\/');
}
