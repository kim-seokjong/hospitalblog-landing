import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const SIGNUP_WINDOW_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const { userId, fullName, phone, hospitalName, hospitalAddress, position, hospitalType } = await req.json();

    if (!userId || !fullName || !phone || !hospitalName || !position || !hospitalType) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }
    const targetUser = userData.user;

    const ageMs = Date.now() - new Date(targetUser.created_at).getTime();
    if (ageMs > SIGNUP_WINDOW_MS) {
      return NextResponse.json({ error: '가입 처리 시간이 만료되었습니다. 다시 시도해주세요.' }, { status: 403 });
    }

    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: '이미 등록된 프로필입니다.' }, { status: 409 });
    }

    const { error } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: userId,
        full_name: fullName,
        phone,
        hospital_name: hospitalName,
        hospital_address: hospitalAddress,
        position,
        hospital_type: hospitalType,
      });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!targetUser.email_confirmed_at) {
      await supabaseAdmin.auth.admin.updateUserById(userId, { email_confirm: true });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
