import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getIdentityVerification } from '@/hr/lib/identity-client'

export const dynamic = 'force-dynamic'

// 본인인증 결과 검증 + DI(중복가입확인정보) 중복가입 차단 라우트.
//
// 흐름:
//  1) 클라이언트가 포트원 SDK 로 본인인증을 마친 뒤 identityVerificationId 를 보낸다.
//  2) 서버가 포트원 GET /identity-verifications/{id} 로 직접 결과를 재조회한다.
//     (클라이언트가 보낸 이름/연락처는 신뢰하지 않음 — 서버가 신뢰의 원천)
//  3) status === 'VERIFIED' 가 아니면 거부.
//  4) verifiedCustomer.di 가 이미 가입된 프로필에 존재하면 409 로 차단.
//  5) 통과하면 검증된 name/phone(숫자만) 을 클라이언트에 돌려준다.
//     실제 di 영속화 + 최종 중복확인은 /api/auth/register 가 프로필 insert 직전에
//     한 번 더 수행한다(레이스 안전 — 아래 register 라우트 참고).

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const identityVerificationId =
      body && typeof body.identityVerificationId === 'string'
        ? body.identityVerificationId
        : null

    if (!identityVerificationId) {
      return NextResponse.json(
        { error: '본인인증 정보가 누락되었습니다. 다시 시도해주세요.' },
        { status: 400 },
      )
    }

    let verification
    try {
      verification = await getIdentityVerification(identityVerificationId)
    } catch (e) {
      console.error(
        'identity-verify 포트원 조회 실패:',
        identityVerificationId,
        e instanceof Error ? e.message : String(e),
      )
      return NextResponse.json(
        { error: '본인인증 확인에 실패했습니다. 잠시 후 다시 시도해주세요.' },
        { status: 502 },
      )
    }

    if (verification.status !== 'VERIFIED') {
      return NextResponse.json(
        { error: '본인인증이 완료되지 않았습니다. 다시 시도해주세요.' },
        { status: 400 },
      )
    }

    const customer = verification.verifiedCustomer
    const di = customer?.di?.trim() || null
    const name = customer?.name?.trim() || null
    const phoneNumber = customer?.phoneNumber?.trim() || null

    if (!di || !name || !phoneNumber) {
      // 본인인증은 됐으나 DI/이름/연락처가 비어있으면(제공사 미지원 등) 가입을 허용하지 않는다.
      return NextResponse.json(
        { error: '본인인증 정보를 확인할 수 없습니다. 다른 방법으로 시도해주세요.' },
        { status: 422 },
      )
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // DI 중복가입 사전 확인(서버측). 최종 enforce 는 register 의 unique 제약 + 재확인.
    const { data: dupe, error: dupeErr } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('di', di)
      .limit(1)
      .maybeSingle()

    if (dupeErr) {
      console.error('identity-verify DI 중복확인 쿼리 실패:', dupeErr.message)
      return NextResponse.json(
        { error: '본인인증 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' },
        { status: 500 },
      )
    }

    if (dupe) {
      return NextResponse.json(
        { error: '이미 가입된 회원입니다. 로그인해 주세요.' },
        { status: 409 },
      )
    }

    // 검증된 정보를 반환(서버가 신뢰의 원천). 클라이언트는 이 값으로 폼을 자동완성하고
    // 가입 요청 시 identityVerificationId 만 다시 보낸다(di/name/phone 은 register 가 재조회).
    return NextResponse.json({
      verified: true,
      name,
      phoneNumber,
    })
  } catch (e) {
    console.error(
      'identity-verify POST 예외:',
      e instanceof Error ? e.message : String(e),
    )
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 },
    )
  }
}
