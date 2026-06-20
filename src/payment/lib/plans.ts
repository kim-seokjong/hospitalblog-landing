// 플랜 정의 (단일 소스). 결제·사용량 가드·마이페이지·관리자·SEO 가 모두 참조한다.
//
// 플랜 구조 (2026-06 개편):
//   [블로그 전용 — DoctorPost]
//     standard  스탠다드  ₩199,000  블로그 20 + 이미지
//     pro       프로      ₩399,000  블로그 무제한 (첫 달 ₩199,000)
//   [번들 — ClinicFlix (블로그 + 영상 + 멀티채널)]
//     growth8_standard  올인원 그로스  ₩499,000  블로그 20 / 영상 8 / 채널 20
//     pro12_pro         올인원 프로     ₩699,000  블로그 무제한 / 영상 12 / 채널 무제한(공정사용 소프트캡 60)
//   [레거시 — 공개 비노출]
//     basic     베이직    ₩99,000   블로그 10  ← 신규 판매 중단(아래 LEGACY 주석 참조)

export type PlanId =
  | 'basic' // LEGACY (hidden)
  | 'standard'
  | 'pro'
  | 'growth8_standard'
  | 'pro12_pro'

export type PlanCategory = 'blog' | 'bundle'

/**
 * 분리된 사용 한도.
 *  -1 = 무제한, 0 = 미포함
 *   blog     월 블로그(AI 본문) 생성 건수
 *   video    월 영상 생성 건수      (ClinicFlix 연동 전까지 enforce 미구현)
 *   channels 월 멀티채널 세트 건수  (쓰레드·카드뉴스·인스타·스토리 등)
 */
export interface PlanLimits {
  blog: number
  video: number
  channels: number
}

export interface Plan {
  id: PlanId
  name: string
  category: PlanCategory
  price: number // KRW 월 구독료
  trialPrice?: number // 첫 달 적용 가격, KRW (미설정 시 0원 무료)
  limits: PlanLimits
  /**
   * 채널 무제한 플랜의 월간 공정사용(fair-use) 소프트캡 (세트 기준).
   * limits.channels === -1 인 플랜에만 의미가 있다. 하드 차단이 아닌 안내/모니터링용.
   */
  fairUseCap?: number
  /**
   * @deprecated 하위호환 별칭. 항상 limits.blog 와 동일하게 설정한다.
   * 기존 코드(usage-guard, mypage, notification-service 등)가 `plan.usageLimit`(월 블로그 한도)
   * 을 참조하므로 제거하지 않는다. 신규 코드는 limits.blog 를 직접 사용할 것.
   */
  usageLimit: number
  features: string[]
  recommended?: boolean
  /** 공개 요금제(PricingSection)에 노출하지 않는 레거시/숨김 플랜 */
  hidden?: boolean
}

export const PLANS: Record<PlanId, Plan> = {
  // ──────────────────────────────────────────────────────────────
  // LEGACY: 베이직은 신규 공개 판매를 중단했다(2026-06 개편).
  // 기존 베이직 구독자(grandfathered)의 사용량/결제 enforce 를 위해 정의는 유지한다.
  // PricingSection 등 공개 UI 에는 hidden:true 로 노출하지 않는다.
  // DB profiles.plan / payments.plan 의 'basic' 행은 계속 유효해야 한다.
  // ──────────────────────────────────────────────────────────────
  basic: {
    id: 'basic',
    name: '베이직',
    category: 'blog',
    price: 99000,
    trialPrice: 0,
    limits: { blog: 10, video: 0, channels: 0 },
    usageLimit: 10, // = limits.blog (deprecated alias)
    features: ['AI 블로그 월 10건', 'SEO 분석', '네이버 검색 트렌드'],
    hidden: true,
  },

  // ───────────── 블로그 전용 (DoctorPost) ─────────────
  standard: {
    id: 'standard',
    name: '스탠다드',
    category: 'blog',
    price: 199000,
    trialPrice: 0,
    limits: { blog: 20, video: 0, channels: 0 },
    usageLimit: 20, // = limits.blog
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
    category: 'blog',
    price: 399000,
    trialPrice: 199000,
    limits: { blog: -1, video: 0, channels: 0 },
    usageLimit: -1, // = limits.blog
    features: [
      'AI 블로그 무제한',
      '이미지 생성 (실사/카드뉴스)',
      '독창성 검사',
      '의료광고법 검수',
      'SEO 분석',
      '네이버 검색 트렌드',
      '우선 고객 지원',
    ],
  },

  // ───────────── 번들 (ClinicFlix: 블로그 + 영상 + 멀티채널) ─────────────
  growth8_standard: {
    id: 'growth8_standard',
    name: '올인원 그로스',
    category: 'bundle',
    price: 499000,
    trialPrice: 249500, // 6월 한정 첫 달 50% 할인 (499,000 → 249,500)
    limits: { blog: 20, video: 8, channels: 20 },
    usageLimit: 20, // = limits.blog
    features: [
      'AI 블로그 월 20건',
      'AI 영상 월 8건',
      '멀티채널 세트 월 20건 (쓰레드·카드뉴스·인스타·스토리)',
      '이미지 생성 (실사/카드뉴스)',
      '독창성 검사',
      '의료광고법 검수',
      'SEO 분석',
      '네이버 검색 트렌드',
    ],
  },
  pro12_pro: {
    id: 'pro12_pro',
    name: '올인원 프로',
    category: 'bundle',
    price: 699000,
    trialPrice: 349500, // 6월 한정 첫 달 50% 할인 (699,000 → 349,500)
    limits: { blog: -1, video: 12, channels: -1 },
    fairUseCap: 60, // 채널 무제한 공정사용 소프트캡 (월 60세트)
    usageLimit: -1, // = limits.blog
    features: [
      'AI 블로그 무제한',
      'AI 영상 월 12건',
      '멀티채널 세트 무제한 (공정사용 월 60세트)',
      '이미지 생성 (실사/카드뉴스)',
      '독창성 검사',
      '의료광고법 검수',
      'SEO 분석',
      '네이버 검색 트렌드',
      '우선 고객 지원',
    ],
  },
}

/**
 * 유효한 유료 플랜 ID 전체 (레거시 basic 포함).
 * 결제 검증·사용량 가드·정기결제 cron 이 참조한다. basic 구독자 enforce 를 위해 포함한다.
 */
export const PAID_PLAN_IDS: PlanId[] = [
  'basic', // LEGACY: 신규 판매 중단, 기존 구독자 enforce 위해 유지
  'standard',
  'pro',
  'growth8_standard',
  'pro12_pro',
]

/**
 * 공개 요금제(PricingSection / 랜딩)에 노출할 플랜 ID.
 * 레거시 basic 은 제외한다.
 */
export const PUBLIC_PLAN_IDS: PlanId[] = ['standard', 'pro', 'growth8_standard', 'pro12_pro']

/**
 * 첫 달 프로모션 종료 시각 (KST, 한정 프로모션 종료 시각).
 * 이 시각 이후로는 전 플랜이 첫 달부터 정상가(plan.price)로 결제된다.
 */
export const FIRST_MONTH_PROMO_UNTIL = '2026-06-30T23:59:59+09:00'

/** 신규 가입자의 첫 달 결제액(KRW). 0이면 무료. 프로모 종료 후엔 정상가(plan.price). */
export function firstMonthAmount(plan: Plan, now: Date = new Date()): number {
  if (now.getTime() > new Date(FIRST_MONTH_PROMO_UNTIL).getTime()) return plan.price
  return plan.trialPrice ?? 0
}

export function getPlan(id: PlanId): Plan {
  return PLANS[id]
}

// ─────────────────────────────────────────────────────────────
// 업그레이드 (마이페이지 인앱 플랜 상향)
// ─────────────────────────────────────────────────────────────

/**
 * 허용된 업그레이드 경로 맵 (명시적 화이트리스트).
 * 키 = 현재 플랜, 값 = 업그레이드 가능한 상위 플랜 목록.
 * 여기에 없는 경로(동일 플랜·다운그레이드 포함)는 업그레이드가 아니다.
 */
const ALLOWED_UPGRADES: Record<PlanId, PlanId[]> = {
  basic: ['standard', 'pro', 'growth8_standard', 'pro12_pro'],
  standard: ['growth8_standard', 'pro12_pro'],
  pro: ['pro12_pro'],
  growth8_standard: ['pro12_pro'],
  pro12_pro: [],
}

/** from → to 가 허용된 업그레이드 경로인지 여부 (동일·다운그레이드는 false). */
export function isUpgrade(from: PlanId, to: PlanId): boolean {
  if (from === to) return false
  return (ALLOWED_UPGRADES[from] ?? []).includes(to)
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * 즉시 업그레이드 시 청구할 일할(prorated) 차액 (KRW, 0 이상 정수).
 *
 *  charge = round((to.price − from.price) × daysRemaining / cycleDays)
 *
 * - cycleDays    = round((cycleEnd − cycleStart)/일), 최소 1, 유효하지 않으면 30 fallback
 * - daysRemaining = clamp(ceil((cycleEnd − now)/일), 0, cycleDays)
 * - 음수면 0 으로 절삭한다 (다운그레이드 방어).
 */
export function proratedUpgradeCharge(
  from: Plan,
  to: Plan,
  now: Date,
  cycleStart: Date,
  cycleEnd: Date,
): number {
  const startMs = cycleStart.getTime()
  const endMs = cycleEnd.getTime()
  const nowMs = now.getTime()

  let cycleDays: number
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    cycleDays = 30
  } else {
    cycleDays = Math.max(1, Math.round((endMs - startMs) / ONE_DAY_MS))
  }

  let daysRemaining: number
  if (!Number.isFinite(endMs) || !Number.isFinite(nowMs)) {
    daysRemaining = cycleDays
  } else {
    daysRemaining = Math.min(cycleDays, Math.max(0, Math.ceil((endMs - nowMs) / ONE_DAY_MS)))
  }

  return Math.max(0, Math.round(((to.price - from.price) * daysRemaining) / cycleDays))
}

/**
 * 유효한 유료 플랜 ID인지 검사 (DB legacy 'free' / null 차단용).
 * 레거시 basic 도 유효한 유료 플랜으로 취급한다(기존 구독자 enforce).
 */
export function isPaidPlanId(value: string | null | undefined): value is PlanId {
  return value != null && (PAID_PLAN_IDS as string[]).includes(value)
}

/**
 * 만료일 기준 활성 여부 — 유료 플랜만 유효
 */
export function isActivePlan(plan: string | null | undefined, expiresAt: string | null): boolean {
  if (!isPaidPlanId(plan)) return false
  if (!expiresAt) return false
  return new Date(expiresAt) > new Date()
}
