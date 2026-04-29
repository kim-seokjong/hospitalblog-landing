import type { Plan } from '@/lib/payment/plans'
import type { PaymentMethodType } from '@/lib/payment/channels'
import CheckoutButton from './CheckoutButton'
import BillingButton from './BillingButton'

interface Props {
  plan: Plan
  currentPlan?: string
  billingMode?: 'single' | 'recurring'
  paymentMethod?: PaymentMethodType
}

export default function PlanCard({
  plan,
  currentPlan,
  billingMode = 'single',
  paymentMethod = 'CARD',
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
      <div className="mt-3 mb-5">
        <span className="text-3xl font-extrabold text-white">
          {plan.price.toLocaleString()}
        </span>
        <span className="text-gray-400 text-sm ml-1">원/월</span>
      </div>

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
      ) : billingMode === 'recurring' ? (
        <BillingButton
          plan={plan.id}
          label="자동 갱신 구독하기"
          className={recommended
            ? 'bg-blue-500 text-white'
            : 'bg-gray-700 text-white border border-gray-600'}
        />
      ) : (
        <CheckoutButton
          plan={plan.id}
          paymentMethod={paymentMethod}
          label="구독 시작하기"
          className={recommended
            ? 'bg-blue-500 text-white'
            : 'bg-gray-700 text-white border border-gray-600'}
        />
      )}
    </div>
  )
}
