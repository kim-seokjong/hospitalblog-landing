// 사이트 공통 SEO 상수 (개발팀 소관)
// 프로덕션 도메인: hospitalblog.kr (이메일 템플릿·관리자 페이지에서 사용 중인 도메인과 동일)

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.hospitalblog.kr'

export const SITE_NAME = '닥터포스트'

export const SITE_TITLE = '닥터포스트 — 발행 전 의료광고법 3중 검수, 병원 블로그 자동 작성'

export const SITE_DESCRIPTION =
  '병원 블로그 자동 작성 SaaS 닥터포스트. 모든 글은 발행 전 의료광고법 3중 검수(금지 표현 필터·AI 검사·주간 점검)를 통과합니다. 네이버·구글 SEO와 AI 검색(GEO) 최적화까지.'

export const SITE_KEYWORDS = [
  '병원 블로그',
  '의료광고법',
  '의료광고법 검수',
  '병원 마케팅',
  '블로그 자동 작성',
  'AI 블로그',
  '병의원 마케팅',
  '네이버 블로그 SEO',
  '병원 콘텐츠 제작',
  '닥터포스트',
] as const

/**
 * 쉼표 구분 verification 코드 env 파싱.
 * 네이버 서치어드바이저는 속성(non-www/www)마다 다른 코드를 발급하므로 다중 코드를 지원한다.
 * - 빈 값/공백만 있는 env → undefined (meta 태그 미출력)
 * - 코드 1개 → 문자열, 2개 이상 → 배열 (Next Metadata verification 타입 호환)
 */
export function parseVerificationCodes(
  raw: string | undefined
): string | string[] | undefined {
  if (!raw) return undefined
  const codes = raw
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code.length > 0)
  if (codes.length === 0) return undefined
  return codes.length === 1 ? codes[0] : codes
}

/** 검색 노출 대상 공개 페이지 경로 */
export const PUBLIC_PATHS = ['/', '/pricing', '/terms', '/privacy', '/refund'] as const

/** 검색 제외 대상 비공개 경로 (robots disallow) */
export const PRIVATE_PATHS = [
  '/admin',
  '/api',
  '/app',
  '/settings',
  '/mypage',
  '/payment',
  '/usage',
  '/history',
  '/calendar',
  '/monitor',
] as const
