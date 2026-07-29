import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  resolveClinicSiteRewrite,
  isClinicSitePathname,
  CLINIC_SITE_REQUEST_HEADER,
} from '@/content/lib/clinic-site/slug';
import {
  INTERNAL_COOKIE,
  INTERNAL_COOKIE_MAX_AGE_SEC,
  INTERNAL_COOKIE_VALUE,
  INTERNAL_OPT_PARAM,
  resolveInternalOptAction,
} from '@/content/lib/internal-traffic';

/**
 * 내부 트래픽 표시 쿠키 옵트인/해제 (?dp_internal=1 / =0) — 표시 후 파라미터를 떼고
 * 같은 URL 로 리다이렉트한다.
 *
 * 왜 미들웨어인가: 퍼널 이벤트는 /api/funnel-event 로 따로 전송되는데 그 요청에는
 * 페이지의 쿼리스트링이 붙지 않는다. "대표가 아무 페이지나 ?dp_internal=1 로 한 번
 * 열면 그 브라우저·기기가 계속 제외된다"를 만들려면 페이지 요청이 지나가는 이 지점에서
 * 쿠키를 심어야 한다(근거·수치는 src/content/lib/internal-traffic.ts 헤더 주석 참조).
 *
 * ★ 리다이렉트로 파라미터를 지우는 이유: 이 URL 이 남아 있으면 주소창 복사·공유·
 *   스크린샷을 통해 **고객 브라우저에 옵트아웃이 걸릴 수 있다**. 그러면 그 고객의
 *   방문이 1년간 조용히 사라진다 — 계측 오염보다 나쁜 데이터 손실이다.
 *   그래도 링크를 직접 열면 걸리는 위험 자체는 남는다(공개 옵트아웃의 본질).
 *   ⚠️ 그래서 이 URL 을 고객에게 보내지 마라. 잘못 걸렸으면 ?dp_internal=0 으로 푼다.
 *
 * ⚠️ 해제(=0)를 반드시 제공한다 — httpOnly 라 사용자가 직접 지울 수 없어서, 실수로
 *    켜면 되돌릴 방법이 없으면 그 기기의 방문이 영영 집계되지 않는다.
 * GET 이 아닌 요청(폼 POST 등)은 건드리지 않는다 — 리다이렉트가 본문을 잃게 만든다.
 * 파라미터가 없거나 알 수 없는 값이면 null 을 돌려 기존 흐름을 그대로 태운다.
 */
function handleInternalOptAction(request: NextRequest): NextResponse | null {
  if (request.method !== 'GET') return null;
  const action = resolveInternalOptAction(request.nextUrl.searchParams.get(INTERNAL_OPT_PARAM));
  if (action === 'none') return null;

  const url = request.nextUrl.clone();
  url.searchParams.delete(INTERNAL_OPT_PARAM);
  const response = NextResponse.redirect(url);
  const options = { httpOnly: true, sameSite: 'lax', secure: true, path: '/' } as const;
  if (action === 'enable') {
    response.cookies.set(INTERNAL_COOKIE, INTERNAL_COOKIE_VALUE, {
      ...options,
      maxAge: INTERNAL_COOKIE_MAX_AGE_SEC,
    });
  } else {
    // 삭제 = 빈 값 + maxAge 0. 같은 속성으로 덮어써야 브라우저가 확실히 지운다.
    response.cookies.set(INTERNAL_COOKIE, '', { ...options, maxAge: 0 });
  }
  return response;
}

export async function middleware(request: NextRequest) {
  // 병원 서브도메인 블로그 — {slug}.hospitalblog.kr / {slug}.localhost 요청을
  // /clinic-site/{slug}{경로} 로 rewrite 한다 (공개 페이지, 인증 불필요).
  // 메인 도메인·www·예약어·vercel.app 미리보기·_next/api/정적 파일은 null 이
  // 반환되어 아래 기존 동작(세션 갱신)을 그대로 탄다 — DNS 미설정 상태에서도
  // 어떤 부작용도 없다. 판정 로직은 순수 함수(slug.ts)로 분리해 테스트한다.
  const clinicSitePath = resolveClinicSiteRewrite(
    request.headers.get('host'),
    request.nextUrl.pathname,
  );
  if (clinicSitePath) {
    const url = request.nextUrl.clone();
    url.pathname = clinicSitePath;
    const headers = new Headers(request.headers);
    // 루트 레이아웃이 SaaS JSON-LD 를 빼도록 표시 (고객 블로그 정보 누출 차단).
    headers.set(CLINIC_SITE_REQUEST_HEADER, '1');
    return NextResponse.rewrite(url, { request: { headers } });
  }

  // 메인 도메인에서 /clinic-site/* 로 직접 접근하는 경우도 병원 블로그 렌더링이다.
  // 공개 페이지라 세션 갱신이 필요 없고, 동일하게 SaaS JSON-LD 를 뺀다.
  if (isClinicSitePathname(request.nextUrl.pathname)) {
    const headers = new Headers(request.headers);
    headers.set(CLINIC_SITE_REQUEST_HEADER, '1');
    return NextResponse.next({ request: { headers } });
  }

  /**
   * 병원 블로그가 아닌 요청 — 위조된 x-clinic-site 헤더를 제거해 외부에서
   * 메인 사이트의 JSON-LD 를 지우지 못하게 한다. 헤더 스냅샷은 호출 시점에
   * 뜬다(그 사이 request.cookies.set 으로 갱신된 쿠키가 반영되도록).
   */
  const nextWithSanitizedHeaders = (): NextResponse => {
    const headers = new Headers(request.headers);
    headers.delete(CLINIC_SITE_REQUEST_HEADER);
    return NextResponse.next({ request: { headers } });
  };

  // 내부 트래픽 표시 쿠키 옵트인/해제 — **메인 사이트 요청에서만** 처리한다.
  // (위 clinic-site 분기가 이미 반환했으므로 고객 블로그 방문에는 관여하지 않는다.)
  // 리다이렉트로 끝내므로 이 요청의 Supabase 세션 갱신은 건너뛰지만, 곧바로 이어지는
  // 리다이렉트 요청이 아래 갱신 경로를 그대로 탄다.
  const internalOptResponse = handleInternalOptAction(request);
  if (internalOptResponse) return internalOptResponse;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)가 설정되지 않았습니다.');
    return nextWithSanitizedHeaders();
  }

  let supabaseResponse = nextWithSanitizedHeaders();

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = nextWithSanitizedHeaders();
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 세션 갱신 (중요: getUser 호출 필요)
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
