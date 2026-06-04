import type { Plan } from '@/payment/lib/plans'
import BillingButton from './BillingButton'

interface Props {
  plan: Plan
  currentPlan?: string
  requestAgreement?: () => boolean
  showPromo?: boolean
}

export default function PlanCard({
  plan,
  currentPlan,
  requestAgreement,
  showPromo = true,
}: Props) {
  const isCurrentPlan = currentPlan === plan.id
  const recommended = plan.recommended
  // 첫 달 할인 결제 플랜(프로): trialPrice > 0
  const isDiscountPlan = (plan.trialPrice ?? 0) > 0

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

      {showPromo && (
        <div className="mt-3 mb-1 inline-flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-[11px] sm:text-xs font-bold px-2.5 py-1 rounded-full self-start">
          {isDiscountPlan ? '🎁 첫 달 50% 할인' : '🎁 첫 달 무료'}
        </div>
      )}

      {showPromo ? (
        isDiscountPlan ? (
          // 프로: 정상가 취소선 + 첫 달 할인가 강조
          <>
            <div className="mt-2 mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-base sm:text-lg font-semibold text-gray-500 line-through">
                {plan.price.toLocaleString('ko-KR')}원
              </span>
              <span className="inline-flex items-center bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-[11px] sm:text-xs font-bold px-2 py-0.5 rounded-full">
                첫 달 50% 할인
              </span>
            </div>
            <div className="mb-1 flex flex-wrap items-baseline gap-x-1">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-300">
                {(plan.trialPrice ?? 0).toLocaleString('ko-KR')}
              </span>
              <span className="text-emerald-300/90 text-sm">원</span>
              <span className="text-gray-400 text-xs sm:text-sm">/ 첫 달</span>
            </div>
            <p className="text-[11px] text-gray-500 mb-5">
              둘째 달부터 매월 {plan.price.toLocaleString('ko-KR')}원 자동결제
            </p>
          </>
        ) : (
          // 베이직/스탠다드: 정상가 취소선 + "첫 달 무료" 강조
          <>
            <div className="mt-2 mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-base sm:text-lg font-semibold text-gray-500 line-through">
                {plan.price.toLocaleString('ko-KR')}원
              </span>
              <span className="text-gray-400 text-xs sm:text-sm">/월</span>
            </div>
            <div className="mb-1">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-300">첫 달 무료</span>
            </div>
            <p className="text-[11px] text-gray-500 mb-5">
              둘째 달부터 매월 {plan.price.toLocaleString('ko-KR')}원 자동결제
            </p>
          </>
        )
      ) : (
        // 로그인 회원: 정상가만 표시
        <>
          <div className="mt-3 mb-1">
            <span className="text-3xl font-extrabold text-white">
              {plan.price.toLocaleString('ko-KR')}
            </span>
            <span className="text-gray-400 text-sm ml-1">원/월</span>
          </div>
          <p className="text-xs text-blue-300/80 mb-5">매월 자동결제</p>
        </>
      )}

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
