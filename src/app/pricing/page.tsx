import Script from 'next/script'
import PricingSection from '@/components/payment/PricingSection'
import PricingTracker from '@/components/PricingTracker'

export default function PricingPage() {
  return (
    <>
      <PricingTracker />
      <Script
        src="https://cdn.portone.io/v2/browser-sdk.js"
        strategy="lazyOnload"
      />
      <main className="min-h-screen bg-gray-950">
        <div className="pt-16">
          <PricingSection />
        </div>
      </main>
    </>
  )
}
