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
  encryptCredentialVersioned,
  isCredentialKeyConfigured,
  LEGACY_KEY_VERSION,
} from '@/payment/lib/care-credentials'
import { isUndefinedColumn, runWithOptionalColumns } from '@/dev/lib/optional-columns'

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

    /**
     * 어느 **계약**의 위임인지 함께 남긴다 (마이그 060).
     *
     * 활성 빌링키 id 를 계약 식별자로 쓴다 — 갱신은 같은 빌링키 행을 계속 쓰고,
     * 해지 후 재구독은 새 행을 만든다. `plan_started_at` 은 갱신마다 갱신돼서
     * 계약을 가르지 못한다(이 판별을 시간으로 하려다 실패했다, 2026-08-03).
     * 이 값이 있어야 "지난 계약에서 받은 비밀번호" 를 새 계약에서 못 쓰게 막을 수 있다.
     */
    const { data: activeKey, error: keyErr } = await admin
      .from('billing_keys')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    /**
     * ⚠️ 계약을 **확인하지 못한 채로 저장하지 않는다** (2026-08-03 지적).
     *    조회 실패나 활성 결제수단 부재를 `null` 로 뭉개면, 그 행은 이후 어떤 계약에서도
     *    "계약 확인 불가 = 통과" 가 되어 **재구독 방어가 영구히 꺼진다.** 비밀번호를
     *    맡는 기능에서 그런 행을 만들어 두면 안 된다. 여기서 멈추는 편이 낫다.
     */
    if (keyErr) {
      console.error(`[care-onboarding] 결제수단 확인 실패 (user=${user.id}): ${keyErr.message}`)
      return NextResponse.json(
        { error: '결제 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 503 },
      )
    }
    const billingKeyId = (activeKey as { id: string } | null)?.id ?? null
    if (!billingKeyId) {
      return NextResponse.json(
        {
          error:
            '활성 결제수단이 확인되지 않아 계정 위임을 접수할 수 없습니다. 고객센터로 문의해 주세요.',
        },
        { status: 409 },
      )
    }

    const blogEncrypted = encryptCredentialVersioned(blogPw)
    const instaEncrypted = instaPw ? encryptCredentialVersioned(instaPw) : null

    const baseRow = {
      user_id: user.id,
      blog_id: blogId,
      insta_id: instaId || null,
      publish_mode: publishMode,
      note: note || null,
      status: 'submitted',
      updated_at: new Date().toISOString(),
    }

    /**
     * 1차: 새 컬럼까지 포함해 저장 (마이그 060 적용됨).
     *
     * ⚠️ 실패 시 그냥 컬럼만 빼고 재시도하면 **안 된다** — 새 키(v2+)로 암호화한
     *    암호문이 버전 표시 없이 저장되고, 읽을 때는 v1 로 해석돼 복호화가 영영
     *    불가능해진다(2026-08-03 지적). 컬럼이 없는 환경에서는 **v1 로 다시 암호화**해서
     *    저장한다 — 저장 포맷과 해석이 반드시 일치해야 한다.
     */
    let upsertErr: { code?: string; message?: string } | null = null
    let extraApplied = true

    const first = await admin.from('care_onboarding').upsert(
      {
        ...baseRow,
        blog_pw_enc: blogEncrypted.value,
        insta_pw_enc: instaEncrypted?.value ?? null,
        key_version: blogEncrypted.keyVersion,
        billing_key_id: billingKeyId,
        revoked_at: null,
        revocation_reason: null,
      },
      { onConflict: 'user_id' },
    )

    if (first.error && isUndefinedColumn(first.error)) {
      extraApplied = false
      // 버전을 남길 곳이 없으므로 **v1 로 다시 잠근다** (읽는 쪽이 v1 로 해석하므로).
      const legacy = await admin.from('care_onboarding').upsert(
        {
          ...baseRow,
          blog_pw_enc: encryptCredential(blogPw, process.env, LEGACY_KEY_VERSION),
          insta_pw_enc: instaPw
            ? encryptCredential(instaPw, process.env, LEGACY_KEY_VERSION)
            : null,
        },
        { onConflict: 'user_id' },
      )
      upsertErr = legacy.error
    } else {
      upsertErr = first.error
    }

    if (upsertErr) {
      // 마이그 059 미적용이면 저장할 곳이 없다 — 조용히 삼키지 않고 안내
      console.error(`[care-onboarding] 저장 실패 (user=${user.id}): ${upsertErr.message}`)
      return NextResponse.json(
        { error: '저장에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 500 },
      )
    }
    if (!extraApplied) {
      console.warn(
        '[care-onboarding] 마이그 060 미적용 — 계약 인스턴스·키 버전 없이 저장됨 ' +
          '(재구독 시 지난 계약 자격증명 재사용 방어가 꺼져 있음)',
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
    const now = new Date().toISOString()
    const { error } = await runWithOptionalColumns(
      {
        status: 'revoked',
        blog_pw_enc: null,
        insta_pw_enc: null,
        updated_at: now,
      },
      // 파기 사유는 전용 컬럼에 남긴다 — `note`(고객 요청사항)를 덮어쓰지 않는다.
      { revoked_at: now, revocation_reason: '고객 요청으로 위임 철회' },
      (payload) =>
        admin
          .from('care_onboarding')
          .update(payload)
          .eq('user_id', user.id)
          .then(({ error: e }) => ({ error: e })),
    )
    if (error && error.code !== '42P01') {
      return NextResponse.json({ error: '철회 처리에 실패했습니다' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
