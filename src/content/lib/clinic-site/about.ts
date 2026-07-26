/**
 * 병원 소개 페이지 노출 판정 (순수 로직 모듈).
 *
 * 왜 판정이 필요한가:
 *  - 병원 소개 페이지는 프로필에 이미 있는 값(소개문·진료시간·주소·전화·사진)만
 *    보여준다. 아무것도 등록하지 않은 병원에게도 페이지를 열어 두면
 *    "제목만 있고 내용이 없는 페이지"가 사이트맵에 실려 색인 품질을 떨어뜨린다.
 *  - 그래서 홈의 링크 · 페이지 자체(404) · sitemap 세 곳이 **같은 기준**을 써야 한다.
 *    기준이 갈리면 사이트맵에는 있는데 404 가 나는 URL 이 생긴다.
 *
 * ⚠️ 러너 제약(slug.ts / hours.ts 패턴): 값 import 없이 자립 모듈로 유지한다.
 *    진료시간은 객체 대신 "내용이 있는가"(hasHours)만 받는다.
 */

export interface ClinicAboutContentInput {
  /** 병원 소개문 (profiles.hospital_desc — theme.description) */
  description?: string | null;
  /** 진료시간에 표시할 내용이 있는가 (!isEmptyClinicHours(hours)) */
  hasHours: boolean;
  address?: string | null;
  phone?: string | null;
  /** 등록된 병원 사진 수 */
  galleryCount?: number;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * 병원 소개 페이지를 만들 만한 내용이 있는지.
 *
 * 주소·전화만 있는 경우는 제외한다 — 그 둘은 이미 홈 상단에 그대로 나오므로
 * 같은 내용만 담은 페이지를 하나 더 만들면 중복 콘텐츠가 된다.
 * 소개문 · 진료시간 · 사진 중 하나라도 있어야 "홈에 없는 정보"가 생긴다.
 */
export function hasClinicAboutContent(input: ClinicAboutContentInput): boolean {
  if (hasText(input.description)) return true;
  if (input.hasHours) return true;
  if ((input.galleryCount ?? 0) > 0) return true;
  return false;
}
