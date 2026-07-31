'use client'

import { useRef, useState, useCallback } from 'react'
import { PLANS } from '@/payment/lib/plans'
import PlanCard from './PlanCard'

export default function PricingSection() {
  const [agreed, setAgreed] = useState(false)
  const [showAgreementError, setShowAgreementError] = useState(false)
  const agreementRef = useRef<HTMLDivElement | null>(null)
  // 공개 플랜만 노출 (레거시 베이직·프로 2종 제외). 블로그 전용 그룹 / 번들 그룹으로 분리.
  // 각 그룹 = 셀프 발행 + 발행 대행(케어) 한 쌍 (2026-07-31 개편).
  const blogPlans = [PLANS.standard, PLANS.standard_care]
  const bundlePlans = [PLANS.growth8_standard, PLANS.growth_care]

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
    <section id="pricing" className="py-12 sm:py-20 bg-white">
      <div className="max-w-5xl mx-auto px-4">
        <h2 className="text-2xl sm:text-3xl font-bold text-center text-[#202020] mb-2">요금제</h2>
        <p className="text-center text-sm sm:text-base text-[#5b6573] mb-3">
          병원 규모에 맞는 플랜을 선택하세요
        </p>

        <div className="mx-auto max-w-2xl bg-[#ffece7] border border-[#ff4628]/30 rounded-xl px-4 py-3 mb-8 text-center">
          <p className="text-sm text-[#ff4628] font-semibold">
            🔒 매월 자동결제 · 언제든 해지 가능
          </p>
          <p className="text-xs text-[#4a4f55] mt-1">
            전 플랜은 가입 시점부터 정상가로 매월 같은 날 자동 청구됩니다. 결제 7일 전 안내 메일을 보내드립니다.
          </p>
        </div>

        {/* 블로그 전용 (닥터포스트) */}
        <div className="mb-3">
          <h3 className="text-lg sm:text-xl font-bold text-[#202020]">블로그 자동화</h3>
          <p className="text-xs sm:text-sm text-[#5b6573] mt-0.5">
            AI 블로그 + 이미지 생성 · 케어 플랜은 네이버 블로그 발행까지 대행합니다
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
          {blogPlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              requestAgreement={requestAgreement}
            />
          ))}
        </div>

        {/* 번들 (클리닉픽스: 블로그 + 영상 + 멀티채널) */}
        <div className="mt-10 mb-3">
          <h3 className="text-lg sm:text-xl font-bold text-[#202020]">
            블로그 + 영상 + 멀티채널
            <span className="ml-2 inline-flex items-center bg-[#ffece7] border border-[#ff4628]/30 text-[#ff4628] text-[11px] sm:text-xs font-bold px-2 py-0.5 rounded-full align-middle">
              ClinicFlix
            </span>
          </h3>
          <p className="text-xs sm:text-sm text-[#5b6573] mt-0.5">
            블로그·AI 영상·멀티채널 콘텐츠를 한 번에 · 케어 플랜은 채널 발행까지 대행합니다
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
          {bundlePlans.map((plan) => (
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
              ? 'border-red-300 bg-red-50'
              : 'border-[#b4bfce] bg-white'}`}
        >
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => handleAgreedChange(e.target.checked)}
              className="mt-1 w-5 h-5 shrink-0 accent-[#ff4628] cursor-pointer"
              aria-describedby="agreement-error"
            />
            <span className="text-sm leading-relaxed text-[#4a4f55]">
              <strong className="text-[#202020]">매월 자동결제(가입 시점부터 정상가)</strong>에 동의하며,{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-[#ff4628] underline hover:text-[#e63a1c]">이용약관</a>
              {', '}
              <a href="/refund" target="_blank" rel="noopener noreferrer" className="text-[#ff4628] underline hover:text-[#e63a1c]">환불·해지정책</a>
              {', '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[#ff4628] underline hover:text-[#e63a1c]">개인정보처리방침</a>
              에 동의합니다. 케어 플랜 구독 시 이용약관 내{' '}
              <strong className="text-[#202020]">계정 위임·발행 대행 특약(제8조의2)</strong>에도
              함께 동의합니다. <span className="text-red-600">(필수)</span>
            </span>
          </label>
          {showAgreementError && (
            <p id="agreement-error" className="mt-2 ml-8 text-xs text-red-600">
              결제 전 약관 동의가 필요합니다.
            </p>
          )}
        </div>

        <p className="text-center text-[#5b6573] text-xs sm:text-sm mt-6 sm:mt-8 px-2">
          해지는 마이페이지에서 1클릭으로 가능합니다. 해지 시 다음 결제일까지 이용할 수 있습니다.
        </p>
      </div>
    </section>
  )
}
