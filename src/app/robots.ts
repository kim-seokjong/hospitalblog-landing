import type { MetadataRoute } from 'next'
import { PRIVATE_PATHS, SITE_URL } from '@/dev/lib/seo/site'
import { sitemapIndexPagePaths } from '@/content/lib/clinic-site/sitemap-index'
import { countClinicSitemapSources } from '@/content/lib/clinic-site/sitemap-index-data'

/** GEO(생성형 엔진 최적화) 대상 AI 크롤러 명시 허용 목록 */
const AI_CRAWLERS = [
  'GPTBot',
  'ClaudeBot',
  'Claude-Web',
  'PerplexityBot',
  'Google-Extended',
  'anthropic-ai',
  'cohere-ai',
]

/** 고객 병원 서브 블로그 사이트맵 인덱스 경로 (1페이지 = 쿼리 없는 기본 URL). */
const CLINIC_SITEMAP_PATH = '/sitemap-clinics.xml'

/**
 * 병원 수를 세어 필요한 사이트맵 인덱스 페이지를 모두 노출한다.
 *
 * 인덱스 1개는 프로토콜상 50,000개까지만 담을 수 있고 인덱스의 인덱스는 지원되지
 * 않는다. 그래서 50,000곳을 넘는 순간부터 ?page=2… 가 생기는데, 그 URL 을 아무도
 * 모르면 초과분 병원이 검색엔진에서 사라진다 → robots.txt 의 Sitemap 줄로 전부
 * 노출해 크롤러(와 서치콘솔)가 자동 발견하게 한다.
 *
 * 조회 실패·마이그 미적용이면 1페이지만 노출한다(기존 동작과 동일한 안전 기본값).
 */
async function clinicSitemapUrls(): Promise<string[]> {
  const total = await countClinicSitemapSources()
  const paths =
    total === null ? [CLINIC_SITEMAP_PATH] : sitemapIndexPagePaths(total, CLINIC_SITEMAP_PATH)
  return paths.map((path) => `${SITE_URL}${path}`)
}

// ⚠️ Next 14.2.5 의 metadata route(robots.ts)는 `export const dynamic`/`revalidate`
//    를 무시하고 빌드 시점에 정적으로 굳는다 — 실측 확인:
//    .next/prerender-manifest.json 의 /robots.txt → initialRevalidateSeconds:false,
//    force-dynamic 을 붙여도 .next/server/app/robots.txt.body 가 생성됐다.
//    따라서 Sitemap 줄은 "배포 시점"의 병원 수로 확정된다.
//
//    영향: 50,000곳을 넘긴 뒤 다음 배포 전까지는 ?page=2 가 robots.txt 에
//    노출되지 않는다. 50,000곳은 국내 의원급 전체(약 7만)에 육박하는 규모라
//    배포 주기(수시) 안에서 충분히 커버되고, 실제로 근접하면
//    /sitemap-clinics.xml 이 오버플로 경고 로그를 남긴다.
//    이 제약을 없애려면 metadata route 를 app/robots.txt/route.ts 핸들러로
//    바꿔야 하는데, 메인 도메인 robots.txt 는 장애 시 크롤링이 멈추는 파일이라
//    이번 범위에서는 검증된 metadata route 방식을 유지한다.
//
//    count 조회에는 1.5초 상한이 걸려 있어(sitemap-index-data.ts) 빌드가
//    DB 때문에 늘어지지 않고, 실패하면 1페이지만 노출한다(안전한 기본값).

export default async function robots(): Promise<MetadataRoute.Robots> {
  const disallow = [...PRIVATE_PATHS]

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow,
      },
      {
        // 네이버 검색 크롤러
        userAgent: 'Yeti',
        allow: '/',
        disallow,
      },
      {
        userAgent: AI_CRAWLERS,
        allow: '/',
        disallow,
      },
    ],
    // 2번째 이후 항목은 고객 병원 서브 블로그 sitemap 인덱스.
    // 크롤러가 메인 robots.txt 만 읽어도 {slug}.hospitalblog.kr 들의 존재를 알 수 있다
    // (서치콘솔에는 1페이지 URL 하나만 제출하면 50,000곳까지 자동 편입된다).
    sitemap: [`${SITE_URL}/sitemap.xml`, ...(await clinicSitemapUrls())],
  }
}
