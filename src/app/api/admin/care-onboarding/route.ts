// 관리자 전용 — 케어 온보딩 목록 조회 + 계정 정보 복호화(개별·요청 시에만).
//
// GET  : 온보딩 전체 목록 (비밀번호 미포함, 병원명 조인)
// POST : { userId } — 해당 회원의 위임 계정 정보를 복호화해 반환.
//        발행 작업 직전에만 호출하는 용도. 호출 사실을 서버 로그에 남긴다.

// ⚠️ Next.js App Router 의 route 파일은 GET/POST 등 **정해진 것 외에는 export 할 수 없다.**
//    헬퍼를 여기서 export 했다가 배포가 깨졌다(2026-08-03). `tsc --noEmit` 은 이걸 못 잡는다 —
//    Next 가 빌드 때 생성하는 타입에서만 걸리므로 확인은 `next build` 로 해야 한다.
//    그래서 자격 판정 로직은 `@/payment/lib/care-retention` 에 둔다.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/dev/lib/supabase/server'
import { isAdmin } from '@/hr/lib/admin'
import { decryptCredential, LEGACY_KEY_VERSION } from '@/payment/lib/care-credentials'
import { isUndefinedColumn } from '@/dev/lib/optional-columns'
import {
  ENTITLEMENT_MESSAGE,
  isActiveCareSubscription,
  loadCareEntitlement,
} from '@/payment/lib/care-retention'

export const dynamic = 'force-dynamic'

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
        names.set(p.id, p.hospital_name || '(병원명 미입력)')
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
    const BASE_COLS = 'blog_id, blog_pw_enc, insta_id, insta_pw_enc, status'
    // 마이그 060 적용 전에는 key_version 이 없다 — 없으면 빼고 다시 읽고 v1 로 본다.
    let { data, error } = await admin
      .from('care_onboarding')
      .select(`${BASE_COLS}, key_version`)
      .eq('user_id', userId)
      .maybeSingle()
    if (error && isUndefinedColumn(error)) {
      ;({ data, error } = await admin
        .from('care_onboarding')
        .select(BASE_COLS)
        .eq('user_id', userId)
        .maybeSingle())
    }
    if (error || !data) {
      return NextResponse.json({ error: '온보딩 정보를 찾을 수 없습니다' }, { status: 404 })
    }
    const row = data as {
      blog_id: string
      blog_pw_enc: string | null
      insta_id: string | null
      insta_pw_enc: string | null
      status: string
      key_version?: number | null
    }
    const keyVersion = row.key_version ?? LEGACY_KEY_VERSION
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
        blogPassword: row.blog_pw_enc
          ? decryptCredential(row.blog_pw_enc, process.env, keyVersion)
          : null,
        instaId: row.insta_id,
        instaPassword: row.insta_pw_enc
          ? decryptCredential(row.insta_pw_enc, process.env, keyVersion)
          : null,
      },
      // 평문 자격증명 응답은 어디에도 남기지 않는다 (브라우저·프록시·CDN 캐시).
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' } },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
