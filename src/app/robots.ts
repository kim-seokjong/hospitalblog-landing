import type { MetadataRoute } from 'next'
import { PRIVATE_PATHS, SITE_URL } from '@/dev/lib/seo/site'

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

export default function robots(): MetadataRoute.Robots {
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
    // 2번째 항목은 고객 병원 서브 블로그 sitemap 인덱스.
    // 크롤러가 메인 robots.txt 만 읽어도 {slug}.hospitalblog.kr 들의 존재를 알 수 있다
    // (서치콘솔에는 이 인덱스 URL 하나만 제출하면 새 병원이 자동 편입된다).
    sitemap: [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/sitemap-clinics.xml`],
  }
}
