import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  resolveClinicSiteRewrite,
  isClinicSitePathname,
  CLINIC_SITE_REQUEST_HEADER,
} from '@/content/lib/clinic-site/slug';

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
