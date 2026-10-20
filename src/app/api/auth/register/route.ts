import { NextRequest, NextResponse } from 'next/server';
import { checkRegistrationNonce } from '@/hr/lib/registration-nonce';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { suggestClinicProfile } from '@/content/lib/clinic-profile';
import { applyReturningUserFreeBenefitPolicy } from '@/payment/lib/free-benefit';
import { recordFunnelEvent } from '@/dev/lib/funnel-server';
import { ANON_ID_COOKIE, isValidAnonId } from '@/content/lib/funnel-events';

export const dynamic = 'force-dynamic';

const SIGNUP_WINDOW_MS = 5 * 60 * 1000;


export async function POST(req: NextRequest) {
  // catch 블록에서도 best-effort 롤백을 시도할 수 있도록 try 밖에 선언.
  let userId: string | undefined;
  let supabaseAdmin: SupabaseClient | null = null;
  // 프로필이 이미 정상 저장된 뒤 발생한 예외(예: 이메일 confirm 단계)에서는
  // 롤백으로 멀쩡한 가입을 지우면 안 되므로, 커밋 여부를 추적한다.
  let profileCommitted = false;
  // ⛔롤백 삭제는 존재·5분 창·프로필 미등록·가입자 확인 번호를 **모두 통과한 뒤에만** 허용한다.
  //   catch 경로도 이 표시를 본다 — 검사 도중 예외가 나서 catch 로 떨어지면 지우지 않는다(Codex 10/12 재검토).
  let rollbackAllowed = false;

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

    // ⛔⛔삭제(롤백)는 아래 세 검사를 모두 통과한 계정에만 한다(2026-10-12 Codex 지적·실코드 확인).
    //   이 라우트는 로그인 없이 호출된다. 예전엔 필수 항목 검사가 맨 앞에서 deleteUser 를 불러,
    //   남의 userId 만 넣고 필드를 비우면 **기존 회원 계정이 지워졌다.**
    //   ⇒ ①존재 ②프로필 미등록 ③가입자 확인 번호 ④가입 5분 이내(번호가 맞는 미확인 계정은 예외) — 가입 중인 본인 계정만 지울 수 있다.
    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }
    const targetUser = userData.user;

    const ageMs = Date.now() - new Date(targetUser.created_at).getTime();
    if (!Number.isFinite(ageMs)) {
      return NextResponse.json({ error: '가입 처리 시간이 만료되었습니다. 다시 시도해주세요.' }, { status: 403 });
    }

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .eq('id', userId)
      .maybeSingle();
    if (existingErr) {
      // 프로필 유무를 모르면 지우지도, 덮어쓰지도 않는다.
      console.error('register 프로필 조회 실패:', userId, existingErr.message);
      return NextResponse.json({ error: '잠시 후 다시 시도해주세요.' }, { status: 503 });
    }
    if (existing?.full_name) {
      return NextResponse.json({ error: '이미 등록된 프로필입니다.' }, { status: 409 });
    }

    // 가입자 확인: signUp 때 메타데이터에 넣은 SHA-256(번호)와 요청의 원본 번호가 맞아야 한다.
    //   userId 만 알아낸 제3자는 원본 번호를 모른다 ⇒ 남의 신규 계정에 프로필을 쓰거나 지울 수 없다.
    const nonceCheck = checkRegistrationNonce(targetUser.user_metadata?.registration_nonce_hash, body.registrationNonce);
    if (nonceCheck === 'mismatch') {
      return NextResponse.json({ error: '가입 확인 정보가 맞지 않습니다. 다시 시도해주세요.' }, { status: 403 });
    }
    // 5분 창 — 2026-10-13 대표 결정 ④: 가입 중간에 그만둔 사람이 5분 뒤 다시 시도하면 영영 막혔다
    //   (Supabase 가 같은 이메일의 미확인 계정을 그대로 돌려주는데 created_at 은 첫 시도 그대로다).
    //   ⇒ 확인 번호가 맞고(여기까지 왔으면 ok) 이메일 미확인·프로필 미등록인 계정 = 본인이 이어서 가입하는 중 ⇒ 창이 지나도 받는다.
    if (ageMs > SIGNUP_WINDOW_MS && targetUser.email_confirmed_at) {
      return NextResponse.json({ error: '가입 처리 시간이 만료되었습니다. 다시 시도해주세요.' }, { status: 403 });
    }
    rollbackAllowed = true;

    // 필수 프로필 필드(성함/연락처/병원명/직책/병원유형) 검증 — 시스템 경계(서버)에서 최종 차단.
    // 빈값이면 방금 생성된(위 검사를 통과한) auth 계정을 롤백 삭제해 유령 계정이 남지 않게 한다.
    if (!fullName || !phone || !hospitalName || !position || !hospitalType) {
      const { error: rollbackErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (rollbackErr) {
        console.error('register rollback(deleteUser) 실패 — 필수항목 누락 경로:', userId, rollbackErr.message);
      }
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }

    // 가입 시점에 병원 소개문·키워드를 자동 생성한다(기존 회원의 "강점 자동생성"과 동일 결과).
    // best-effort: 생성 실패·타임아웃은 가입 흐름을 절대 막지 않도록 try/catch 로 격리한다.
    let hospitalDesc = '';
    let hospitalKeywords: string[] = [];
    try {
      const s = await suggestClinicProfile({ hospitalName, specialty: hospitalType });
      hospitalDesc = s.hospital_desc || '';
      hospitalKeywords = Array.isArray(s.keywords) ? s.keywords : [];
    } catch (suggestEx) {
      // graceful: 생성 실패해도 가입은 계속 진행한다.
      console.error(
        'register profile-suggest 실패 — 가입은 계속 진행:',
        userId,
        suggestEx instanceof Error ? suggestEx.message : String(suggestEx),
      );
    }

    // 생성 값은 있을 때만 upsert 에 포함(빈값이면 기존 컬럼 기본값 유지).
    const profileRow: Record<string, unknown> = {
      id: userId,
      full_name: fullName,
      phone,
      hospital_name: hospitalName,
      hospital_address: hospitalAddress,
      position,
      hospital_type: hospitalType,
    };
    if (hospitalDesc) {
      profileRow.hospital_desc = hospitalDesc;
    }
    if (hospitalKeywords.length > 0) {
      profileRow.hospital_keywords = hospitalKeywords;
    }

    const { error } = await supabaseAdmin
      .from('profiles')
      .upsert(profileRow, { onConflict: 'id' });

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

    // 재가입 무료혜택 악용 방지: 이미 무료혜택을 받은 전화/이메일이면 크레딧(2→0) 회수,
    // 신규 신원이면 원장에 기록한다. best-effort — 실패해도 가입은 유효하게 유지한다
    // (원장 테이블 미적용 환경에서는 기존 동작인 "크레딧 2 부여"로 graceful 하게 유지).
    try {
      await applyReturningUserFreeBenefitPolicy(supabaseAdmin, userId, targetUser.email, phone);
    } catch (benefitErr) {
      console.error(
        'register 무료혜택 정책 적용 실패 — 가입은 계속 진행:',
        userId,
        benefitErr instanceof Error ? benefitErr.message : String(benefitErr),
      );
    }

    // 무료 2편이 실제로 남았는지 — 화면이 「무료 체험」 안내를 띄울지 판정하는 데만 쓴다.
    // 정책 적용 실패(크레딧 유지)·재가입 회수(0) 어느 쪽이든 DB 값이 진실이다. 읽기 실패면 null.
    let freeGranted: boolean | null = null;
    const { data: creditRow, error: creditErr } = await supabaseAdmin
      .from('profiles')
      .select('free_credits')
      .eq('id', userId)
      .maybeSingle();
    if (!creditErr && creditRow) freeGranted = (creditRow.free_credits ?? 0) > 0;

    if (!targetUser.email_confirmed_at) {
      await supabaseAdmin.auth.admin.updateUserById(userId, { email_confirm: true });
    }

    // 퍼널 계측: 가입 완료(전환 확정) — 서버에서만 기록해 위조 방지.
    // 랜딩 방문(landing_view)의 anon_id 쿠키와 이어 붙여 방문→가입 전환을 측정한다.
    const anonRaw = req.cookies.get(ANON_ID_COOKIE)?.value;
    await recordFunnelEvent({
      event: 'signup_complete',
      userId,
      anonId: isValidAnonId(anonRaw) ? anonRaw : null,
      meta: { hospital_type: hospitalType },
    });

    return NextResponse.json({ success: true, freeGranted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('register POST 예외:', userId ?? '(userId 없음)', msg);

    // best-effort 롤백: 프로필이 아직 커밋되지 않은 상태에서만 유령 auth 계정 삭제.
    if (userId && supabaseAdmin && rollbackAllowed && !profileCommitted) {
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
