'use client'

import { useRef, useState, useCallback } from 'react'
import { PLANS } from '@/payment/lib/plans'
import PlanCard from './PlanCard'

export default function PricingSection() {
  const [agreed, setAgreed] = useState(false)
  const [showAgreementError, setShowAgreementError] = useState(false)
  const agreementRef = useRef<HTMLDivElement | null>(null)
  const plans = [PLANS.basic, PLANS.standard, PLANS.pro]

  const requestAgreement = useCallback((): boolean => {
    if (agreed) {
      setShowAgreementError(false)
      return true
    }
    setShowAgreementError(true)
    agreementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return false
  }, [agreed])

  const handleAgreedChange = (next: boolean) => {
    setAgreed(next)
    if (next) setShowAgreementError(false)
  }

  return (
    <section id="pricing" className="py-12 sm:py-20 bg-gray-950">
      <div className="max-w-5xl mx-auto px-4">
        <h2 className="text-2xl sm:text-3xl font-bold text-center text-white mb-2">요금제</h2>
        <p className="text-center text-sm sm:text-base text-gray-400 mb-3">
          병원 규모에 맞는 플랜을 선택하세요
        </p>

        <div className="mx-auto max-w-2xl bg-blue-950/40 border border-blue-900 rounded-xl px-4 py-3 mb-8 text-center">
          <p className="text-sm text-blue-200 font-semibold">
            🔒 매월 자동결제 · 언제든 해지 가능
          </p>
          <p className="text-xs text-blue-300/80 mt-1">
            카드 등록 후 매월 같은 날 자동 청구됩니다. 다음 결제 7일 전 안내 메일을 보내드립니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              requestAgreement={requestAgreement}
            />
          ))}
        </div>

        <div
          ref={agreementRef}
          className={`mt-8 mx-auto max-w-2xl rounded-xl border px-4 sm:px-5 py-4 transition-colors
            ${showAgreementError
              ? 'border-red-500/70 bg-red-950/30'
              : 'border-gray-700 bg-gray-900'}`}
        >
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => handleAgreedChange(e.target.checked)}
              className="mt-1 w-5 h-5 shrink-0 accent-blue-500 cursor-pointer"
              aria-describedby="agreement-error"
            />
            <span className="text-sm leading-relaxed text-gray-200">
              <strong className="text-white">매월 자동결제</strong>에 동의하며,{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">이용약관</a>
              {', '}
              <a href="/refund" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">환불·해지정책</a>
              {', '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">개인정보처리방침</a>
              에 동의합니다. <span className="text-red-400">(필수)</span>
            </span>
          </label>
          {showAgreementError && (
            <p id="agreement-error" className="mt-2 ml-8 text-xs text-red-400">
              결제 전 약관 동의가 필요합니다.
            </p>
          )}
        </div>

        <p className="text-center text-gray-500 text-xs sm:text-sm mt-6 sm:mt-8 px-2">
          해지는 마이페이지에서 1클릭으로 가능하며, 다음 결제일까지 이용할 수 있습니다.
        </p>
      </div>
    </section>
  )
}
