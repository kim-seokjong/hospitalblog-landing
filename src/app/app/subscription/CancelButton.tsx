'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function CancelButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleCancel() {
    const ok = confirm(
      '정말 자동갱신 구독을 해지하시겠어요?\n\n' +
        '해지하더라도 이미 결제한 기간(다음 결제일 전)까지는 정상 이용할 수 있습니다.\n' +
        '다음 결제일부터 자동 청구가 중단됩니다.',
    )
    if (!ok) return

    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/subscription/cancel', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '해지 처리 실패')
      alert(
        `구독이 해지되었습니다.${
          data.usableUntil ? `\n${data.usableUntil}까지 정상 이용 가능합니다.` : ''
        }`,
      )
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '해지 처리 중 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={handleCancel}
        disabled={loading}
        className={`w-full py-3 rounded-lg text-sm font-semibold border transition-all
          border-red-500/50 text-red-300 hover:bg-red-500/10
          ${loading ? 'opacity-60 cursor-not-allowed' : 'active:scale-95'}`}
      >
        {loading ? '처리 중...' : '구독 해지'}
      </button>
      {error && <p className="mt-2 text-xs text-red-400 text-center">{error}</p>}
    </div>
  )
}
