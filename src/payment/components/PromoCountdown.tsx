'use client'

import { useEffect, useState } from 'react'

// 6월 한정 프로모 마감: 6월 30일 24:00(KST) = 7월 1일 0시(KST)
const DEADLINE = new Date('2026-07-01T00:00:00+09:00').getTime()

interface Remaining {
  days: number
  hours: number
  minutes: number
  seconds: number
}

function calc(): Remaining | null {
  const diff = DEADLINE - Date.now()
  if (diff <= 0) return null
  const total = Math.floor(diff / 1000)
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  }
}

/**
 * 6월 프로모 마감까지 남은 시간 카운트다운.
 * SSR/CSR 시간 차이로 인한 하이드레이션 불일치를 막기 위해 마운트 후에만 렌더한다.
 * 마감(혹은 마감 후)이면 아무것도 렌더하지 않는다.
 */
export default function PromoCountdown() {
  const [remaining, setRemaining] = useState<Remaining | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setRemaining(calc())
    const id = setInterval(() => setRemaining(calc()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!mounted || !remaining) return null

  const units: { n: number; label: string }[] = [
    { n: remaining.days, label: '일' },
    { n: remaining.hours, label: '시간' },
    { n: remaining.minutes, label: '분' },
    { n: remaining.seconds, label: '초' },
  ]

  return (
    <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
      <span className="text-xs sm:text-sm text-[#e8d6a0] font-semibold">⏳ 마감까지</span>
      <div className="flex items-end gap-1.5">
        {units.map((u) => (
          <div key={u.label} className="flex flex-col items-center">
            <span className="bg-gradient-to-b from-[#f9e8a8] to-[#d4af37] text-[#1a1a1a] font-bold tabular-nums rounded-md px-2 py-1 text-sm sm:text-base min-w-[2.3rem] text-center shadow-[0_0_12px_-2px_rgba(212,175,55,0.7)]">
              {String(u.n).padStart(2, '0')}
            </span>
            <span className="text-[10px] text-[#e8d6a0] mt-0.5">{u.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
