import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminClient } from '@/dev/lib/supabase/server';
import { isAdmin } from '@/hr/lib/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const userSupabase = await createServerSupabaseClient();
    const { data: { user } } = await userSupabase.auth.getUser();

    if (!user?.email || !isAdmin(user.email)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const admin = createAdminClient();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // 전체 프로필 조회
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, email, plan, usage_count, plan_expires_at, created_at');

    // 집계용 결제 조회 (limit 없음 — 전체 매출 정확 집계)
    const { data: allPayments } = await admin
      .from('payments')
      .select('amount, paid_at')
      .eq('status', 'PAID');

    // 목록용 결제 조회 (최근 20건)
    const { data: recentPayments } = await admin
      .from('payments')
      .select('id, user_id, plan, amount, paid_at, card_name, pg_provider, receipt_url')
      .eq('status', 'PAID')
      .order('paid_at', { ascending: false })
      .limit(20);

    const totalUsers = profiles?.length ?? 0;

    // 플랜별 분포
    const planCounts: Record<string, number> = { free: 0, basic: 0, standard: 0, pro: 0 };
    for (const p of profiles ?? []) {
      const plan = p.plan ?? 'free';
      planCounts[plan] = (planCounts[plan] ?? 0) + 1;
    }

    // 이번달 신규 가입자
    const newUsersThisMonth = (profiles ?? []).filter(
      p => p.created_at && p.created_at >= monthStart
    ).length;

    // 총 매출 & 이번달 매출 (집계용 전체 데이터 기준)
    const totalRevenue = (allPayments ?? []).reduce((sum, p) => sum + (p.amount ?? 0), 0);
    const monthlyRevenue = (allPayments ?? [])
      .filter(p => p.paid_at && p.paid_at >= monthStart)
      .reduce((sum, p) => sum + (p.amount ?? 0), 0);

    // 사용량 상위 10명
    const topUsers = (profiles ?? [])
      .filter(p => (p.usage_count ?? 0) > 0)
      .sort((a, b) => (b.usage_count ?? 0) - (a.usage_count ?? 0))
      .slice(0, 10)
      .map(p => ({ email: p.email, plan: p.plan ?? 'free', usage_count: p.usage_count ?? 0 }));

    return NextResponse.json({
      totalUsers,
      newUsersThisMonth,
      planCounts,
      totalRevenue,
      monthlyRevenue,
      recentPayments: recentPayments ?? [],
      topUsers,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
