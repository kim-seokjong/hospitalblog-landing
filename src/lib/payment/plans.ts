export type PlanId = 'free' | 'basic' | 'standard' | 'pro'

export interface Plan {
  id: PlanId
  name: string
  price: number        // KRW 월 구독료 (0 = 무료)
  usageLimit: number   // 월 AI 생성 건수 (-1 = 무제한)
  features: string[]
  recommended?: boolean
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: '무료',
    price: 0,
    usageLimit: 2,
    features: ['AI 블로그 월 2건', 'SEO 분석'],
  },
  basic: {
    id: 'basic',
    name: '베이직',
    price: 99000,
    usageLimit: 10,
    features: ['AI 블로그 월 10건', 'SEO 분석', '네이버 검색 트렌드'],
  },
  standard: {
    id: 'standard',
    name: '스탠다드',
    price: 199000,
    usageLimit: 20,
    features: [
      'AI 블로그 월 20건',
      '이미지 생성 (실사/카드뉴스)',
      '독창성 검사',
      '의료광고법 검수',
      'SEO 분석',
      '네이버 검색 트렌드',
    ],
    recommended: true,
  },
  pro: {
    id: 'pro',
    name: '프로',
    price: 399000,
    usageLimit: -1,
    features: [
      '전 기능 무제한',
      '이미지 생성 (실사/카드뉴스)',
      '독창성 검사',
      '의료광고법 검수',
      'SEO 분석',
      '네이버 검색 트렌드',
      '우선 고객 지원',
    ],
  },
}

export const PAID_PLAN_IDS: PlanId[] = ['basic', 'standard', 'pro']

export function getPlan(id: PlanId): Plan {
  return PLANS[id]
}

export function isActivePlan(plan: PlanId, expiresAt: string | null): boolean {
  if (plan === 'free') return true
  if (!expiresAt) return false
  return new Date(expiresAt) > new Date()
}
