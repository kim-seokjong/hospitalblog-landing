'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PLANS, isCarePlanId, type PlanId } from '@/payment/lib/plans'
import { trackEvent } from '@/dev/lib/meta-pixel'

interface Props {
  plan: PlanId
  label?: string
  className?: string
  requestAgreement?: () => boolean
}

export default function BillingButton({
  plan,
  label = '자동 갱신 구독하기',
  className = '',
  requestAgreement,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleBilling() {
    if (requestAgreement && !requestAgreement()) return
    setLoading(true)
    setError(null)
    try {
      // 케어 플랜: requestAgreement 통과 = 특약(제8조의2) 포함 동의 문구에 체크한 상태.
      // 서버(prepare)가 careTermsAgreed 를 필수로 검증한다.
      const prepRes = await fetch('/api/payment/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isCarePlanId(plan) ? { plan, careTermsAgreed: true } : { plan },
        ),
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

      if (typeof window.PortOne.requestIssueBillingKey !== 'function') {
        throw new Error('정기구독을 지원하지 않는 환경입니다.')
      }

      const customerPayload: Record<string, unknown> = {
        customerId: customer.customerId,
        email: customer.email,
        fullName: customer.fullName ?? '구매자',
      }
      if (customer.phoneNumber) {
        customerPayload.phoneNumber = customer.phoneNumber
      }

      const result = await window.PortOne.requestIssueBillingKey({
        storeId,
        channelKey,
        issueId: paymentId,
        issueName: orderName,
        billingKeyMethod: 'CARD',
        customer: customerPayload,
        locale: 'KO_KR',
      })

      if (result.code) throw new Error(result.message ?? '카드 등록이 취소되었습니다')
      if (!result.billingKey) throw new Error('빌링키 발급에 실패했습니다')

      const confirmRes = await fetch('/api/payment/billing/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, billingKey: result.billingKey }),
      })
      if (!confirmRes.ok) {
        const { error: msg } = await confirmRes.json()
        throw new Error(msg ?? '결제 처리 실패')
      }

      // PortOne 빌링키 발급 + 서버 결제 확정이 모두 성공한 지점 = 결제 성공 콜백.
      // 리다이렉트 직전에 발송해 성공 페이지 새로고침으로 인한 중복 집계를 피한다.
      trackEvent('Purchase', {
        content_name: PLANS[plan].name,
        content_category: 'subscription_recurring',
        content_ids: [plan],
        value: PLANS[plan].price,
        currency: 'KRW',
      })

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
