import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
    }

    if (!user.email) {
      return NextResponse.json({ error: '이메일 정보를 확인할 수 없습니다' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('team_members')
      .select('id, owner_id, member_email, role, status, joined_at, created_at')
      .eq('member_email', user.email.toLowerCase())
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: '초대 목록 조회 실패' }, { status: 500 });
    }

    return NextResponse.json({ invites: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
