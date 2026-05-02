import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server';

type MemberRole = 'admin' | 'member';

interface PatchBody {
  role: MemberRole;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params;
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
    }

    if (!memberId) {
      return NextResponse.json({ error: '멤버 ID가 필요합니다' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: member } = await admin
      .from('team_members')
      .select('id, owner_id')
      .eq('id', memberId)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ error: '멤버를 찾을 수 없습니다' }, { status: 404 });
    }

    if (member.owner_id !== user.id) {
      return NextResponse.json({ error: '오너만 멤버를 제거할 수 있습니다' }, { status: 403 });
    }

    const { error } = await admin
      .from('team_members')
      .update({ status: 'removed' })
      .eq('id', memberId);

    if (error) {
      return NextResponse.json({ error: '멤버 제거 실패' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params;
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
    }

    if (!memberId) {
      return NextResponse.json({ error: '멤버 ID가 필요합니다' }, { status: 400 });
    }

    const body = await req.json() as PatchBody;
    const { role } = body;

    if (role !== 'admin' && role !== 'member') {
      return NextResponse.json({ error: '역할은 admin 또는 member만 가능합니다' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: member } = await admin
      .from('team_members')
      .select('id, owner_id, status')
      .eq('id', memberId)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ error: '멤버를 찾을 수 없습니다' }, { status: 404 });
    }

    if (member.owner_id !== user.id) {
      return NextResponse.json({ error: '오너만 역할을 변경할 수 있습니다' }, { status: 403 });
    }

    if (member.status !== 'active') {
      return NextResponse.json({ error: '활성 멤버만 역할을 변경할 수 있습니다' }, { status: 400 });
    }

    const { data: updated, error } = await admin
      .from('team_members')
      .update({ role })
      .eq('id', memberId)
      .select('id, owner_id, member_email, role, status, joined_at, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: '역할 변경 실패' }, { status: 500 });
    }

    return NextResponse.json({ success: true, member: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
