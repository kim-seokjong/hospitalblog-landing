// 사이트 공통 SEO 상수 (개발팀 소관)
// 프로덕션 도메인: hospitalblog.kr (이메일 템플릿·관리자 페이지에서 사용 중인 도메인과 동일)

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.hospitalblog.kr'

export const SITE_NAME = '닥터포스트'

export const SITE_TITLE = '닥터포스트 — 의료광고법 준수 병원 블로그 자동 작성'

export const SITE_DESCRIPTION =
  '병원 블로그 자동 작성 SaaS 닥터포스트. 의료광고법 준수 검토, 네이버 SEO 분석, AI 이미지 생성으로 병원 마케팅 콘텐츠 제작을 돕습니다.'

export const SITE_KEYWORDS = [
  '병원 블로그',
  '의료광고법',
  '병원 마케팅',
  '블로그 자동 작성',
  'AI 블로그',
  '병의원 마케팅',
  '네이버 블로그 SEO',
  '병원 콘텐츠 제작',
  '닥터포스트',
] as const

/** 검색 노출 대상 공개 페이지 경로 */
export const PUBLIC_PATHS = ['/', '/pricing', '/terms', '/privacy', '/refund'] as const

/** 검색 제외 대상 비공개 경로 (robots disallow) */
export const PRIVATE_PATHS = [
  '/admin',
  '/api',
  '/app',
  '/settings',
  '/payment',
  '/usage',
  '/history',
  '/calendar',
  '/monitor',
] as const
