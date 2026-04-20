import { PLANS } from '@/lib/payment/plans'
import PlanCard from './PlanCard'

export default function PricingSection() {
  const plans = [PLANS.basic, PLANS.standard, PLANS.pro]
  return (
    <section id="pricing" className="py-20 bg-gray-950">
      <div className="max-w-5xl mx-auto px-4">
        <h2 className="text-3xl font-bold text-center text-white mb-2">요금제</h2>
        <p className="text-center text-gray-400 mb-12">병원 규모에 맞는 플랜을 선택하세요</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
        <p className="text-center text-gray-500 text-sm mt-8">
          모든 플랜은 월 단위 구독이며, 언제든지 해지 가능합니다.
        </p>
      </div>
    </section>
  )
}
