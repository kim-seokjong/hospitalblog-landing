import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminClient } from '@/dev/lib/supabase/server';
import { isAdmin } from '@/hr/lib/admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!isAdmin(user?.email)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const body = await req.json() as { userId?: unknown; delta?: unknown };
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const delta = typeof body.delta === 'number' ? Math.round(body.delta) : NaN;

    if (!userId) {
      return NextResponse.json({ error: 'userId가 필요합니다.' }, { status: 400 });
    }
    if (Number.isNaN(delta) || delta === 0) {
      return NextResponse.json({ error: 'delta는 0이 아닌 정수여야 합니다.' }, { status: 400 });
    }
    if (Math.abs(delta) > 10000) {
      return NextResponse.json({ error: 'delta는 ±10000 이내여야 합니다.' }, { status: 400 });
    }

    const admin = createAdminClient();

    // 현재 값 조회
    const { data: profile, error: fetchError } = await admin
      .from('profiles')
      .select('usage_count')
      .eq('id', userId)
      .single();

    if (fetchError || !profile) {
      return NextResponse.json({ error: '회원을 찾을 수 없습니다.' }, { status: 404 });
    }

    const current = profile.usage_count ?? 0;
    const newCount = Math.max(0, current + delta);

    const { error: updateError } = await admin
      .from('profiles')
      .update({ usage_count: newCount })
      .eq('id', userId);

    if (updateError) {
      console.error('[admin/adjust-usage] update error:', updateError);
      return NextResponse.json({ error: '업데이트에 실패했습니다.' }, { status: 500 });
    }

    console.log(`[admin/adjust-usage] ${user?.email} adjusted ${userId}: ${current} → ${newCount} (delta ${delta > 0 ? '+' : ''}${delta})`);

    return NextResponse.json({ previousCount: current, newCount, delta });
  } catch (e) {
    console.error('[admin/adjust-usage] unexpected error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
