'use client'

import { useState } from 'react'
import { PRICING_FAQS } from '@/payment/lib/pricingFaq'

// 가격 페이지 FAQ 아코디언 (결제팀 소관)
// 팔레트: 가격 페이지(bg-gray-950)·환불 페이지(bg-gray-900 카드) 기존 톤 그대로 사용 — 신규 색상 도입 금지

export default function PricingFaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const toggle = (index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index))
  }

  return (
    <section aria-labelledby="pricing-faq-heading" className="py-12 sm:py-16 bg-gray-950">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <h2
          id="pricing-faq-heading"
          className="text-2xl sm:text-3xl font-bold text-center text-white mb-2"
        >
          자주 묻는 질문
        </h2>
        <p className="text-center text-sm sm:text-base text-gray-400 mb-8">
          요금제·결제·해지에 대해 궁금한 점을 확인하세요
        </p>

        <div className="space-y-3">
          {PRICING_FAQS.map((faq, index) => {
            const isOpen = openIndex === index
            return (
              <div
                key={faq.question}
                className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggle(index)}
                  aria-expanded={isOpen}
                  aria-controls={`pricing-faq-panel-${index}`}
                  className="w-full min-h-[44px] flex items-center justify-between gap-3 text-left px-4 sm:px-5 py-4 cursor-pointer"
                >
                  <span className="text-sm sm:text-base font-semibold text-gray-200">
                    {faq.question}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`shrink-0 text-blue-400 transition-transform duration-200 ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  >
                    ▼
                  </span>
                </button>
                {isOpen && (
                  <div
                    id={`pricing-faq-panel-${index}`}
                    className="px-4 sm:px-5 pb-4 text-sm sm:text-base leading-relaxed text-gray-400 border-t border-gray-800 pt-3"
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
