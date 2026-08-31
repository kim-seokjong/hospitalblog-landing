import type { Metadata } from 'next'
import Script from 'next/script'
import PricingSection from '@/payment/components/PricingSection'
import PricingFaqSection from '@/payment/components/PricingFaqSection'
import PricingTracker from '@/dev/components/PricingTracker'
import JsonLd from '@/dev/lib/seo/JsonLd'
import { buildFaqPageJsonLd, buildPricingJsonLd } from '@/dev/lib/seo/schemas'
import { PRICING_FAQS } from '@/payment/lib/pricingFaq'

export const metadata: Metadata = {
  title: '요금제',
  // ⚠️판매 중인 플랜만 적는다. '프로'는 2026-07-31 판매 중단(hidden) 인데
  //   이 문구에 남아 있어 검색·AI 답변이 없는 요금제를 인용하고 있었다(2026-08-31 주간점검).
  description:
    '닥터포스트 요금제 안내. 병원 블로그 자동 작성 스탠다드·스탠다드 케어 및 올인원(블로그+영상+멀티채널) 월 구독.',
}

export default function PricingPage() {
  return (
    <>
      <JsonLd data={buildPricingJsonLd()} />
      <JsonLd data={buildFaqPageJsonLd(PRICING_FAQS)} />
      <PricingTracker />
      <Script
        src="https://cdn.portone.io/v2/browser-sdk.js"
        strategy="lazyOnload"
      />
      <main className="min-h-screen bg-[#eaeef4]">
        <div className="pt-16">
          <PricingSection />
          <PricingFaqSection />
        </div>
      </main>
    </>
  )
}
