import { NextResponse } from 'next/server';
import { validateSlug } from '@/content/lib/clinic-site/slug';
import { isValidIndexNowKey } from '@/content/lib/clinic-site/indexnow';
import { clinicSlugExists } from '@/content/lib/clinic-site/data';

/**
 * IndexNow 키 파일 — {slug}.hospitalblog.kr/{key}.txt
 * → 미들웨어 rewrite → /clinic-site/{slug}/indexnow/{key} → 이 라우트.
 *
 * IndexNow 공식 스펙:
 *  - "Each subdomain is treated as a separate host, which means you must create and
 *     manage individual key files for each one." (indexnow.org/faq)
 *  - 키 파일은 UTF-8 텍스트, 본문은 키 문자열 "그대로"만 담아야 한다.
 *    "The text inside must exactly match your API key"
 *  - 로그인·방화벽 없이 공개 접근 가능해야 한다.
 *
 * 그래서 병원마다 사람이 파일을 올리지 않고 이 라우트가 자동으로 응답한다.
 * INDEXNOW_KEY 미설정이거나 요청 키가 다르면 404 (존재하지 않는 파일과 동일).
 */

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ slug: string; key: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { slug, key } = await params;

  const validated = validateSlug(slug);
  if (!validated.ok) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const configuredKey = process.env.INDEXNOW_KEY ?? '';
  // 미설정이면 기능 자체가 꺼진 상태 — 배포를 깨지 않고 404 로 응답한다.
  if (!isValidIndexNowKey(configuredKey)) {
    return new NextResponse('Not Found', { status: 404 });
  }
  if (key !== configuredKey) {
    return new NextResponse('Not Found', { status: 404 });
  }

  // 와일드카드 DNS 라 아무 슬러그나 이 라우트에 닿는다. 실제 병원에 할당된
  // 슬러그일 때만 키를 노출해, 미할당 서브도메인이 IndexNow 소유 검증을
  // 통과하는 상황을 막는다.
  // 조회 실패(null)는 fail-open — 도메인 자체가 우리 것이라 위험이 낮고,
  // 일시 장애로 검증이 깨져 색인 요청이 403 되는 쪽이 더 손해다.
  const exists = await clinicSlugExists(validated.slug);
  if (exists === false) {
    return new NextResponse('Not Found', { status: 404 });
  }

  return new NextResponse(configuredKey, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // 검색엔진이 자주 재확인하므로 CDN 캐시를 길게 둔다(값이 바뀌면 재배포됨).
      'Cache-Control': 'public, max-age=0, s-maxage=86400',
    },
  });
}
