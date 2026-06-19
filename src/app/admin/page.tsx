import { redirect } from 'next/navigation';
import { createServerSupabaseClient, createAdminClient } from '@/dev/lib/supabase/server';
import { isAdmin } from '@/hr/lib/admin';
import KpiDashboard from '@/components/admin/KpiDashboard';
import MemberTable from '@/components/admin/MemberTable';
import type {
  DashboardData,
  MemberRow,
  MonthlyMRR,
  PaymentRow,
  PlanDistribution,
  PlanType,
  ProfileRow,
  RecentPayment,
  RegionTarget,
  SpecialtyCount,
} from '@/types/admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PLAN_PRICES: Record<PlanType, number> = {
  free: 0,
  basic: 19900,
  standard: 49000,
  pro: 119000,
};

const REGION_GOALS: { region: string; target: number }[] = [
  { region: '대구', target: 20 },
  { region: '서울', target: 50 },
  { region: '부산', target: 20 },
  { region: '경기', target: 40 },
  { region: '광주', target: 15 },
  { region: '기타', target: 108 },
];

const TOTAL_GOAL = 253;
const KNOWN_REGIONS = new Set(REGION_GOALS.map((r) => r.region).filter((r) => r !== '기타'));

function buildDashboardData(
  profiles: ProfileRow[],
  payments: PaymentRow[]
): DashboardData {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  // 활성 구독: plan != 'free' AND plan_expires_at > now()
  const isActiveProfile = (p: ProfileRow): boolean => {
    if (!p.plan || p.plan === 'free') return false;
    if (!p.plan_expires_at) return false;
    return new Date(p.plan_expires_at) > now;
  };

  // 결제는 PAID만 사용
  const paidPayments = payments.filter((p) => p.status === 'PAID');

  // ----- MRR -----
  const mrr = paidPayments
    .filter((p) => new Date(p.created_at) >= monthStart)
    .reduce((s, p) => s + (p.amount || 0), 0);

  const mrrPrev = paidPayments
    .filter((p) => {
      const d = new Date(p.created_at);
      return d >= prevMonthStart && d < monthStart;
    })
    .reduce((s, p) => s + (p.amount || 0), 0);

  const mrrChangeMoM = mrrPrev > 0 ? ((mrr - mrrPrev) / mrrPrev) * 100 : 0;

  // ----- 활성/신규 -----
  const activeSubs = profiles.filter(isActiveProfile).length;
  const newSubsThisMonth = profiles.filter(
    (p) =>
      new Date(p.created_at) >= monthStart && p.plan && p.plan !== 'free'
  ).length;

  // ----- 목표 달성률 -----
  const goalRate = TOTAL_GOAL > 0 ? (activeSubs / TOTAL_GOAL) * 100 : 0;

  // ----- 해지율 (TODO: 추적 미구현, 근사치 0) -----
  const churnRate = 0;

  // ----- ARPU -----
  const arpu = activeSubs > 0 ? Math.round(mrr / activeSubs) : 0;
  const arpuPrev =
    activeSubs > 0 && mrrPrev > 0 ? Math.round(mrrPrev / activeSubs) : 0;
  const arpuChangeMoM =
    arpuPrev > 0 ? ((arpu - arpuPrev) / arpuPrev) * 100 : 0;

  // ----- 월별 MRR (12개월) -----
  const monthlyMap = new Map<string, number>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}월`;
    monthlyMap.set(key, 0);
  }
  for (const p of paidPayments) {
    const d = new Date(p.created_at);
    const key = `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}월`;
    if (monthlyMap.has(key)) {
      monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + (p.amount || 0));
    }
  }
  const monthlyMRR: MonthlyMRR[] = Array.from(monthlyMap.entries()).map(
    ([month, value]) => ({ month, mrr: value })
  );

  // ----- 플랜 분포 (basic/standard/pro만, free 제외) -----
  const activeProfiles = profiles.filter(isActiveProfile);
  const planCountMap: Record<PlanType, number> = {
    free: 0,
    basic: 0,
    standard: 0,
    pro: 0,
  };
  for (const p of activeProfiles) {
    if (p.plan && p.plan !== 'free') {
      planCountMap[p.plan as PlanType] =
        (planCountMap[p.plan as PlanType] ?? 0) + 1;
    }
  }
  const planDist: PlanDistribution[] = (
    ['basic', 'standard', 'pro'] as PlanType[]
  ).map((plan) => ({ plan, count: planCountMap[plan] }));

  // ----- 진료과별 (활성만) -----
  const specialtyMap = new Map<string, number>();
  for (const p of activeProfiles) {
    const s = (p.specialty ?? '').trim();
    if (!s) continue;
    specialtyMap.set(s, (specialtyMap.get(s) ?? 0) + 1);
  }
  const specialtyCounts: SpecialtyCount[] = Array.from(
    specialtyMap.entries()
  ).map(([specialty, count]) => ({ specialty, count }));

  // ----- 지역 진척률 (활성 기준) -----
  const regionMap = new Map<string, number>();
  for (const p of activeProfiles) {
    const region = (p.region ?? '').trim();
    if (!region) {
      regionMap.set('기타', (regionMap.get('기타') ?? 0) + 1);
      continue;
    }
    if (KNOWN_REGIONS.has(region)) {
      regionMap.set(region, (regionMap.get(region) ?? 0) + 1);
    } else {
      regionMap.set('기타', (regionMap.get('기타') ?? 0) + 1);
    }
  }
  const regionTargets: RegionTarget[] = REGION_GOALS.map((g) => ({
    region: g.region,
    current: regionMap.get(g.region) ?? 0,
    target: g.target,
  }));

  // ----- 최근 결제 10건 (created_at desc) -----
  const profileEmailMap = new Map<string, string | null>();
  for (const p of profiles) {
    profileEmailMap.set(p.id, p.email);
  }
  const recentPayments: RecentPayment[] = [...paidPayments]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, 10)
    .map((p) => ({
      plan: p.plan ?? '-',
      email: profileEmailMap.get(p.user_id) ?? null,
      amount: p.amount,
      created_at: p.created_at,
    }));

  // ----- 회원 (MemberRow) -----
  const expiringThreshold = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const members: MemberRow[] = profiles
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .map((p) => {
      const active = isActiveProfile(p);
      const expSoon =
        active &&
        !!p.plan_expires_at &&
        new Date(p.plan_expires_at) <= expiringThreshold;
      return {
        ...p,
        isActive: active,
        isExpiringSoon: expSoon,
      };
    });

  return {
    metric: {
      mrr,
      mrrPrev,
      mrrChangeMoM,
      activeSubs,
      newSubsThisMonth,
      goalRate,
      churnRate,
      arpu,
      arpuChangeMoM,
    },
    monthlyMRR,
    planDist,
    specialtyCounts,
    regionTargets,
    recentPayments,
    members,
  };
}

export default async function AdminPage() {
  // ----- 인증/권한 -----
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdmin(user.email)) {
    redirect('/');
  }

  // ----- 데이터 fetch (Service Role) -----
  const admin = createAdminClient();
  const [profilesRes, paymentsRes] = await Promise.all([
    admin
      .from('profiles')
      .select(
        'id,email,full_name,phone,position,hospital_type,hospital_address,hospital_name,specialty,region,plan,plan_expires_at,usage_count,created_at'
      )
      .order('created_at', { ascending: false }),
    admin
      .from('payments')
      .select('id,user_id,plan,amount,status,created_at,paid_at')
      .order('created_at', { ascending: false }),
  ]);

  if (profilesRes.error) {
    throw new Error(`profiles fetch failed: ${profilesRes.error.message}`);
  }
  if (paymentsRes.error) {
    throw new Error(`payments fetch failed: ${paymentsRes.error.message}`);
  }

  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  const payments = (paymentsRes.data ?? []) as PaymentRow[];

  const data = buildDashboardData(profiles, payments);

  // ----- 페이지 헤더 -----
  const now = new Date();
  const headerSub = `${now.getFullYear()}년 ${now.getMonth() + 1}월 기준`;

  return (
    <main className="min-h-screen bg-[#eef2f6] text-[#202020] p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-[#202020]">
            hospitalblog.kr · 닥터포스트
          </h1>
          <p className="text-sm text-[#5b6573]">
            SaaS KPI 대시보드 · {headerSub}
          </p>
        </div>

        <KpiDashboard data={data} />

        <MemberTable members={data.members} />
      </div>
    </main>
  );
}
