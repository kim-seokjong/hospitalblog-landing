import { NextResponse } from 'next/server';
import { validateSlug, clinicSiteUrl } from '@/content/lib/clinic-site/slug';
import { getClinicBySlug, getPublishedPostRefs } from '@/content/lib/clinic-site/data';
import { getClinicTheme } from '@/content/lib/clinic-site/theme-data';
import { isEmptyClinicHours } from '@/content/lib/clinic-site/hours';
import { hasClinicAboutContent } from '@/content/lib/clinic-site/about';

/**
 * 병원 서브도메인 블로그 — sitemap.xml (공개, 인증 없음).
 * {slug}.hospitalblog.kr/sitemap.xml → 미들웨어 rewrite → 이 라우트.
 * 홈 + 발행 확정 글의 서브도메인 절대 URL 목록.
 */

export const dynamic = 'force-dynamic';
// ★fetch Data Cache 까지 명시적으로 끈다 (2026-07-30 실측).
//   force-dynamic 만으로는 Supabase 조회(fetch)가 Data Cache 에 남아, 새로 발행한
//   글이 페이지에는 보이는데 **사이트맵에만 영영 안 들어가는** 상태가 됐다
//   (adsincerity 새 글이 홈·글 페이지엔 뜨고 sitemap.xml 에는 빠져 있었다).
//   사이트맵에 없는 글은 검색엔진이 늦게 찾거나 못 찾는다 — 전 고객 공통 문제.
export const fetchCache = 'force-no-store';

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

    // 발행 글 전체(50편 상한 없음 — 잘린 글은 검색엔진이 영영 찾지 못한다).
    // 조회 실패 시 null → 빈 sitemap 을 200 으로 주지 않고 503 으로 알린다.
    const posts = await getPublishedPostRefs(clinic.userId);
    if (posts === null) {
      return new NextResponse('Sitemap temporarily unavailable', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '600' },
      });
    }

    // 병원 소개 페이지는 "보여줄 내용이 있을 때만" 존재한다 —
    // 페이지(404 판정)·홈 링크와 반드시 같은 기준을 써야 사이트맵에만 있는 죽은 URL 이 안 생긴다.
    const theme = await getClinicTheme(clinic.userId);
    const hasAbout = hasClinicAboutContent({
      description: theme.description,
      hasHours: !isEmptyClinicHours(clinic.hours),
      address: clinic.address,
      phone: clinic.phone,
      galleryCount: theme.galleryUrls.length,
    });

    const urls: string[] = [
      `  <url>\n    <loc>${escapeXml(clinicSiteUrl(validated.slug))}</loc>\n  </url>`,
      ...(hasAbout
        ? [`  <url>\n    <loc>${escapeXml(clinicSiteUrl(validated.slug, '/about'))}</loc>\n  </url>`]
        : []),
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
