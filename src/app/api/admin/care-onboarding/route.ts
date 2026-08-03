// 관리자 전용 — 케어 온보딩 목록 조회 + 계정 정보 복호화(개별·요청 시에만).
//
// GET  : 온보딩 전체 목록 (비밀번호 미포함, 병원명 조인)
// POST : { userId } — 해당 회원의 위임 계정 정보를 복호화해 반환.
//        발행 작업 직전에만 호출하는 용도. 호출 사실을 서버 로그에 남긴다.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/dev/lib/supabase/server'
import { isAdmin } from '@/hr/lib/admin'
import { decryptCredential } from '@/payment/lib/care-credentials'
import { isCarePlanId, PLANS } from '@/payment/lib/plans'
import { isActiveCareSubscription } from '@/payment/lib/care-retention'
import type { PlanId } from '@/payment/lib/plans'
import type { SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

/**
 * 위임 계정을 열어볼 근거가 아직 살아 있는가.
 *
 * ★ 왜 필요한가 (2026-08-03 주간점검 교차검증).
 *   제출 시점에만 케어 플랜을 확인하고, 열람 시점에는 `status='revoked'` 만 봤다.
 *   그래서 **케어 구독이 끝난 뒤에도** 관리자가 평문 비밀번호를 계속 꺼낼 수 있었다.
 *   위임의 근거는 "발행 대행 계약"이고, 계약이 끝나면 근거도 끝난다. 고객이 직접
 *   철회 버튼을 누르지 않았다는 사실이 계속 접근해도 된다는 뜻이 될 수는 없다.
 *
 * 만료일이 비어 있는 경우는 **유효로 보지 않는다** — 케어 플랜은 결제 기반이라
 * 만료일이 반드시 있고, 없다는 것은 상태가 깨졌다는 뜻이다. 애매하면 막는 쪽이다.
 */
export interface CareEntitlement {
  readonly active: boolean
  readonly plan: PlanId | null
  readonly planName: string | null
  readonly expiresAt: string | null
  /** 왜 막혔는지 — 화면·응답에 그대로 쓴다. */
  readonly reason:
    | 'ok'
    | 'not_care_plan'
    | 'expired'
    | 'no_expiry'
    | 'no_profile'
    | 'lookup_failed'
}

export async function loadCareEntitlement(
  admin: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<CareEntitlement> {
  const { data, error } = await admin
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', userId)
    .maybeSingle()

  // 확인을 못 한 것과 자격이 없는 것은 다르다. 열람은 **막되**, 이유는 구분해 남긴다.
  if (error) {
    console.error('[admin/care-onboarding] 구독 상태 조회 실패:', error.message)
    return { active: false, plan: null, planName: null, expiresAt: null, reason: 'lookup_failed' }
  }

  const row = data as { plan: string | null; plan_expires_at: string | null } | null
  if (!row) {
    return { active: false, plan: null, planName: null, expiresAt: null, reason: 'no_profile' }
  }

  const plan = (row.plan ?? '') as PlanId
  const planName = PLANS[plan]?.name ?? null
  const expiresAt = row.plan_expires_at

  if (!plan || !PLANS[plan] || !isCarePlanId(plan)) {
    return { active: false, plan: plan || null, planName, expiresAt, reason: 'not_care_plan' }
  }
  if (!expiresAt) {
    return { active: false, plan, planName, expiresAt: null, reason: 'no_expiry' }
  }
  const expiry = Date.parse(expiresAt)
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
    return { active: false, plan, planName, expiresAt, reason: 'expired' }
  }
  return { active: true, plan, planName, expiresAt, reason: 'ok' }
}

const ENTITLEMENT_MESSAGE: Record<CareEntitlement['reason'], string> = {
  ok: '',
  not_care_plan: '케어 플랜 구독자가 아닙니다. 위임 근거가 없으므로 계정 정보를 열 수 없습니다 — 자격증명을 파기해 주세요.',
  expired: '케어 구독이 만료됐습니다. 위임 근거가 끝났으므로 계정 정보를 열 수 없습니다 — 자격증명을 파기해 주세요.',
  lookup_failed: '구독 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  no_expiry: '구독 만료일이 비어 있어 케어 자격을 확인할 수 없습니다. 결제 상태를 먼저 확인해 주세요.',
  no_profile: '회원 정보를 찾을 수 없습니다.',
}

async function requireAdmin(): Promise<
  { ok: true; email: string } | { ok: false; res: NextResponse }
> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return {
      ok: false,
      res: NextResponse.json({ error: '권한이 없습니다' }, { status: 403 }),
    }
  }
  return { ok: true, email: user.email ?? '(email 없음)' }
}

export async function GET() {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('care_onboarding')
      .select('user_id, blog_id, blog_pw_enc, insta_id, insta_pw_enc, publish_mode, note, status, updated_at')
      .order('updated_at', { ascending: false })
      .limit(200)
    if (error) {
      if (error.code === '42P01') return NextResponse.json({ items: [] })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rows = (data ?? []) as Array<{
      user_id: string
      blog_id: string
      blog_pw_enc: string | null
      insta_id: string | null
      insta_pw_enc: string | null
      publish_mode: string
      note: string | null
      status: string
      updated_at: string
    }>

    // 병원명·구독 상태 조인 (별도 조회 — FK 조인 의존 없이)
    const ids = rows.map((r) => r.user_id)
    const names = new Map<string, string>()
    const plans = new Map<string, { plan: string | null; expiresAt: string | null }>()
    let profilesError: { message: string } | null = null
    if (ids.length > 0) {
      const { data: profiles, error: pErr } = await admin
        .from('profiles')
        .select('id, hospital_name, plan, plan_expires_at')
        .in('id', ids)
      if (pErr) {
        profilesError = pErr
        console.error('[admin/care-onboarding] 구독 상태 목록 조회 실패:', pErr.message)
      }
      for (const p of (profiles ?? []) as Array<{
        id: string
        hospital_name: string | null
        plan: string | null
        plan_expires_at: string | null
      }>) {
        names.set(p.id, p.hospital_name ?? '(병원명 미입력)')
        plans.set(p.id, { plan: p.plan, expiresAt: p.plan_expires_at })
      }
    }

    const nowMs = Date.now()
    /**
     * 구독 상태를 못 읽었으면 "자격 없음" 으로 단정하지 않는다.
     *
     * ⚠️ 조회 오류를 무시하면 `plans` 맵이 비어 **전 고객이 "파기 필요"** 로 뜬다
     *    (2026-08-03 교차검증 2라운드). 일시적 DB 오류가 전면 파기라는 운영 판단을
     *    만들어서는 안 된다. 모르면 모른다고 표시한다.
     */
    const statusKnown = !profilesError
    const isEntitled = (userId: string): boolean =>
      isActiveCareSubscription(plans.get(userId)?.plan, plans.get(userId)?.expiresAt, nowMs)

    return NextResponse.json({
      subscriptionStatusKnown: statusKnown,
      items: rows.map((r) => {
        const entitled = statusKnown ? isEntitled(r.user_id) : true
        return {
          userId: r.user_id,
          hospitalName: names.get(r.user_id) ?? '(병원명 미입력)',
          blogId: r.blog_id,
          hasBlogPassword: Boolean(r.blog_pw_enc),
          instaId: r.insta_id,
          hasInstaPassword: Boolean(r.insta_pw_enc),
          publishMode: r.publish_mode,
          note: r.note,
          status: r.status,
          updatedAt: r.updated_at,
          // 구독이 끝났는데 자격증명이 남아 있으면 파기 대상이다 — 화면에서 눈에 띄게 한다.
          entitled,
          needsPurge:
            !entitled && r.status !== 'revoked' && Boolean(r.blog_pw_enc || r.insta_pw_enc),
          currentPlan: plans.get(r.user_id)?.plan ?? null,
          planExpiresAt: plans.get(r.user_id)?.expiresAt ?? null,
        }
      }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const body = (await req.json().catch(() => ({}))) as { userId?: string }
    const userId = typeof body.userId === 'string' ? body.userId : ''
    if (!userId) return NextResponse.json({ error: 'userId가 필요합니다' }, { status: 400 })

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('care_onboarding')
      .select('blog_id, blog_pw_enc, insta_id, insta_pw_enc, status')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) {
      return NextResponse.json({ error: '온보딩 정보를 찾을 수 없습니다' }, { status: 404 })
    }
    const row = data as {
      blog_id: string
      blog_pw_enc: string | null
      insta_id: string | null
      insta_pw_enc: string | null
      status: string
    }
    if (row.status === 'revoked') {
      return NextResponse.json({ error: '위임이 철회된 회원입니다 (비밀번호 파기됨)' }, { status: 410 })
    }

    // 열람 시점에도 위임 근거(활성 케어 구독)를 다시 확인한다 — 제출 시점 검사만으로는
    // 구독이 끝난 뒤의 접근을 막을 수 없다.
    const entitlement = await loadCareEntitlement(admin, userId)
    if (!entitlement.active) {
      console.warn(
        `[admin/care-onboarding] 근거 없는 복호화 시도 차단 ` +
          `(admin=${auth.email}, target=${userId}, reason=${entitlement.reason})`,
      )
      return NextResponse.json(
        { error: ENTITLEMENT_MESSAGE[entitlement.reason], reason: entitlement.reason },
        { status: 403 },
      )
    }

    // 복호화 접근 기록 — 열람자(관리자 이메일)·대상을 남긴다 (시각은 로그 타임스탬프)
    console.warn(
      `[admin/care-onboarding] 계정 정보 복호화 열람 (admin=${auth.email}, target=${userId})`,
    )

    return NextResponse.json(
      {
        blogId: row.blog_id,
        blogPassword: row.blog_pw_enc ? decryptCredential(row.blog_pw_enc) : null,
        instaId: row.insta_id,
        instaPassword: row.insta_pw_enc ? decryptCredential(row.insta_pw_enc) : null,
      },
      // 평문 자격증명 응답은 어디에도 남기지 않는다 (브라우저·프록시·CDN 캐시).
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' } },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
