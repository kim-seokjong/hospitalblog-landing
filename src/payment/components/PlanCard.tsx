import type { Plan } from '@/payment/lib/plans'
import BillingButton from './BillingButton'

interface Props {
  plan: Plan
  currentPlan?: string
  requestAgreement?: () => boolean
}

export default function PlanCard({
  plan,
  currentPlan,
  requestAgreement,
}: Props) {
  const isCurrentPlan = currentPlan === plan.id
  const recommended = plan.recommended

  return (
    <div className={`relative flex flex-col rounded-2xl border p-6
      ${recommended
        ? 'border-blue-500 bg-blue-950/40 shadow-lg shadow-blue-500/20'
        : 'border-gray-700 bg-gray-900'}`}
    >
      {recommended && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full">
          추천
        </span>
      )}

      <h3 className="text-lg font-bold text-white">{plan.name}</h3>

      <div className="mt-3 mb-1 inline-flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-[11px] sm:text-xs font-bold px-2.5 py-1 rounded-full self-start">
        🎁 첫 달 무료
      </div>

      <div className="mt-2 mb-1">
        <span className="text-3xl font-extrabold text-white">
          {plan.price.toLocaleString()}
        </span>
        <span className="text-gray-400 text-sm ml-1">원/월</span>
      </div>
      <p className="text-xs text-blue-300/80 mb-1">다음 달부터 매월 자동결제</p>
      <p className="text-[11px] text-gray-500 mb-5">
        가입 후 30일 동안 0원으로 이용
      </p>

      <ul className="flex-1 space-y-2 mb-6">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
            <svg className="w-4 h-4 mt-0.5 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
            </svg>
            {f}
          </li>
        ))}
      </ul>

      {isCurrentPlan ? (
        <div className="w-full py-3 text-center rounded-lg bg-gray-700 text-gray-400 text-sm font-medium">
          현재 사용 중
        </div>
      ) : (
        <BillingButton
          plan={plan.id}
          label="자동 갱신 구독 시작"
          className={recommended
            ? 'bg-blue-500 text-white'
            : 'bg-gray-700 text-white border border-gray-600'}
          requestAgreement={requestAgreement}
        />
      )}
    </div>
  )
}
