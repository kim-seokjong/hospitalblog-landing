export type PlanId = 'basic' | 'standard' | 'pro'

export interface Plan {
  id: PlanId
  name: string
  price: number        // KRW 월 구독료
  usageLimit: number   // 월 AI 생성 건수 (-1 = 무제한)
  features: string[]
  recommended?: boolean
}

export const PLANS: Record<PlanId, Plan> = {
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

/**
 * 유효한 유료 플랜 ID인지 검사 (DB legacy 'free' / null 차단용)
 */
export function isPaidPlanId(value: string | null | undefined): value is PlanId {
  return value === 'basic' || value === 'standard' || value === 'pro'
}

/**
 * 만료일 기준 활성 여부 — 유료 플랜만 유효
 */
export function isActivePlan(plan: string | null | undefined, expiresAt: string | null): boolean {
  if (!isPaidPlanId(plan)) return false
  if (!expiresAt) return false
  return new Date(expiresAt) > new Date()
}
