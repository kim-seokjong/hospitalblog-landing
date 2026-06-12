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
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
