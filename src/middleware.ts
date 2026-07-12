import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { resolveClinicSiteRewrite } from '@/content/lib/clinic-site/slug';

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
    return NextResponse.rewrite(url);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)가 설정되지 않았습니다.');
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

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
          supabaseResponse = NextResponse.next({ request });
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
