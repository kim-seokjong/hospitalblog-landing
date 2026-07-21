/**
 * 네이버 블로그 무료진단 — 입력 검증 (순수 로직).
 *
 * 랜딩 공개 엔드포인트에서 받는 외부 입력이므로 parseNaverBlogId(회원용)보다
 * 엄격하게 검증한다:
 * - blogId 패턴: [a-z0-9_-]{3,30}
 * - URL 입력은 blog.naver.com / m.blog.naver.com 호스트만 허용
 *   (rss·blog.me·기타 도메인은 거부 — 진단 스펙의 허용 호스트 고정 원칙)
 *
 * SSRF 방지: 이 모듈이 반환하는 값은 "blogId 문자열"뿐이며, 실제 fetch URL 은
 * 호출부가 BLOG_CHECK_ALLOWED_HOSTS 의 고정 호스트에 blogId 를 끼워 조립한다.
 * 사용자 입력이 URL 로 직접 fetch 되는 경로는 존재하지 않는다.
 */

/** 진단 blogId 허용 패턴 — 영문 소문자·숫자·`_`·`-` 3~30자. */
export const BLOG_CHECK_ID_PATTERN = /^[a-z0-9_-]{3,30}$/;

/**
 * 외부 fetch 허용 호스트 (전체 파이프라인 공통, 고정).
 * 이 목록 밖의 호스트로 나가는 fetch 는 blog-check 파이프라인에 존재해선 안 된다.
 */
export const BLOG_CHECK_ALLOWED_HOSTS: readonly string[] = [
  'rss.blog.naver.com', // RSS 수집
  'm.blog.naver.com', // 모바일 본문 수집
  'openapi.naver.com', // 블로그 검색(문서수·순위)
  'api.searchad.naver.com', // 월 검색량·compIdx
];

/** URL 입력에서 허용하는 호스트 (사용자 입력 형태 기준). */
const ALLOWED_INPUT_HOSTS = new Set(['blog.naver.com', 'm.blog.naver.com']);

/**
 * 진단 입력(블로그 주소 또는 ID)에서 blogId 를 추출한다. 실패 시 null.
 *
 * 허용 형태:
 * - 맨몸 ID: `florps1`
 * - URL: `blog.naver.com/florps1`, `https://m.blog.naver.com/florps1/223...`,
 *   `blog.naver.com/PostList.naver?blogId=florps1`
 * 그 외 도메인·형태는 전부 거부한다.
 */
export function parseBlogCheckInput(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim().toLowerCase();
  if (!raw || raw.length > 300) return null;

  // 1) 맨몸 ID (URL 구분자가 전혀 없을 때만)
  if (!raw.includes('/') && !raw.includes('.') && !raw.includes('?')) {
    return BLOG_CHECK_ID_PATTERN.test(raw) ? raw : null;
  }

  // 2) URL — 프로토콜이 없으면 붙여서 파싱 (URL 파서로 호스트를 정확히 판정)
  const withProto = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    return null;
  }
  if (!ALLOWED_INPUT_HOSTS.has(url.hostname)) return null;

  // 2-a) 쿼리형 (PostList.naver?blogId=... / PostView.naver?blogId=...)
  const byQuery = url.searchParams.get('blogid') ?? url.searchParams.get('blogId');
  if (byQuery) {
    return BLOG_CHECK_ID_PATTERN.test(byQuery) ? byQuery : null;
  }

  // 2-b) 경로형 — 첫 경로 세그먼트가 blogId
  const seg = url.pathname.split('/').filter((s) => s.length > 0)[0] ?? '';
  // PostView.naver 등 네이버 시스템 경로는 blogId 가 아니다
  if (seg.includes('.')) return null;
  return BLOG_CHECK_ID_PATTERN.test(seg) ? seg : null;
}
