// JSON-LD 구조화 데이터 빌더 (개발팀 소관)
// 주의: 의료광고법 컨셉상 효과 보장·과장 표현 금지 — 기능 사실만 기술

import { PLANS } from '@/payment/lib/plans'
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from './site'

export type JsonLdData = Record<string, unknown>

const APP_FEATURES = [
  'AI 병원 블로그 글 자동 작성',
  '의료광고법(의료법 제56조) 기준 표현 검토',
  '네이버 SEO 체크리스트 분석',
  'AI 이미지·카드뉴스 생성',
  '네이버 검색 트렌드 분석',
  '중복 콘텐츠(독창성) 검사',
]

/** 운영사(광고진정성) Organization 스키마 */
export function buildOrganizationJsonLd(): JsonLdData {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: '광고진정성',
    url: SITE_URL,
    description: '병의원 전문 광고대행사. 병원 마케팅 SaaS 닥터포스트 운영.',
    address: {
      '@type': 'PostalAddress',
      addressLocality: '대구광역시 수성구',
      streetAddress: '청호로422 2층',
      addressCountry: 'KR',
    },
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      telephone: '+82-10-2558-1115',
      email: 'terro6936@naver.com',
      availableLanguage: 'Korean',
    },
  }
}

/** 닥터포스트 SoftwareApplication 스키마 (랜딩용) */
export function buildSoftwareApplicationJsonLd(): JsonLdData {
  // 공개(비숨김) 플랜만 SEO 가격 범위에 반영 — 레거시 basic 제외
  const publicPlans = Object.values(PLANS).filter((plan) => !plan.hidden)
  const prices = publicPlans.map((plan) => plan.price)
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    inLanguage: 'ko',
    featureList: APP_FEATURES,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'KRW',
      lowPrice: Math.min(...prices),
      highPrice: Math.max(...prices),
      offerCount: publicPlans.length,
      url: `${SITE_URL}/pricing`,
    },
    provider: {
      '@type': 'Organization',
      name: '광고진정성',
      url: SITE_URL,
    },
  }
}

export interface FaqEntry {
  question: string
  answer: string
}

/** FAQPage 스키마 — 화면에 노출되는 FAQ와 동일한 데이터만 전달할 것 */
export function buildFaqPageJsonLd(faqs: readonly FaqEntry[]): JsonLdData {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  }
}

/** 요금제 페이지 Product + Offer 스키마 */
export function buildPricingJsonLd(): JsonLdData {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${SITE_NAME} 구독`,
    description:
      '병원 블로그·영상·멀티채널 콘텐츠 자동 생성 월 구독 서비스. 스탠다드·프로 및 번들 요금제 제공.',
    brand: { '@type': 'Brand', name: SITE_NAME },
    offers: Object.values(PLANS).filter((plan) => !plan.hidden).map((plan) => ({
      '@type': 'Offer',
      name: `${plan.name} 플랜`,
      price: plan.price,
      priceCurrency: 'KRW',
      url: `${SITE_URL}/pricing`,
      availability: 'https://schema.org/InStock',
      category: '월 구독',
      description: plan.features.join(', '),
    })),
  }
}
