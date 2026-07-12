/**
 * 병원 서브도메인 블로그 — 브랜드킷 자동 테마 (순수 로직 모듈).
 *
 * 회원이 마이페이지에 이미 등록한 브랜드킷(로고·브랜드 컬러)·병원 사진·병원 소개를
 * 공개 블로그 테마로 변환한다. 병원이 추가 작업할 것은 없다 — 등록된 데이터만 쓰고,
 * 미등록 항목은 전부 null 로 남겨 기본 디자인을 유지한다.
 *
 * 컴플라이언스 (중대):
 *  - 의료진(staff) 사진은 consent=true 통과분만 공개한다 (clinicflix convert 와 동일 정책).
 *  - 원장 사진은 profiles.clinic_doctor_consent=true 일 때만 공개한다.
 *  - 화이트리스트에 없는 카테고리(전후사진류 등 미래 추가 포함)는 무조건 제외한다.
 *
 * 보안:
 *  - 브랜드 컬러는 #RRGGBB 형식 검증 통과분만 인라인 style 로 쓴다 (CSS 인젝션 차단).
 *    실패 시 폴백은 중립 색(#2b6cb0) — 닥터포스트 코랄을 병원 블로그에 강제하지 않는다.
 *  - 로고·사진 URL 은 자체 Supabase 'clinic-assets' public 버킷 경로만 허용한다.
 *
 * ⚠️ 러너 제약(slug.ts 패턴): node --experimental-strip-types 테스트 러너가
 *    별칭·상대 경로 해석 없이 로드할 수 있도록 값 import 없이 한 파일로 유지한다.
 */

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/** 브랜드 컬러 허용 형식 — #RRGGBB 만 (인라인 style 인젝션 차단). */
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * 브랜드 컬러 미등록·검증 실패 시 내부 폴백 색.
 * 닥터포스트 코랄(#ff4628)은 닥포 브랜드라 병원 블로그에 쓰지 않는다.
 * (hasBrandColor=false 면 페이지는 액센트를 아예 적용하지 않으므로 화면에 노출되지 않는다.)
 */
export const NEUTRAL_ACCENT_COLOR = '#2b6cb0';

/** 홈 하단 "병원 둘러보기" 그리드 사진 수 상한 — 초과분은 무시. */
export const CLINIC_GALLERY_LIMIT = 6;

/** 병원 소개 공개 표시 길이 상한 (CSS clamp 와 별개의 데이터 상한). */
export const CLINIC_DESC_MAX_LENGTH = 300;

/**
 * 공개 블로그에 노출 가능한 사진 카테고리 화이트리스트 (마이그 024 clinic_photos.category).
 * 목록에 없는 카테고리(전후사진류 등 미래 추가 포함)는 무조건 제외한다.
 */
export const PUBLIC_PHOTO_CATEGORIES: ReadonlySet<string> = new Set([
  'exterior',
  'interior',
  'equipment',
  'staff',
  'etc',
]);

/** 인물(의료진) 사진 카테고리 — 게시 동의(consent=true) 통과분만 공개. */
export const CONSENT_REQUIRED_CATEGORIES: ReadonlySet<string> = new Set(['staff']);

/** 히어로(대표 이미지)로 쓸 카테고리 우선순위 — 시설 사진만, 인물(staff)은 히어로 금지. */
const HERO_CATEGORY_PRIORITY: readonly string[] = ['exterior', 'interior', 'equipment', 'etc'];

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

/** clinic_photos 한 장 — 테마 판정에 필요한 컬럼만. */
export interface PublicClinicPhoto {
  category: string;
  url: string;
  consent: boolean;
}

/** 테마 원천 데이터 (DB 조회 결과 — theme-data.ts 가 채운다). */
export interface ClinicThemeSource {
  /** profiles.clinic_brand_color */
  brandColor: string | null;
  /** profiles.clinic_logo_url */
  logoUrl: string | null;
  /** profiles.clinic_doctor_photo_url */
  doctorPhotoUrl: string | null;
  /** profiles.clinic_doctor_consent — 원장 미디어 공개 동의 */
  doctorConsent: boolean;
  /** profiles.hospital_desc — 병원 소개 */
  description: string | null;
  /** clinic_photos 목록 (오래된 순 권장 — 첫 업로드가 대표성 높음) */
  photos: readonly PublicClinicPhoto[];
  /** NEXT_PUBLIC_SUPABASE_URL — URL 허용 도메인 판정용. null 이면 에셋 전부 거부 */
  supabaseUrl: string | null;
}

/** 공개 페이지가 소비하는 최종 테마. 미등록 항목은 null / 빈 배열. */
export interface ClinicTheme {
  /** 검증 통과한 브랜드 컬러, 없으면 NEUTRAL_ACCENT_COLOR (화면 적용은 hasBrandColor 게이트) */
  accentColor: string;
  /** 브랜드 컬러가 실제 등록·검증 통과했는지 — 액센트 적용 게이트 */
  hasBrandColor: boolean;
  /** 흰 배경 위 텍스트 색으로 써도 가독되는지 (아니면 보더·뱃지 포인트로만) */
  accentTextSafe: boolean;
  logoUrl: string | null;
  heroUrl: string | null;
  galleryUrls: readonly string[];
  description: string | null;
}

/** 아무것도 등록 안 된 병원 / 조회 실패 시 테마 — 기본 디자인 그대로. */
export const EMPTY_CLINIC_THEME: ClinicTheme = {
  accentColor: NEUTRAL_ACCENT_COLOR,
  hasBrandColor: false,
  accentTextSafe: true,
  logoUrl: null,
  heroUrl: null,
  galleryUrls: [],
  description: null,
};

// ---------------------------------------------------------------------------
// 브랜드 컬러 — 형식 검증 + 명도 대비
// ---------------------------------------------------------------------------

/** #RRGGBB 검증 통과 시 소문자 정규화 hex, 실패 시 null. */
export function sanitizeBrandColor(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return HEX_COLOR_RE.test(value) ? value.toLowerCase() : null;
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 상대 휘도 (0=검정, 1=흰색). 형식 불일치 시 null. */
export function relativeLuminance(hex: string): number | null {
  if (!HEX_COLOR_RE.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/** 흰 배경 대비 3:1 이상이면 텍스트 색으로 허용 (미만이면 보더·뱃지 포인트만). */
export function isAccentTextReadableOnWhite(hex: string): boolean {
  const lum = relativeLuminance(hex);
  if (lum === null) return false;
  return 1.05 / (lum + 0.05) >= 3;
}

// ---------------------------------------------------------------------------
// 에셋 URL — 자체 Supabase 스토리지만 허용
// ---------------------------------------------------------------------------

/**
 * 로고·사진 URL 이 자체 Supabase 'clinic-assets' public 버킷 경로인지 판정한다.
 * 외부 URL 이 저장돼 있으면(과거 데이터·조작 등) 무시한다.
 */
export function isAllowedClinicAssetUrl(
  url: string | null | undefined,
  supabaseUrl: string | null | undefined,
): url is string {
  if (typeof url !== 'string' || !supabaseUrl) return false;
  const base = supabaseUrl.trim().replace(/\/+$/, '');
  if (!base.startsWith('https://')) return false;
  const prefix = `${base}/storage/v1/object/public/clinic-assets/`;
  return url.startsWith(prefix) && url.length > prefix.length;
}

// ---------------------------------------------------------------------------
// 병원 소개
// ---------------------------------------------------------------------------

/** 공백 정규화 + 길이 상한. 내용 없으면 null (섹션 자체 생략). */
export function sanitizeClinicDescription(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;
  if (collapsed.length <= CLINIC_DESC_MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, CLINIC_DESC_MAX_LENGTH)}…`;
}

// ---------------------------------------------------------------------------
// 사진 필터링 — 컴플라이언스 게이트 + 히어로/갤러리 선정
// ---------------------------------------------------------------------------

/**
 * 공개 가능 사진만 남긴다 (순서 보존·URL 중복 제거).
 *  - 화이트리스트 외 카테고리 제외 (전후사진류 방어)
 *  - 인물(staff) 사진은 consent=true 만
 *  - 자체 스토리지 URL 만
 */
export function filterPublicPhotos(
  photos: readonly PublicClinicPhoto[],
  supabaseUrl: string | null,
): PublicClinicPhoto[] {
  const seen = new Set<string>();
  const result: PublicClinicPhoto[] = [];
  for (const photo of photos) {
    if (!PUBLIC_PHOTO_CATEGORIES.has(photo.category)) continue;
    if (CONSENT_REQUIRED_CATEGORIES.has(photo.category) && photo.consent !== true) continue;
    if (!isAllowedClinicAssetUrl(photo.url, supabaseUrl)) continue;
    if (seen.has(photo.url)) continue;
    seen.add(photo.url);
    result.push(photo);
  }
  return result;
}

/** 히어로 1장 선정 — 시설 카테고리 우선순위. 인물(staff)은 절대 히어로가 되지 않는다. */
export function pickHeroUrl(publicPhotos: readonly PublicClinicPhoto[]): string | null {
  for (const category of HERO_CATEGORY_PRIORITY) {
    const found = publicPhotos.find((p) => p.category === category);
    if (found) return found.url;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 테마 조립
// ---------------------------------------------------------------------------

/**
 * 원천 데이터를 공개 테마로 변환한다. 모든 항목이 독립적으로 graceful —
 * 하나도 등록 안 된 병원은 EMPTY_CLINIC_THEME 과 동등한 값이 되어 기본 디자인이 유지된다.
 */
export function buildClinicTheme(src: ClinicThemeSource): ClinicTheme {
  const brand = sanitizeBrandColor(src.brandColor);
  const accentColor = brand ?? NEUTRAL_ACCENT_COLOR;

  const logoUrl = isAllowedClinicAssetUrl(src.logoUrl, src.supabaseUrl) ? src.logoUrl : null;

  const publicPhotos = filterPublicPhotos(src.photos, src.supabaseUrl);
  const heroUrl = pickHeroUrl(publicPhotos);

  const galleryCandidates = publicPhotos.filter((p) => p.url !== heroUrl).map((p) => p.url);
  // 원장 사진 — clinic_doctor_consent=true 통과분만 갤러리 끝에 후보로 추가
  if (
    src.doctorConsent === true &&
    isAllowedClinicAssetUrl(src.doctorPhotoUrl, src.supabaseUrl) &&
    src.doctorPhotoUrl !== heroUrl &&
    !galleryCandidates.includes(src.doctorPhotoUrl)
  ) {
    galleryCandidates.push(src.doctorPhotoUrl);
  }

  return {
    accentColor,
    hasBrandColor: brand !== null,
    accentTextSafe: isAccentTextReadableOnWhite(accentColor),
    logoUrl,
    heroUrl,
    galleryUrls: galleryCandidates.slice(0, CLINIC_GALLERY_LIMIT),
    description: sanitizeClinicDescription(src.description),
  };
}
