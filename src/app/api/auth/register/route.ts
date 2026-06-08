import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const SIGNUP_WINDOW_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const { userId, fullName, phone, hospitalName, hospitalAddress, position, hospitalType } = await req.json();

    // userId 자체가 없으면 정리할 대상도 없으므로 즉시 400 반환
    if (!userId) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 필수 프로필 필드(성함/연락처/병원명/직책/병원유형) 검증 — 시스템 경계(서버)에서 최종 차단.
    // 빈값이면 방금 생성된 auth 계정을 롤백 삭제해 유령 계정이 남지 않게 한다.
    if (!fullName || !phone || !hospitalName || !position || !hospitalType) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }

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
      .select('id, full_name')
      .eq('id', userId)
      .maybeSingle();
    if (existing?.full_name) {
      return NextResponse.json({ error: '이미 등록된 프로필입니다.' }, { status: 409 });
    }

    const { error } = await supabaseAdmin
      .from('profiles')
      .upsert(
        {
          id: userId,
          full_name: fullName,
          phone,
          hospital_name: hospitalName,
          hospital_address: hospitalAddress,
          position,
          hospital_type: hospitalType,
        },
        { onConflict: 'id' },
      );

    if (error) {
      // 프로필 저장 실패 시 방금 만든 auth 계정을 삭제해 가입을 원자적으로 롤백한다.
      // (유령 계정 방지 — 프로필 없는 계정이 로그인으로 진입하지 못하게)
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return NextResponse.json(
        { error: '프로필 저장에 실패했습니다. 다시 시도해주세요.' },
        { status: 500 },
      );
    }

    if (!targetUser.email_confirmed_at) {
      await supabaseAdmin.auth.admin.updateUserById(userId, { email_confirm: true });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
