import { redirect } from 'next/navigation';
import { createServerSupabaseClient, createAdminClient } from '@/dev/lib/supabase/server';
import { isAdmin } from '@/hr/lib/admin';
import KpiDashboard from '@/components/admin/KpiDashboard';
import MemberTable from '@/components/admin/MemberTable';
import NoticeComposer from '@/components/admin/NoticeComposer';
import BlogAuditPanel from '@/components/admin/BlogAuditPanel';
import FunnelPanel from '@/components/admin/FunnelPanel';
import CareOnboardingPanel from '@/components/admin/CareOnboardingPanel';
import { fetchFunnelStatRows } from '@/dev/lib/funnel-admin-server';
import { isBeaconSigningEnabled } from '@/dev/lib/ai-referral-crypto';
import { isCredentialKeyConfigured } from '@/payment/lib/care-credentials';
import { aggregateFunnelStats } from '@/content/lib/funnel-admin-stats';
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

// 실제 판매가(plans.ts price)와 일치시킨다 — MRR 집계용.
// (구 값 basic 19,900/standard 49,000/pro 119,000 은 초기 가격표의 잔재로 실제와 불일치했다)
const PLAN_PRICES: Record<PlanType, number> = {
  free: 0,
  basic: 99000,
  standard: 199000,
  standard_care: 399000,
  pro: 399000,
  growth8_standard: 499000,
  growth_care: 699000,
  pro12_pro: 699000,
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
    standard_care: 0,
    pro: 0,
    growth8_standard: 0,
    growth_care: 0,
    pro12_pro: 0,
  };
  for (const p of activeProfiles) {
    if (p.plan && p.plan !== 'free') {
      planCountMap[p.plan as PlanType] =
        (planCountMap[p.plan as PlanType] ?? 0) + 1;
    }
  }
  const planDist: PlanDistribution[] = (
    [
      'basic',
      'standard',
      'standard_care',
      'pro',
      'growth8_standard',
      'growth_care',
      'pro12_pro',
    ] as PlanType[]
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
  const [profilesRes, paymentsRes, funnelRes] = await Promise.all([
    admin
      .from('profiles')
      .select(
        'id,email,full_name,phone,position,hospital_type,hospital_address,hospital_name,specialty,region,plan,plan_expires_at,usage_count,usage_reset_at,created_at'
      )
      .order('created_at', { ascending: false }),
    admin
      .from('payments')
      .select('id,user_id,plan,amount,status,created_at,paid_at')
      .order('created_at', { ascending: false }),
    // 방문자·퍼널 (읽기 전용, 실패해도 throw 안 함 — 부가 지표)
    fetchFunnelStatRows(),
  ]);

  if (profilesRes.error) {
    throw new Error(`profiles fetch failed: ${profilesRes.error.message}`);
  }
  if (paymentsRes.error) {
    throw new Error(`payments fetch failed: ${paymentsRes.error.message}`);
  }

  // 월간 리셋 보정: consume_usage 는 다음 생성 시점에 게으르게 리셋하므로,
  // 이번 달 활동이 없는 회원의 usage_count 원값은 지난달 숫자 → 0으로 보정
  // (/api/admin/users · mypage/usage 와 동일 기준 — 화면 전체에서 "이번 달 사용량"으로 통일)
  const monthStartDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const rawProfiles = (profilesRes.data ?? []) as ProfileRow[];
  const profiles: ProfileRow[] = rawProfiles.map((p) => {
    const resetAt = p.usage_reset_at ? new Date(p.usage_reset_at) : null;
    return { ...p, usage_count: resetAt && resetAt >= monthStartDate ? (p.usage_count ?? 0) : 0 };
  });
  const payments = (paymentsRes.data ?? []) as PaymentRow[];

  const data = buildDashboardData(profiles, payments);
  const funnelStats = aggregateFunnelStats(funnelRes.rows);

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

        {/* 설정 누락 경고 — 시크릿이 없으면 AI 유입 집계가 조용히 꺼진 채로 돈다.
            데이터가 0인 것과 기능이 꺼진 것을 구분할 수 있는 유일한 지점이다. */}
        {!isBeaconSigningEnabled() && (
          <div className="rounded-xl border border-[#ff4628]/40 bg-[#ffece7] px-4 py-3">
            <p className="text-sm font-semibold text-[#202020]">
              AI 검색 유입 집계가 꺼져 있습니다
            </p>
            <p className="text-xs text-[#5b6573] mt-1 leading-relaxed">
              환경변수 <code className="font-mono">AI_REFERRAL_BEACON_SECRET</code>(16자 이상)이
              설정되지 않아 비콘 서명 토큰이 발급되지 않습니다. 병원 블로그의 AI 유입이
              전혀 기록되지 않으며, 마이페이지에는 계속 0으로 표시됩니다.
            </p>
          </div>
        )}

        {/* 설정 누락 경고 — 케어 온보딩 암호화 키가 없으면 계정 위임 제출이 전부 실패한다 */}
        {!isCredentialKeyConfigured() && (
          <div className="rounded-xl border border-[#ff4628]/40 bg-[#ffece7] px-4 py-3">
            <p className="text-sm font-semibold text-[#202020]">
              케어 온보딩 저장이 꺼져 있습니다
            </p>
            <p className="text-xs text-[#5b6573] mt-1 leading-relaxed">
              환경변수 <code className="font-mono">CARE_CREDENTIALS_KEY</code>(base64 32바이트)가
              설정되지 않아 케어 플랜 고객의 계정 위임 제출이 실패합니다. 로컬 .env.local 의 값을
              Vercel 환경변수(Production)에도 등록해 주세요.
            </p>
          </div>
        )}

        <KpiDashboard data={data} />

        <FunnelPanel
          stats={funnelStats}
          ok={funnelRes.ok}
          truncated={funnelRes.truncated}
        />

        <CareOnboardingPanel />

        <BlogAuditPanel />

        <NoticeComposer members={data.members} />

        <MemberTable members={data.members} />
      </div>
    </main>
  );
}
