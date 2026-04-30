'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PlanId } from '@/lib/payment/plans'
import type { PaymentMethodType } from '@/lib/payment/channels'
import { trackEvent } from '@/lib/meta-pixel'

interface Props {
  plan: PlanId
  paymentMethod?: PaymentMethodType
  label?: string
  className?: string
}

export default function BillingButton({
  plan,
  paymentMethod = 'CARD',
  label = '자동 갱신 구독하기',
  className = '',
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleBilling() {
    setLoading(true)
    setError(null)
    try {
      // 1. 서버에서 paymentId + channelKey + 고객정보 발급
      const prepRes = await fetch('/api/payment/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, paymentMethod }),
      })
      if (!prepRes.ok) {
        const { error: msg } = await prepRes.json()
        throw new Error(msg ?? '결제 준비 실패')
      }
      const { paymentId, orderName, channelKey, customer } = await prepRes.json()

      if (!window.PortOne) {
        throw new Error('결제 모듈이 로드되지 않았습니다. 페이지를 새로고침 후 다시 시도해주세요.')
      }

      const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID
      if (!storeId) throw new Error('결제 설정 오류')

      trackEvent('InitiateCheckout', {
        content_name: '정기구독',
        content_category: 'subscription_recurring',
        currency: 'KRW',
      })

      // 2. 빌링키 발급 (카드/카카오페이 등록, 결제는 서버에서)
      const issueFn = (window.PortOne as Record<string, unknown>)['requestIssueBillingKey'] as
        | ((params: unknown) => Promise<{ billingKey?: string; code?: string; message?: string }>)
        | undefined

      if (typeof issueFn !== 'function') {
        throw new Error('이 결제수단은 정기구독을 지원하지 않습니다.')
      }

      const issueParams: Record<string, unknown> = {
        storeId,
        channelKey,
        issueName: orderName,
        billingKeyMethod: paymentMethod === 'KAKAOPAY' ? 'EASY_PAY' : 'CARD',
        customer: { customerId: customer.customerId, email: customer.email },
        locale: 'KO_KR',
      }
      if (paymentMethod === 'KAKAOPAY') {
        issueParams.easyPay = { easyPayProvider: 'KAKAOPAY' }
      }

      const result = await issueFn(issueParams)

      if (result.code) throw new Error(result.message ?? '카드 등록이 취소되었습니다')
      if (!result.billingKey) throw new Error('빌링키 발급에 실패했습니다')

      // 3. 서버에서 첫 결제 실행 + 빌링키 저장 + 플랜 활성화
      const confirmRes = await fetch('/api/payment/billing/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, billingKey: result.billingKey }),
      })
      if (!confirmRes.ok) {
        const { error: msg } = await confirmRes.json()
        throw new Error(msg ?? '결제 처리 실패')
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
        onClick={handleBilling}
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
