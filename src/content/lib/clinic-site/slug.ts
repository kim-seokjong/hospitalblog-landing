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
 * 공개 블로그 호스트명(스킴 없음). IndexNow 는 "host" 필드를 따로 요구한다.
 * 예: clinicSiteHost('myclinic') → myclinic.hospitalblog.kr
 */
export function clinicSiteHost(slug: string): string {
  return `${slug}.${CLINIC_SITE_ROOT_DOMAIN}`;
}

/**
 * 공개 블로그 절대 URL 을 만든다.
 * 예: clinicSiteUrl('myclinic') → https://myclinic.hospitalblog.kr
 *     clinicSiteUrl('myclinic', '/posts/abc') → https://myclinic.hospitalblog.kr/posts/abc
 */
export function clinicSiteUrl(slug: string, path = ''): string {
  const normalizedPath = path === '' || path === '/' ? '' : (path.startsWith('/') ? path : `/${path}`);
  return `https://${clinicSiteHost(slug)}${normalizedPath}`;
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
 * IndexNow 키 파일 경로 패턴 — /{key}.txt (키 형식: 8~128자 영숫자·하이픈).
 *
 * IndexNow 공식 스펙상 서브도메인은 각각 "별개 호스트"라 자기 루트에 키 파일을
 * 응답해야 한다(상위 도메인 키 파일이 서브도메인을 커버하지 않는다). 병원마다
 * 사람이 파일을 올리는 방식은 불가능하므로, 이 패턴에 맞는 요청을 전용 라우트로
 * rewrite 해 환경변수(INDEXNOW_KEY)로 자동 응답한다.
 *
 * ⚠️ robots.txt 는 위 INDEXING_FILE_PATHS 에서 먼저 처리된다(키 최소 길이 8자라
 *    'robots'(6자)는 애초에 이 패턴에 걸리지도 않는다).
 */
const INDEXNOW_KEY_FILE_RE = /^\/([a-zA-Z0-9-]{8,128})\.txt$/;

/** 키 파일 요청을 처리하는 내부 라우트 접두사. */
const INDEXNOW_ROUTE_SEGMENT = 'indexnow';

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
    // IndexNow 키 파일(/{key}.txt) — 전용 라우트로 넘긴다.
    // 실제 키 일치 여부는 라우트 핸들러가 환경변수와 비교해 판정한다(불일치 → 404).
    const keyMatch = INDEXNOW_KEY_FILE_RE.exec(path);
    if (keyMatch) {
      return `/clinic-site/${slug}/${INDEXNOW_ROUTE_SEGMENT}/${keyMatch[1]}`;
    }

    const lastSegment = path.slice(path.lastIndexOf('/') + 1);
    if (lastSegment.includes('.')) return null;
  }

  return path === '/' ? `/clinic-site/${slug}` : `/clinic-site/${slug}${path}`;
}

/** 병원 블로그 렌더링 경로 접두사 (메인 도메인에서 직접 접근하는 경우 포함). */
export const CLINIC_SITE_PATH_PREFIX = '/clinic-site';

/**
 * 미들웨어가 병원 블로그 렌더링임을 앱에 알릴 때 쓰는 요청 헤더.
 *
 * ⚠️ **루트 레이아웃은 더 이상 이 헤더를 읽지 않는다.** 레이아웃에서 headers() 를
 *    읽으면 하위 세그먼트 전체가 동적으로 내려가 /clinic-site/* 의 ISR 이 죽기
 *    때문이다. 서드파티 태그 판정은 isClinicSiteBrowserContext(브라우저 문맥)로,
 *    회사 JSON-LD 는 홈에만 두는 구조로 각각 대체했다.
 *    헤더는 서버 컴포넌트가 아닌 곳(라우트 핸들러 등)에서 쓸 수 있도록 남겨 둔다.
 *
 * ⚠️ 외부에서 위조해 보낼 수 있으므로 미들웨어가 항상 set 또는 delete 로
 *    덮어쓴다(신뢰 경계는 미들웨어 한 곳).
 */
export const CLINIC_SITE_REQUEST_HEADER = 'x-clinic-site';

/** 경로가 병원 블로그 렌더링 경로인지 (메인 도메인 직접 접근 판정용). */
export function isClinicSitePathname(pathname: string): boolean {
  return (
    pathname === CLINIC_SITE_PATH_PREFIX ||
    pathname.startsWith(`${CLINIC_SITE_PATH_PREFIX}/`)
  );
}

/**
 * 브라우저 문맥이 고객 병원 블로그인지 판정한다 (클라이언트 전용 순수 함수).
 *
 * ★ 왜 헤더가 아니라 이걸로 판정하는가:
 *   루트 레이아웃에서 headers() 를 읽으면 하위 세그먼트 전체가 동적 렌더로 내려가
 *   /clinic-site/* 의 `revalidate = 3600`(ISR)이 무력화된다. 판정 입력을
 *   요청 헤더 → 브라우저 문맥으로 옮겨 레이아웃을 정적으로 유지한다.
 *   **어떤 태그를 빼는지의 정책은 third-party.ts 그대로다** — 입력만 바뀐다.
 *
 * ★ 왜 경로(usePathname)만으로는 안 되는가 (Next 14.2.5 소스 실측):
 *   미들웨어 rewrite 는 브라우저 URL 을 바꾸지 않는다. 클라이언트 라우터는
 *   canonicalUrl 을 window.location 에서 만들기 때문에
 *   (create-initial-router-state.js —
 *    `location ? createHrefFromUrl(location) : initialCanonicalUrl`,
 *    app-router.js — `location: !isServer ? window.location : null`)
 *   {slug}.hospitalblog.kr/ 에서 usePathname() 은 '/clinic-site/{slug}' 가 아니라 '/' 다.
 *   그래서 **호스트명(서브도메인) 판정이 1차**이고, 경로 판정은 메인 도메인에서
 *   /clinic-site/* 로 직접 들어온 경우를 잡는 2차 게이트다 —
 *   미들웨어가 헤더를 붙이던 두 경로(서브도메인 rewrite · 직접 접근)를 그대로 덮는다.
 *
 * 어느 한쪽만 걸려도 병원 블로그로 본다(recall 우선) — 오판의 비용이
 * "메인 사이트에서 태그가 안 뜬다"보다 "환자 브라우저에 픽셀이 심긴다" 쪽이 훨씬 크다.
 */
export function isClinicSiteBrowserContext(
  hostname: string | null | undefined,
  pathname: string | null | undefined,
): boolean {
  if (extractClinicSlugFromHost(hostname) !== null) return true;
  return typeof pathname === 'string' && isClinicSitePathname(pathname);
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
