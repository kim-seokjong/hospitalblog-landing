import { NextResponse } from 'next/server';
import {
  validateSlug,
  clinicSiteUrl,
  extractClinicSlugFromHost,
} from '@/content/lib/clinic-site/slug';
import {
  buildSitemapIndexXml,
  parseSitemapPage,
  selectIndexableClinics,
  sitemapPageRange,
} from '@/content/lib/clinic-site/sitemap-index';
import { fetchClinicSitemapSources } from '@/content/lib/clinic-site/sitemap-index-data';

/**
 * 고객 병원 서브 블로그 사이트맵 인덱스 (메인 도메인 전용).
 *   https://www.hospitalblog.kr/sitemap-clinics.xml
 *
 * 서치콘솔·빙 웹마스터에 이 URL "하나만" 제출하면, 새 병원이 첫 글을 발행하는
 * 순간 자동으로 편입된다(사람이 병원마다 등록할 필요 없음).
 *
 * 규칙:
 *  - published_to_site=true 글이 1편 이상인 병원만 나열한다. 글 0편 병원의 빈
 *    사이트맵을 제출하면 색인 품질 신호가 나빠지고 서치콘솔에 오류가 쌓인다.
 *  - ?page=N 페이지네이션(페이지당 1,000개, 최대 50페이지 = 프로토콜 상한 50,000).
 *  - 병원 "목록"을 사람이 읽는 페이지로 공개하지 않는다 — 이 라우트는 기계 판독용
 *    사이트맵 인덱스일 뿐이며 메인 사이트 어디에도 링크하지 않는다.
 *
 * 캐싱 (Next 14.2 route handler):
 *  Request 헤더·쿼리를 읽는 라우트라 정적 캐시 대상이 아니다 → force-dynamic 으로
 *  명시하고, 대신 CDN 캐시 헤더(s-maxage=3600)로 1시간 revalidate 를 건다.
 *  기존 /clinic-site/[slug]/sitemap.xml 라우트와 동일한 방식이다.
 */

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  try {
    // 서브도메인({slug}.hospitalblog.kr)에서 온 요청이면 404 —
    // 이 인덱스는 메인 도메인의 자산이고, 병원 블로그가 서로의 목록을 노출하면 안 된다.
    if (extractClinicSlugFromHost(req.headers.get('host'))) {
      return new NextResponse('Not Found', { status: 404 });
    }

    const page = parseSitemapPage(new URL(req.url).searchParams.get('page'));
    const { from, to } = sitemapPageRange(page);

    const sources = await fetchClinicSitemapSources(from, to);
    const entries = selectIndexableClinics(sources, (slug) => {
      const validated = validateSlug(slug);
      return validated.ok ? clinicSiteUrl(validated.slug, '/sitemap.xml') : null;
    });

    return new NextResponse(buildSitemapIndexXml(entries), {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('[sitemap-clinics] 오류:', err instanceof Error ? err.message : err);
    // 사이트맵이 500 을 내면 서치콘솔에 "가져올 수 없음" 오류가 누적된다 →
    // well-formed 한 빈 인덱스로 응답하고 다음 revalidate 에서 자연 복구시킨다.
    return new NextResponse(buildSitemapIndexXml([]), {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=60',
      },
    });
  }
}
