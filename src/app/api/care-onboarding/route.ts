// 케어 플랜 발행 대행 온보딩 — 계정 위임 정보 제출/조회/철회 (본인 전용).
//
// care_onboarding 은 RLS 정책 없이 잠겨 있어(비밀번호 컬럼 보호) 모든 접근이
// 이 라우트(service role)를 거친다. 비밀번호는 encryptCredential 로 암호화해서만
// 저장하고, GET 응답에는 절대 싣지 않는다(존재 여부 boolean 만).
//
// 정책 근거: 이용약관 제8조의2 (발행 대행 및 계정 위임 특약).
//  - 제출: 케어 플랜(standard_care/growth_care) 활성 구독자만
//  - 철회: 언제든 가능. 철회 즉시 암호화된 비밀번호를 NULL 로 파기(약관 문구 이행)

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/dev/lib/supabase/server'
import { isCarePlanId, isPaidPlanId, type PlanId } from '@/payment/lib/plans'
import {
  encryptCredential,
  isCredentialKeyConfigured,
} from '@/payment/lib/care-credentials'

export const dynamic = 'force-dynamic'

const MAX_FIELD_LENGTH = 200
const MAX_NOTE_LENGTH = 1000

interface OnboardingRow {
  user_id: string
  blog_id: string
  blog_pw_enc: string | null
  insta_id: string | null
  insta_pw_enc: string | null
  publish_mode: string
  note: string | null
  status: string
  updated_at: string
}

/** 본인 상태 응답 — 비밀번호는 존재 여부만 */
function toClientView(row: OnboardingRow) {
  return {
    blogId: row.blog_id,
    hasBlogPassword: Boolean(row.blog_pw_enc),
    instaId: row.insta_id,
    hasInstaPassword: Boolean(row.insta_pw_enc),
    publishMode: row.publish_mode,
    note: row.note,
    status: row.status,
    updatedAt: row.updated_at,
  }
}

async function getAuthedUser() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET() {
  try {
    const user = await getAuthedUser()
    if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('care_onboarding')
      .select('user_id, blog_id, blog_pw_enc, insta_id, insta_pw_enc, publish_mode, note, status, updated_at')
      .eq('user_id', user.id)
      .maybeSingle()
    // 마이그 059 미적용(42P01) = 아직 온보딩 없음으로 취급 (탭이 깨지지 않게)
    if (error && error.code !== '42P01') {
      return NextResponse.json({ error: '온보딩 정보를 불러오지 못했습니다' }, { status: 500 })
    }

    return NextResponse.json({ onboarding: data ? toClientView(data as OnboardingRow) : null })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser()
    if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

    if (!isCredentialKeyConfigured()) {
      // 키가 없으면 암호화 저장 자체가 불가 — 평문 폴백은 절대 하지 않는다
      console.error('[care-onboarding] CARE_CREDENTIALS_KEY 미설정 — 온보딩 제출 불가')
      return NextResponse.json(
        { error: '온보딩 저장 준비가 아직 완료되지 않았습니다. 고객센터로 문의해 주세요.' },
        { status: 503 },
      )
    }

    const admin = createAdminClient()

    // 케어 플랜 활성 구독자만 제출 가능
    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('plan, plan_expires_at')
      .eq('id', user.id)
      .maybeSingle()
    if (profileErr || !profile) {
      return NextResponse.json({ error: '프로필을 확인할 수 없습니다' }, { status: 500 })
    }
    const plan = profile.plan as string | null
    const isCareSubscriber =
      isPaidPlanId(plan) &&
      isCarePlanId(plan as PlanId) &&
      Boolean(profile.plan_expires_at) &&
      new Date(profile.plan_expires_at as string) > new Date()
    if (!isCareSubscriber) {
      return NextResponse.json(
        { error: '발행 대행 온보딩은 케어 플랜 구독 중에만 제출할 수 있습니다' },
        { status: 403 },
      )
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const blogId = typeof body.blogId === 'string' ? body.blogId.trim() : ''
    const blogPw = typeof body.blogPw === 'string' ? body.blogPw : ''
    const instaId = typeof body.instaId === 'string' ? body.instaId.trim() : ''
    const instaPw = typeof body.instaPw === 'string' ? body.instaPw : ''
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : ''
    const publishMode = body.publishMode === 'auto' ? 'auto' : 'approve_each'

    if (!blogId || !blogPw) {
      return NextResponse.json(
        { error: '네이버 블로그 아이디와 비밀번호를 입력해 주세요' },
        { status: 400 },
      )
    }
    if (blogId.length > MAX_FIELD_LENGTH || blogPw.length > MAX_FIELD_LENGTH) {
      return NextResponse.json({ error: '입력값이 너무 깁니다' }, { status: 400 })
    }
    // 인스타 위임은 올인원 케어에만 있는 서비스 — 대상이 아닌 채널의 민감정보는
    // 받지 않는다(UI 는 안 보여주지만 API 직접 호출 방어)
    if (plan !== 'growth_care' && (instaId || instaPw)) {
      return NextResponse.json(
        { error: '인스타그램 위임은 올인원 케어 플랜에서만 제출할 수 있습니다' },
        { status: 400 },
      )
    }
    // 인스타는 선택 — 넣으려면 아이디·비밀번호 한 쌍이어야 한다
    if ((instaId && !instaPw) || (!instaId && instaPw)) {
      return NextResponse.json(
        { error: '인스타그램은 아이디와 비밀번호를 함께 입력해 주세요' },
        { status: 400 },
      )
    }
    if (instaId.length > MAX_FIELD_LENGTH || instaPw.length > MAX_FIELD_LENGTH) {
      return NextResponse.json({ error: '입력값이 너무 깁니다' }, { status: 400 })
    }

    const row = {
      user_id: user.id,
      blog_id: blogId,
      blog_pw_enc: encryptCredential(blogPw),
      insta_id: instaId || null,
      insta_pw_enc: instaPw ? encryptCredential(instaPw) : null,
      publish_mode: publishMode,
      note: note || null,
      status: 'submitted',
      updated_at: new Date().toISOString(),
    }

    const { error: upsertErr } = await admin
      .from('care_onboarding')
      .upsert(row, { onConflict: 'user_id' })
    if (upsertErr) {
      // 마이그 059 미적용이면 저장할 곳이 없다 — 조용히 삼키지 않고 안내
      console.error(`[care-onboarding] 저장 실패 (user=${user.id}): ${upsertErr.message}`)
      return NextResponse.json(
        { error: '저장에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** 위임 철회 — 상태를 revoked 로 바꾸고 암호화된 비밀번호를 즉시 파기한다 */
export async function DELETE() {
  try {
    const user = await getAuthedUser()
    if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

    const admin = createAdminClient()
    const { error } = await admin
      .from('care_onboarding')
      .update({
        status: 'revoked',
        blog_pw_enc: null,
        insta_pw_enc: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
    if (error && error.code !== '42P01') {
      return NextResponse.json({ error: '철회 처리에 실패했습니다' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
