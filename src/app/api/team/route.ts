import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server';

type MemberRole = 'admin' | 'member';

interface InviteBody {
  email: string;
  role: MemberRole;
}

interface TeamMemberRow {
  id: string;
  owner_id: string;
  member_email: string;
  role: string;
  status: string;
  joined_at: string | null;
  created_at: string;
}

const PLAN_LIMITS: Record<string, number> = {
  free: 0,
  basic: 2,
  standard: 5,
  pro: Infinity,
};

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
    }

    const admin = createAdminClient();
    const [membersResult, profileResult] = await Promise.all([
      admin
        .from('team_members')
        .select('id, owner_id, member_email, role, status, joined_at, created_at')
        .eq('owner_id', user.id)
        .neq('status', 'removed')
        .order('created_at', { ascending: true }),
      admin
        .from('profiles')
        .select('plan')
        .eq('id', user.id)
        .single(),
    ]);

    if (membersResult.error) {
      return NextResponse.json({ error: '팀 멤버 조회 실패' }, { status: 500 });
    }

    const plan = (profileResult.data?.plan as string) ?? 'free';
    const limit = PLAN_LIMITS[plan] ?? 0;

    return NextResponse.json({ members: membersResult.data ?? [], plan, limit });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
    }

    const body = await req.json() as InviteBody;
    const { email, role } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: '유효한 이메일을 입력해주세요' }, { status: 400 });
    }

    if (role !== 'admin' && role !== 'member') {
      return NextResponse.json({ error: '역할은 admin 또는 member만 가능합니다' }, { status: 400 });
    }

    if (email.toLowerCase() === user.email?.toLowerCase()) {
      return NextResponse.json({ error: '자기 자신은 초대할 수 없습니다' }, { status: 400 });
    }

    const admin = createAdminClient();

    // 플랜 확인
    const { data: profileData } = await admin
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single();

    const plan = (profileData?.plan as string) ?? 'free';
    const limit = PLAN_LIMITS[plan] ?? 0;

    if (limit === 0) {
      return NextResponse.json(
        { error: '현재 플랜은 팀 기능을 지원하지 않습니다. 베이직 이상 플랜으로 업그레이드하세요.' },
        { status: 403 }
      );
    }

    // 현재 멤버 수 확인
    const { count } = await admin
      .from('team_members')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id);

    if (limit !== Infinity && (count ?? 0) >= limit) {
      return NextResponse.json(
        { error: `현재 플랜의 최대 멤버 수(${limit}명)를 초과하였습니다` },
        { status: 403 }
      );
    }

    // 중복 초대 확인
    const { data: existing } = await admin
      .from('team_members')
      .select('id')
      .eq('owner_id', user.id)
      .eq('member_email', email.toLowerCase())
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: '이미 초대된 이메일입니다' }, { status: 409 });
    }

    const { data: newMember, error: insertError } = await admin
      .from('team_members')
      .insert({
        owner_id: user.id,
        member_email: email.toLowerCase(),
        role,
        status: 'pending',
      })
      .select('id, owner_id, member_email, role, status, joined_at, created_at')
      .single();

    if (insertError) {
      return NextResponse.json({ error: '초대 실패' }, { status: 500 });
    }

    return NextResponse.json({ success: true, member: newMember as TeamMemberRow }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
