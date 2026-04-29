'use client'

import { useState } from 'react'
import { PLANS } from '@/lib/payment/plans'
import type { PaymentMethodType } from '@/lib/payment/channels'
import PlanCard from './PlanCard'

type BillingMode = 'single' | 'recurring'

const PAYMENT_METHODS: { type: PaymentMethodType; label: string; icon: string }[] = [
  { type: 'CARD',     label: '신용/체크카드', icon: '💳' },
  { type: 'MOBILE',   label: '휴대폰 결제',   icon: '📱' },
  { type: 'KAKAOPAY', label: '카카오페이',    icon: '💛' },
]

export default function PricingSection() {
  const [mode, setMode] = useState<BillingMode>('single')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('CARD')
  const plans = [PLANS.basic, PLANS.standard, PLANS.pro]

  return (
    <section id="pricing" className="py-20 bg-gray-950">
      <div className="max-w-5xl mx-auto px-4">
        <h2 className="text-3xl font-bold text-center text-white mb-2">요금제</h2>
        <p className="text-center text-gray-400 mb-8">병원 규모에 맞는 플랜을 선택하세요</p>

        {/* 결제 방식 탭 (단건 / 정기) */}
        <div className="flex justify-center mb-4">
          <div className="flex bg-gray-800 rounded-xl p-1 gap-1">
            <button
              onClick={() => setMode('single')}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all
                ${mode === 'single'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'}`}
            >
              이번 달만 결제
            </button>
            <button
              onClick={() => setMode('recurring')}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all
                ${mode === 'recurring'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'}`}
            >
              자동 갱신 구독
            </button>
          </div>
        </div>

        {/* 결제 수단 탭 (단건결제일 때만 표시) */}
        {mode === 'single' && (
          <div className="flex justify-center mb-10">
            <div className="flex bg-gray-900 border border-gray-700 rounded-xl p-1 gap-1">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.type}
                  onClick={() => setPaymentMethod(m.type)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all
                    ${paymentMethod === m.type
                      ? 'bg-gray-700 text-white shadow'
                      : 'text-gray-500 hover:text-gray-300'}`}
                >
                  <span>{m.icon}</span>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 정기구독 설명 */}
        {mode === 'recurring' && (
          <p className="text-center text-green-400 text-sm mb-10">
            카드 한 번 등록으로 매월 자동 결제됩니다
          </p>
        )}

        {/* 단건결제 설명 */}
        {mode === 'single' && (
          <p className="text-center text-gray-500 text-xs mb-6 -mt-6">
            {paymentMethod === 'CARD' && '갤럭시아머니트리 · 인증 단건결제'}
            {paymentMethod === 'MOBILE' && '다날 · 휴대폰 소액결제'}
            {paymentMethod === 'KAKAOPAY' && '카카오페이 · 간편결제'}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              billingMode={mode}
              paymentMethod={paymentMethod}
            />
          ))}
        </div>

        <p className="text-center text-gray-500 text-sm mt-8">
          {mode === 'single'
            ? '월 단위 인증 단건결제이며, 언제든지 해지 가능합니다.'
            : '자동 갱신 구독이며, 언제든지 해지 가능합니다.'}
        </p>
      </div>
    </section>
  )
}
