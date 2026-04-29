'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PlanId } from '@/lib/payment/plans'
import type { PaymentMethodType } from '@/lib/payment/channels'
import { trackEvent } from '@/lib/meta-pixel'

const PAY_METHODS: Record<PaymentMethodType, string> = {
  CARD: 'CARD',
  MOBILE: 'MOBILE_PHONE',
  KAKAOPAY: 'EASY_PAY',
}

interface Props {
  plan: PlanId
  paymentMethod: PaymentMethodType
  label?: string
  className?: string
}

export default function CheckoutButton({
  plan,
  paymentMethod,
  label = '구독 시작하기',
  className = '',
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleCheckout() {
    setLoading(true)
    setError(null)
    try {
      const payMethod = PAY_METHODS[paymentMethod]

      // 1. 서버에서 paymentId + 금액 + channelKey 발급
      const prepRes = await fetch('/api/payment/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, paymentMethod }),
      })
      if (!prepRes.ok) {
        const { error: msg } = await prepRes.json()
        throw new Error(msg ?? '결제 준비 실패')
      }
      const { paymentId, amount, orderName, customer, channelKey } = await prepRes.json()

      if (!channelKey) throw new Error('결제 채널 설정 오류. 잠시 후 다시 시도해주세요.')

      if (!window.PortOne) throw new Error('결제 모듈이 로드되지 않았습니다. 잠시 후 다시 시도해주세요.')

      const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID
      if (!storeId) throw new Error('결제 설정 오류')

      trackEvent('InitiateCheckout', {
        content_name: label || '구독',
        content_category: 'subscription',
        currency: 'KRW',
      })

      // 2. 결제창 호출 (결제 수단별 파라미터)
      const paymentParams: Record<string, unknown> = {
        storeId,
        channelKey,
        paymentId,
        orderName,
        totalAmount: amount,
        currency: 'KRW',
        payMethod,
        customer: { customerId: customer.customerId, email: customer.email },
        locale: 'KO_KR',
      }

      if (payMethod === 'EASY_PAY') {
        paymentParams.easyPay = { easyPayProvider: 'KAKAOPAY' }
      }

      const result = await window.PortOne.requestPayment(paymentParams)

      if (result.code) throw new Error(result.message ?? '결제가 취소되었습니다')

      // 3. 서버 검증
      const confirmRes = await fetch('/api/payment/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId }),
      })
      if (!confirmRes.ok) {
        const { error: msg } = await confirmRes.json()
        throw new Error(msg ?? '결제 검증 실패')
      }

      router.push(`/payment/success?paymentId=${paymentId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '결제 중 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={handleCheckout}
        disabled={loading}
        className={`w-full py-3 px-6 rounded-lg font-semibold transition-all
          ${loading ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90 active:scale-95'}
          ${className}`}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            처리 중...
          </span>
        ) : label}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-500 text-center">{error}</p>
      )}
    </div>
  )
}
