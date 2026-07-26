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
  SITEMAP_INDEX_PAGE_SIZE,
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
 *  - 한 파일에 프로토콜 상한(50,000개)까지 전부 담는다 → 병원이 50,000곳이 될
 *    때까지 이 URL 하나로 전부 커버된다. 그 이상은 ?page=N 으로 분할되고,
 *    분할된 URL 은 메인 robots.txt 의 Sitemap 줄로 노출돼 크롤러가 발견한다.
 *  - 병원 "목록"을 사람이 읽는 페이지로 공개하지 않는다 — 이 라우트는 기계 판독용
 *    사이트맵 인덱스일 뿐이며 메인 사이트 어디에도 링크하지 않는다.
 *  - ★ 조회 실패 시 빈 XML 200 을 주지 않는다. 검색엔진이 "이제 아무것도 없다"로
 *    해석해 색인이 통째로 빠질 수 있으므로 503 을 내고 직전 성공본을 살려둔다.
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

    const result = await fetchClinicSitemapSources(from, to);
    if (!result.ok) {
      console.error('[sitemap-clinics] 조회 실패:', result.reason);
      return unavailable();
    }

    const entries = selectIndexableClinics(result.sources, (slug) => {
      const validated = validateSlug(slug);
      return validated.ok ? clinicSiteUrl(validated.slug, '/sitemap.xml') : null;
    });

    // 오버플로 경보 — 이 페이지가 가득 찼다는 것은 다음 페이지가 존재한다는 뜻이다.
    // robots.txt 의 Sitemap 줄은 배포 시점 기준이라, 배포 사이에 상한을 넘기면
    // 다음 페이지가 잠시 노출되지 않는다. 로그로 즉시 알아채고 재배포하면 된다.
    if (entries.length >= SITEMAP_INDEX_PAGE_SIZE) {
      console.error(
        `[sitemap-clinics] 페이지 ${page} 가 상한(${SITEMAP_INDEX_PAGE_SIZE})까지 찼다 — 다음 페이지 노출을 위해 재배포 필요`,
      );
    }

    return new NextResponse(buildSitemapIndexXml(entries), {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('[sitemap-clinics] 오류:', err instanceof Error ? err.message : err);
    return unavailable();
  }
}

/**
 * 일시 장애 응답 — 503 + no-store.
 * 빈 사이트맵을 200 으로 캐시하면 검색엔진이 "목록이 비었다"로 받아들여 색인이
 * 빠질 수 있다. 5xx 는 "지금 못 읽는다"는 뜻이라 직전 성공본이 유지된다.
 */
function unavailable(): NextResponse {
  return new NextResponse('Sitemap temporarily unavailable', {
    status: 503,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '600',
    },
  });
}
