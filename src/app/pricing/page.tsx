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
  description:
    '닥터포스트 요금제 안내. 병원 블로그 자동 작성 베이직·스탠다드·프로 월 구독, 첫 달 혜택 제공.',
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
      <main className="min-h-screen bg-gray-950">
        <div className="pt-16">
          <PricingSection />
          <PricingFaqSection />
        </div>
      </main>
    </>
  )
}
