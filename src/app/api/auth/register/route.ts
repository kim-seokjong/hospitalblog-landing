import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const SIGNUP_WINDOW_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  // catch 블록에서도 best-effort 롤백을 시도할 수 있도록 try 밖에 선언.
  let userId: string | undefined;
  let supabaseAdmin: SupabaseClient | null = null;
  // 프로필이 이미 정상 저장된 뒤 발생한 예외(예: 이메일 confirm 단계)에서는
  // 롤백으로 멀쩡한 가입을 지우면 안 되므로, 커밋 여부를 추적한다.
  let profileCommitted = false;

  try {
    const body = await req.json();
    userId = body.userId;
    const { fullName, phone, hospitalName, hospitalAddress, position, hospitalType } = body;

    // userId 자체가 없으면 정리할 대상도 없으므로 즉시 400 반환
    if (!userId) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }

    supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 필수 프로필 필드(성함/연락처/병원명/직책/병원유형) 검증 — 시스템 경계(서버)에서 최종 차단.
    // 빈값이면 방금 생성된 auth 계정을 롤백 삭제해 유령 계정이 남지 않게 한다.
    if (!fullName || !phone || !hospitalName || !position || !hospitalType) {
      const { error: rollbackErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (rollbackErr) {
        console.error('register rollback(deleteUser) 실패 — 필수항목 누락 경로:', userId, rollbackErr.message);
      }
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
      const { error: rollbackErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (rollbackErr) {
        console.error('register rollback(deleteUser) 실패 — 프로필 저장 실패 경로:', userId, rollbackErr.message);
      }
      return NextResponse.json(
        { error: '프로필 저장에 실패했습니다. 다시 시도해주세요.' },
        { status: 500 },
      );
    }

    // 프로필 저장 성공 — 이 시점 이후 예외가 나도 가입은 유효하므로 롤백 금지.
    profileCommitted = true;

    if (!targetUser.email_confirmed_at) {
      await supabaseAdmin.auth.admin.updateUserById(userId, { email_confirm: true });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('register POST 예외:', userId ?? '(userId 없음)', msg);

    // best-effort 롤백: 프로필이 아직 커밋되지 않은 상태에서만 유령 auth 계정 삭제.
    if (userId && supabaseAdmin && !profileCommitted) {
      try {
        const { error: rollbackErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (rollbackErr) {
          console.error('register rollback(deleteUser) 실패 — 예외 경로:', userId, rollbackErr.message);
        }
      } catch (rollbackEx) {
        console.error(
          'register rollback(deleteUser) 자체 예외 — 예외 경로:',
          userId,
          rollbackEx instanceof Error ? rollbackEx.message : String(rollbackEx),
        );
      }
    }

    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
