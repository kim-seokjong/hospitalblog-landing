import type { Plan } from '@/payment/lib/plans'
import BillingButton from './BillingButton'

interface Props {
  plan: Plan
  currentPlan?: string
  requestAgreement?: () => boolean
}

/** 분리 한도(-1=무제한, 0=미포함)를 한국어 표기로 변환 */
function formatLimit(value: number, unit: string): string {
  if (value === -1) return '무제한'
  return `${value}${unit}`
}

export default function PlanCard({
  plan,
  currentPlan,
  requestAgreement,
}: Props) {
  const isCurrentPlan = currentPlan === plan.id
  const recommended = plan.recommended

  return (
    <div className={`relative flex flex-col rounded-2xl p-6
      ${recommended
        ? 'border-2 border-[#ff4628] bg-white shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]'
        : 'border border-[#b4bfce] bg-white shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]'}`}
    >
      {recommended && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white text-xs font-bold px-3 py-1 rounded-full">
          가장 인기
        </span>
      )}

      <h3 className="text-lg font-bold text-[#202020]">{plan.name}</h3>

      {/* 정상가 단일 표시 (2026-07 프로모 전면 종료) */}
      <div className="mt-3 mb-1">
        <span className="text-3xl font-extrabold text-[#202020]">
          {plan.price.toLocaleString('ko-KR')}
        </span>
        <span className="text-[#5b6573] text-sm ml-1">원/월</span>
      </div>
      <p className="text-xs text-[#5b6573] mb-5">매월 자동결제</p>

      {/* 분리 한도 요약 (블로그/영상/채널) */}
      <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl bg-[#f6f8fb] border border-[#e3e9f0] p-2.5 text-center">
        <div>
          <p className="text-[10px] text-[#5b6573]">블로그</p>
          <p className="text-sm font-bold text-[#202020]">{formatLimit(plan.limits.blog, '건')}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#5b6573]">영상</p>
          <p className={`text-sm font-bold ${plan.limits.video === 0 ? 'text-[#b4bfce]' : 'text-[#202020]'}`}>
            {plan.limits.video === 0 ? '–' : formatLimit(plan.limits.video, '건')}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[#5b6573]">채널</p>
          <p className={`text-sm font-bold ${plan.limits.channels === 0 ? 'text-[#b4bfce]' : 'text-[#202020]'}`}>
            {plan.limits.channels === 0 ? '–' : formatLimit(plan.limits.channels, '건')}
          </p>
        </div>
      </div>
      {plan.fairUseCap != null && (
        <p className="-mt-2 mb-4 text-[11px] text-[#5b6573]">
          채널 무제한은 공정사용 정책(월 {plan.fairUseCap}세트)이 적용됩니다.
        </p>
      )}

      <ul className="flex-1 space-y-2 mb-6">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-[#4a4f55]">
            <svg className="w-4 h-4 mt-0.5 text-[#ff4628] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
            </svg>
            {f}
          </li>
        ))}
      </ul>

      {isCurrentPlan ? (
        <div className="w-full py-3 text-center rounded-lg bg-[#eef2f6] text-[#5b6573] text-sm font-medium">
          현재 사용 중
        </div>
      ) : (
        <BillingButton
          plan={plan.id}
          label="자동 갱신 구독 시작"
          className={recommended
            ? 'bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white'
            : 'bg-[#202020] text-white border border-[#202020]'}
          requestAgreement={requestAgreement}
        />
      )}
    </div>
  )
}
