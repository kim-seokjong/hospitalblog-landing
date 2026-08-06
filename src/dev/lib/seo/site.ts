// 사이트 공통 SEO 상수 (개발팀 소관)
// 프로덕션 도메인: hospitalblog.kr (이메일 템플릿·관리자 페이지에서 사용 중인 도메인과 동일)

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.hospitalblog.kr'

export const SITE_NAME = '닥터포스트'

export const SITE_TITLE = '닥터포스트 — 발행 전 의료광고법 3중 검수, 병원 블로그 자동 작성'

// ⚠️ 첫 문장 = 랜딩 첫 화면(H1 "병원 이름만 넣으면 온라인 노출 성적을 알려드려요")과 반드시 일치시킨다.
//    검색결과 스니펫과 실제 첫 화면이 어긋나면 클릭 직후 이탈한다.
//    뒤 문장은 제품 정체(의료광고법 3중 검수·블로그 자동 작성·SEO/GEO) — 기존 핵심 키워드를 유지한다.
export const SITE_DESCRIPTION =
  '병원 이름만 넣으면 네이버 플레이스·블로그·인스타·유튜브·홈페이지·AI 검색 노출을 무료로 진단해 드립니다. 닥터포스트는 발행 전 의료광고법 3중 검수(금지 표현 필터·AI 검사·주간 점검)를 통과한 병원 블로그 글을 자동 작성하고, 네이버·구글 SEO와 AI 검색(GEO) 최적화까지 지원합니다.'

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
  // 무료진단(첫 화면·/clinic-check) 계열 — 기존 키워드를 대체하는 게 아니라 더한 것이다.
  '병원 온라인 노출 진단',
  '병원 블로그 진단',
  '병원 홈페이지 검색 노출',
  'AI 검색 GEO 최적화',
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
export const PUBLIC_PATHS = [
  '/',
  '/clinic-check',
  // /sample 은 PRIVATE_PATHS 에 없어 이미 크롤링·색인 대상이고 sitemap.ts 에도 있다.
  // 여기서만 빠져 있어 "공개 페이지 목록"이 사실과 어긋났다(2026-08-03 점검).
  '/sample',
  '/pricing',
  '/terms',
  '/privacy',
  '/refund',
] as const

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
