/**
 * 병원 서브도메인 블로그 — 슬러그 검증 + 호스트 라우팅 파싱 (순수 로직 모듈).
 *
 * 역할:
 *  1) site_slug 형식·예약어 검증 (프로필 저장 · 공개 페이지 · 미들웨어 공용)
 *  2) 미들웨어 호스트 파싱 — {slug}.hospitalblog.kr / {slug}.localhost 요청을
 *     /clinic-site/{slug}{경로} rewrite 대상으로 판정
 *  3) 공개 블로그 절대 URL 조립 (canonical · sitemap · UI 링크 공용)
 *
 * ⚠️ 러너 제약(compliance-report.ts 패턴): node --experimental-strip-types
 *    테스트 러너가 별칭·상대 경로 해석 없이 로드할 수 있도록 값 import 없이
 *    한 파일로 유지한다. 슬러그 규칙과 호스트 파싱이 예약어 목록을 공유하므로
 *    분리하지 않는다.
 */

// ---------------------------------------------------------------------------
// 슬러그 형식
// ---------------------------------------------------------------------------

/** 슬러그 길이 하한·상한 (자). */
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 30;

/** 소문자 영숫자로 시작·끝, 중간은 소문자 영숫자+하이픈 — 총 3~30자. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;

/**
 * 예약어 — 서브도메인으로 쓰면 인프라·메인 서비스와 충돌하거나 피싱 오인
 * 위험이 있는 이름. 프로필 저장과 미들웨어 라우팅 양쪽에서 차단한다.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www', 'app', 'api', 'admin', 'mail', 'blog', 'dev', 'staging',
  'vercel', 'cdn', 'static', 'assets', 'help', 'docs', 'status', 'test',
  'smtp', 'imap', 'pop', 'ftp', 'webmail', 'ns1', 'ns2', 'mx',
  'auth', 'login', 'signup', 'account', 'accounts', 'my', 'mypage',
  'support', 'contact', 'about', 'news', 'shop', 'store', 'pay', 'payment',
  'dashboard', 'console', 'portal', 'demo', 'beta', 'preview', 'internal',
  'local', 'localhost', 'root', 'ssl', 'secure', 'email', 'doctorpost',
]);

export type SlugValidation =
  | { ok: true; slug: string }
  | { ok: false; reason: string };

/**
 * 슬러그 입력을 검증한다 (앞뒤 공백 제거 + 소문자 정규화 후 판정).
 * 통과 시 정규화된 슬러그를 함께 반환한다.
 */
export function validateSlug(raw: string): SlugValidation {
  const slug = (raw ?? '').trim().toLowerCase();
  if (slug.length === 0) {
    return { ok: false, reason: '블로그 주소를 입력해주세요.' };
  }
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) {
    return { ok: false, reason: `블로그 주소는 ${SLUG_MIN_LENGTH}~${SLUG_MAX_LENGTH}자여야 합니다.` };
  }
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      reason: '소문자 영문·숫자·하이픈(-)만 사용할 수 있고, 하이픈으로 시작하거나 끝날 수 없습니다.',
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, reason: '사용할 수 없는 예약된 주소입니다. 다른 주소를 입력해주세요.' };
  }
  return { ok: true, slug };
}

// ---------------------------------------------------------------------------
// 공개 블로그 절대 URL
// ---------------------------------------------------------------------------

/** 서브도메인 블로그의 루트 도메인. */
export const CLINIC_SITE_ROOT_DOMAIN = 'hospitalblog.kr';

/**
 * 공개 블로그 절대 URL 을 만든다.
 * 예: clinicSiteUrl('myclinic') → https://myclinic.hospitalblog.kr
 *     clinicSiteUrl('myclinic', '/posts/abc') → https://myclinic.hospitalblog.kr/posts/abc
 */
export function clinicSiteUrl(slug: string, path = ''): string {
  const normalizedPath = path === '' || path === '/' ? '' : (path.startsWith('/') ? path : `/${path}`);
  return `https://${slug}.${CLINIC_SITE_ROOT_DOMAIN}${normalizedPath}`;
}

// ---------------------------------------------------------------------------
// 미들웨어 호스트 파싱 (순수 함수 — 테스트 대상)
// ---------------------------------------------------------------------------

/** 서브도메인 라우팅을 지원하는 도메인 접미사 — 운영 + 로컬 테스트. */
const CLINIC_HOST_SUFFIXES: readonly string[] = [
  `.${CLINIC_SITE_ROOT_DOMAIN}`,
  '.localhost',
];

/**
 * Host 헤더에서 병원 블로그 슬러그를 추출한다.
 *
 * 반환 규칙 (null = 메인 도메인/기타 호스트 — 기존 동작 유지):
 *  - {slug}.hospitalblog.kr / {slug}.localhost 만 대상 (포트는 무시)
 *  - www·예약어·형식 불일치·중첩 서브도메인(a.b.hospitalblog.kr)은 null
 *  - hospitalblog.kr 자체, vercel.app 미리보기, localhost 등은 null
 */
export function extractClinicSlugFromHost(hostHeader: string | null | undefined): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.trim().toLowerCase().split(':')[0];
  if (host.length === 0) return null;

  for (const suffix of CLINIC_HOST_SUFFIXES) {
    if (!host.endsWith(suffix)) continue;
    const sub = host.slice(0, host.length - suffix.length);
    if (sub.length === 0 || sub.includes('.')) return null;
    const validated = validateSlug(sub);
    return validated.ok ? validated.slug : null;
  }
  return null;
}

/** rewrite 를 하지 않는 경로 접두사 — Next 내부·API·공개 페이지 자기 자신. */
const EXCLUDED_PATH_PREFIXES: readonly string[] = ['/_next', '/api', '/clinic-site'];

/** 정적 파일로 취급하지 않고 rewrite 하는 색인 파일 경로. */
const INDEXING_FILE_PATHS: ReadonlySet<string> = new Set(['/sitemap.xml', '/robots.txt']);

/**
 * 서브도메인 요청 경로를 /clinic-site/{slug}{경로} rewrite 대상으로 변환한다.
 * null 이면 rewrite 하지 않는다 (Next 내부 경로·API·정적 파일 등).
 */
export function buildClinicSitePath(slug: string, pathname: string): string | null {
  const path = pathname || '/';
  if (!path.startsWith('/')) return null;

  for (const prefix of EXCLUDED_PATH_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return null;
  }

  // 마지막 세그먼트에 확장자가 있는 정적 파일은 제외하되,
  // sitemap.xml·robots.txt 는 색인 라우트로 rewrite 한다.
  if (!INDEXING_FILE_PATHS.has(path)) {
    const lastSegment = path.slice(path.lastIndexOf('/') + 1);
    if (lastSegment.includes('.')) return null;
  }

  return path === '/' ? `/clinic-site/${slug}` : `/clinic-site/${slug}${path}`;
}

/**
 * 미들웨어 진입점 — Host 헤더 + 경로를 받아 rewrite 대상 경로를 돌려준다.
 * null 이면 기존 미들웨어 동작(세션 갱신 등)을 그대로 수행한다.
 */
export function resolveClinicSiteRewrite(
  hostHeader: string | null | undefined,
  pathname: string,
): string | null {
  const slug = extractClinicSlugFromHost(hostHeader);
  if (!slug) return null;
  return buildClinicSitePath(slug, pathname);
}
