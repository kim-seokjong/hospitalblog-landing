'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { PLANS, isFirstMonthPromoActive } from '@/payment/lib/plans'
import PlanCard from './PlanCard'
import PromoCountdown from './PromoCountdown'

export default function PricingSection() {
  const [agreed, setAgreed] = useState(false)
  const [showAgreementError, setShowAgreementError] = useState(false)
  const agreementRef = useRef<HTMLDivElement | null>(null)
  // 첫 달 프로모 유효 여부(마감시각 연동). SSR/CSR 하이드레이션 일치를 위해
  // 초기값은 프로모 표시(true)로 두고, 마운트 후 실제 마감시각으로 보정한다.
  // 마감(오늘 밤 자정) 이후엔 자동으로 false → 화면이 정상가로 전환된다.
  const [promoActive, setPromoActive] = useState(true)
  useEffect(() => {
    setPromoActive(isFirstMonthPromoActive())
    // 자정 경계에서 페이지를 열어둔 경우에도 전환되도록 1분마다 재평가
    const id = setInterval(() => setPromoActive(isFirstMonthPromoActive()), 60_000)
    return () => clearInterval(id)
  }, [])
  // 공개 플랜만 노출 (레거시 베이직 제외). 블로그 전용 그룹 / 번들 그룹으로 분리.
  const blogPlans = [PLANS.standard, PLANS.pro]
  const bundlePlans = [PLANS.growth8_standard, PLANS.pro12_pro]

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

        {promoActive && (
          <div className="mx-auto max-w-2xl bg-gradient-to-b from-[#1f1f1f] to-[#0c0c0c] border border-[#d4af37]/45 rounded-xl px-4 py-4 mb-4 text-center shadow-[0_0_34px_-10px_rgba(212,175,55,0.55)]">
            <p className="text-lg sm:text-xl font-extrabold shine-gold drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
              🎉 6월 한정 — 스탠다드 첫 달 0원 / 프로·클리닉픽스 번들 첫 달 50% 할인
            </p>
            <p className="text-xs sm:text-sm text-[#d9c690] mt-1.5">
              지금 시작하면 첫 달 혜택 · <strong>둘째 달부터</strong> 매월 자동결제 · 7월부터 정상가
            </p>
            <PromoCountdown />
          </div>
        )}

        <div className="mx-auto max-w-2xl bg-[#ffece7] border border-[#ff4628]/30 rounded-xl px-4 py-3 mb-8 text-center">
          <p className="text-sm text-[#ff4628] font-semibold">
            🔒 {promoActive ? '둘째 달부터 매월 자동결제' : '매월 자동결제'} · 언제든 해지 가능
          </p>
          <p className="text-xs text-[#4a4f55] mt-1">
            {promoActive
              ? '6월 한정으로 스탠다드는 첫 달 0원, 프로·클리닉픽스 번들은 첫 달 50% 할인가가 청구되며, 둘째 달부터 매월 같은 날 정상가로 자동 청구됩니다. 7월부터는 전 플랜이 첫 달부터 정상가로 청구됩니다. 결제 7일 전 안내 메일을 보내드립니다.'
              : '전 플랜은 가입 시점부터 정상가로 매월 같은 날 자동 청구됩니다. 결제 7일 전 안내 메일을 보내드립니다.'}
          </p>
        </div>

        {/* 블로그 전용 (닥터포스트) */}
        <div className="mb-3">
          <h3 className="text-lg sm:text-xl font-bold text-[#202020]">블로그 자동화</h3>
          <p className="text-xs sm:text-sm text-[#5b6573] mt-0.5">AI 블로그 + 이미지 생성</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
          {blogPlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              showPromo={promoActive}
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
            블로그·AI 영상·멀티채널 콘텐츠를 한 번에
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
          {bundlePlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              showPromo={promoActive}
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
              <strong className="text-[#202020]">
                {promoActive
                  ? '첫 달 혜택(6월 한정 — 스탠다드 0원 / 프로·번들 50% 할인), 둘째 달부터 매월 자동결제'
                  : '매월 자동결제(가입 시점부터 정상가)'}
              </strong>에 동의하며,{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-[#ff4628] underline hover:text-[#e63a1c]">이용약관</a>
              {', '}
              <a href="/refund" target="_blank" rel="noopener noreferrer" className="text-[#ff4628] underline hover:text-[#e63a1c]">환불·해지정책</a>
              {', '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[#ff4628] underline hover:text-[#e63a1c]">개인정보처리방침</a>
              에 동의합니다. <span className="text-red-600">(필수)</span>
            </span>
          </label>
          {showAgreementError && (
            <p id="agreement-error" className="mt-2 ml-8 text-xs text-red-600">
              결제 전 약관 동의가 필요합니다.
            </p>
          )}
        </div>

        <p className="text-center text-[#5b6573] text-xs sm:text-sm mt-6 sm:mt-8 px-2">
          해지는 마이페이지에서 1클릭으로 가능합니다. 무료 체험 중 해지 시 청구 없이 즉시 종료되며, 유료 기간 해지 시 다음 결제일까지 이용할 수 있습니다.
        </p>
      </div>
    </section>
  )
}
