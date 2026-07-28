import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/dev/lib/seo/site'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  return [
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      // 병원명 무료진단 — 랜딩 첫 화면의 제출 목적지이자 영업 링크(비회원 공개)
      url: `${SITE_URL}/clinic-check`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      /**
       * 가입 전 무료 맞춤 샘플 — 콜드메일 착지 페이지이자 비회원 공개 페이지.
       * robots.txt 의 PRIVATE_PATHS 에 없어 이미 크롤링 대상인데 사이트맵에만
       * 빠져 있었다(2026-07-28 점검). 색인 대상 페이지가 6개뿐인 상황에서
       * 공개 페이지를 빼놓을 이유가 없다.
       */
      url: `${SITE_URL}/sample`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/pricing`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/refund`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ]
}
