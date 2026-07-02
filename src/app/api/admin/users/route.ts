import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminClient } from '@/dev/lib/supabase/server';
import { isAdmin } from '@/hr/lib/admin';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const MAX_PAGE = 100;
const MAX_QUERY_LEN = 50;

export interface AdminUserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  hospital_name: string | null;
  hospital_address: string | null;
  position: string | null;
  hospital_type: string | null;
  plan: string | null;
  plan_expires_at: string | null;
  /** 이번 달 사용량 (usage_reset_at 월간 리셋 보정 적용 — 지난달 잔여 카운터는 0으로 표시) */
  usage_count: number | null;
  created_at: string | null;
}

/**
 * 월간 리셋 보정: usage_reset_at이 이번 달 이전이면 이번 달 사용량은 0.
 * consume_usage RPC 는 다음 생성 시점에 게으르게 리셋하므로, 이번 달 활동이 없는
 * 회원의 usage_count 원값은 "지난달 숫자"다 — 표시 계층에서 mypage/usage 와 동일 기준으로 보정한다.
 */
function effectiveMonthlyUsage(usageCount: number | null, usageResetAt: string | null): number {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const resetAt = usageResetAt ? new Date(usageResetAt) : null;
  return resetAt && resetAt >= monthStart ? (usageCount ?? 0) : 0;
}

export interface AdminUsersResponse {
  users: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!isAdmin(user?.email)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const rawQ = (searchParams.get('q') ?? '').trim();
    const rawPage = parseInt(searchParams.get('page') ?? '1', 10);
    const page = Math.max(1, Math.min(MAX_PAGE, Number.isFinite(rawPage) ? rawPage : 1));

    const admin = createAdminClient();
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = admin
      .from('profiles')
      .select(
        'id, email, full_name, phone, hospital_name, hospital_address, position, hospital_type, plan, plan_expires_at, usage_count, usage_reset_at, created_at',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (rawQ) {
      // PostgREST .or() 문법(`,` 구분자)과 ILIKE 패턴(`%`, `_`) 모두 방어.
      // 한글·영문·숫자·공백·@·.·- 외 모든 문자 제거.
      const safeQ = rawQ.replace(/[^a-zA-Z0-9가-힣\s@.\-]/g, '').slice(0, MAX_QUERY_LEN);
      if (safeQ) {
        const pattern = `%${safeQ}%`;
        query = query.or(
          `email.ilike.${pattern},full_name.ilike.${pattern},hospital_name.ilike.${pattern}`,
        );
      }
    }

    const { data: users, count, error } = await query;

    if (error) {
      console.error('[admin/users] query error:', error);
      return NextResponse.json({ error: '회원 정보를 불러올 수 없습니다.' }, { status: 500 });
    }

    // usage_count 를 "이번 달 사용량"으로 보정 (usage_reset_at 은 응답에서 제외)
    const normalized: AdminUserRow[] = (users ?? []).map((u) => {
      const { usage_reset_at, ...rest } = u as AdminUserRow & { usage_reset_at: string | null };
      return { ...rest, usage_count: effectiveMonthlyUsage(u.usage_count, usage_reset_at) };
    });

    const response: AdminUsersResponse = {
      users: normalized,
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
      hasMore: (count ?? 0) > to + 1,
    };

    return NextResponse.json(response);
  } catch (e) {
    console.error('[admin/users] unexpected error:', e);
    return NextResponse.json({ error: '서버 오류' }, { status: 500 });
  }
}
