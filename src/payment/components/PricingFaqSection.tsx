'use client'

import { useState } from 'react'
import { PRICING_FAQS } from '@/payment/lib/pricingFaq'

// 가격 페이지 FAQ 아코디언 (결제팀 소관)
// 팔레트: 라이트 테마(흰 배경·흰 카드 + #dbe2ea 보더) — 가격 페이지와 동일 톤 유지

export default function PricingFaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const toggle = (index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index))
  }

  return (
    <section aria-labelledby="pricing-faq-heading" className="py-12 sm:py-16 bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <h2
          id="pricing-faq-heading"
          className="text-2xl sm:text-3xl font-bold text-center text-[#202020] mb-2"
        >
          자주 묻는 질문
        </h2>
        <p className="text-center text-sm sm:text-base text-[#8a93a0] mb-8">
          요금제·결제·해지에 대해 궁금한 점을 확인하세요
        </p>

        <div className="space-y-3">
          {PRICING_FAQS.map((faq, index) => {
            const isOpen = openIndex === index
            return (
              <div
                key={faq.question}
                className="bg-white border border-[#dbe2ea] rounded-xl overflow-hidden shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]"
              >
                <button
                  type="button"
                  onClick={() => toggle(index)}
                  aria-expanded={isOpen}
                  aria-controls={`pricing-faq-panel-${index}`}
                  className="w-full min-h-[44px] flex items-center justify-between gap-3 text-left px-4 sm:px-5 py-4 cursor-pointer"
                >
                  <span className="text-sm sm:text-base font-semibold text-[#202020]">
                    {faq.question}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`shrink-0 text-[#ff4628] transition-transform duration-200 ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  >
                    ▼
                  </span>
                </button>
                {isOpen && (
                  <div
                    id={`pricing-faq-panel-${index}`}
                    className="px-4 sm:px-5 pb-4 text-sm sm:text-base leading-relaxed text-[#4a4f55] border-t border-[#dbe2ea] pt-3"
                  >
                    {faq.answer}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
