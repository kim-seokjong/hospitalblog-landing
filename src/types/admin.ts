// 'basic'·'pro'·'pro12_pro' 는 레거시(신규 판매 중단)이나 기존 구독자 집계를 위해 유지한다.
export type PlanType =
  | 'free'
  | 'basic'
  | 'standard'
  | 'standard_care'
  | 'pro'
  | 'growth8_standard'
  | 'growth_care'
  | 'pro12_pro';

export interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  position: string | null;
  hospital_type: string | null;
  hospital_address: string | null;
  hospital_name: string | null;
  specialty: string | null;
  region: string | null;
  plan: PlanType | null;
  plan_expires_at: string | null;
  /** 이번 달 사용량 (usage_reset_at 월간 리셋 보정 적용 후 값) */
  usage_count: number | null;
  usage_reset_at: string | null;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  user_id: string;
  plan: string | null;
  amount: number;
  status: 'PAID' | 'PENDING' | 'FAILED' | 'CANCELLED' | 'VIRTUAL_ACCOUNT_ISSUED';
  created_at: string;
  paid_at: string | null;
}

export interface MetricData {
  mrr: number;
  mrrPrev: number;
  mrrChangeMoM: number;
  activeSubs: number;
  newSubsThisMonth: number;
  goalRate: number;
  churnRate: number;
  arpu: number;
  arpuChangeMoM: number;
}

export interface MonthlyMRR {
  month: string;
  mrr: number;
}

export interface PlanDistribution {
  plan: PlanType;
  count: number;
}

export interface SpecialtyCount {
  specialty: string;
  count: number;
}

export interface RegionTarget {
  region: string;
  current: number;
  target: number;
}

export interface MemberRow extends ProfileRow {
  isActive: boolean;
  isExpiringSoon: boolean;
}

export interface RecentPayment {
  plan: string;
  email: string | null;
  amount: number;
  created_at: string;
}

export interface DashboardData {
  metric: MetricData;
  monthlyMRR: MonthlyMRR[];
  planDist: PlanDistribution[];
  specialtyCounts: SpecialtyCount[];
  regionTargets: RegionTarget[];
  recentPayments: RecentPayment[];
  members: MemberRow[];
}
