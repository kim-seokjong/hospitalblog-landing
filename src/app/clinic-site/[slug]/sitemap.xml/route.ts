import { NextResponse } from 'next/server';
import { validateSlug, clinicSiteUrl } from '@/content/lib/clinic-site/slug';
import { getClinicBySlug, getPublishedPosts } from '@/content/lib/clinic-site/data';

/**
 * 병원 서브도메인 블로그 — sitemap.xml (공개, 인증 없음).
 * {slug}.hospitalblog.kr/sitemap.xml → 미들웨어 rewrite → 이 라우트.
 * 홈 + 발행 확정 글의 서브도메인 절대 URL 목록.
 */

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/** XML 텍스트 이스케이프 (URL 은 UUID·슬러그 조합이라 실질 무해하지만 방어적으로). */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const { slug } = await params;
    const validated = validateSlug(slug);
    if (!validated.ok) {
      return new NextResponse('Not Found', { status: 404 });
    }

    const clinic = await getClinicBySlug(validated.slug);
    if (!clinic) {
      return new NextResponse('Not Found', { status: 404 });
    }

    const posts = await getPublishedPosts(clinic.userId);

    const urls: string[] = [
      `  <url>\n    <loc>${escapeXml(clinicSiteUrl(validated.slug))}</loc>\n  </url>`,
      ...posts.map((post) => {
        const loc = escapeXml(clinicSiteUrl(validated.slug, `/posts/${post.id}`));
        const lastmod = post.publishedAt
          ? `\n    <lastmod>${escapeXml(new Date(post.publishedAt).toISOString())}</lastmod>`
          : '';
        return `  <url>\n    <loc>${loc}</loc>${lastmod}\n  </url>`;
      }),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=3600',
      },
    });
  } catch (err) {
    console.error('[clinic-site] sitemap 오류:', err instanceof Error ? err.message : err);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
