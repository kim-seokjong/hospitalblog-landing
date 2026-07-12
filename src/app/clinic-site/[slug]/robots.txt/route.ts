import { NextResponse } from 'next/server';
import { validateSlug, clinicSiteUrl } from '@/content/lib/clinic-site/slug';

/**
 * 병원 서브도메인 블로그 — robots.txt (공개, 인증 없음).
 * {slug}.hospitalblog.kr/robots.txt → 미들웨어 rewrite → 이 라우트.
 * 전체 허용 + 해당 서브도메인 sitemap 위치 안내 (AI·검색 크롤러 색인 유도).
 * DB 조회 없이 슬러그 형식만 검증한다 — 존재하지 않는 병원의 sitemap 은 404 로 응답된다.
 */

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { slug } = await params;
  const validated = validateSlug(slug);
  if (!validated.ok) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${clinicSiteUrl(validated.slug, '/sitemap.xml')}`,
    '',
  ].join('\n');

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
    },
  });
}
