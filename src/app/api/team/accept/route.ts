import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server';

interface AcceptBody {
  inviteId: string;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
    }

    if (!user.email) {
      return NextResponse.json({ error: '이메일 정보를 확인할 수 없습니다' }, { status: 400 });
    }

    const body = await req.json() as AcceptBody;
    const { inviteId } = body;

    if (!inviteId || typeof inviteId !== 'string') {
      return NextResponse.json({ error: '초대 ID가 필요합니다' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: invite } = await admin
      .from('team_members')
      .select('id, member_email, status')
      .eq('id', inviteId)
      .maybeSingle();

    if (!invite) {
      return NextResponse.json({ error: '초대를 찾을 수 없습니다' }, { status: 404 });
    }

    if (invite.member_email.toLowerCase() !== user.email.toLowerCase()) {
      return NextResponse.json({ error: '본인 이메일에 대한 초대만 수락할 수 있습니다' }, { status: 403 });
    }

    if (invite.status === 'active') {
      return NextResponse.json({ error: '이미 수락된 초대입니다' }, { status: 400 });
    }

    if (invite.status !== 'pending') {
      return NextResponse.json({ error: '수락할 수 없는 초대 상태입니다' }, { status: 400 });
    }

    const { data: updated, error } = await admin
      .from('team_members')
      .update({
        status: 'active',
        joined_at: new Date().toISOString(),
      })
      .eq('id', inviteId)
      .select('id, owner_id, member_email, role, status, joined_at, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: '초대 수락 실패' }, { status: 500 });
    }

    return NextResponse.json({ success: true, member: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
