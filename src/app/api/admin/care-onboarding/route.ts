// 관리자 전용 — 케어 온보딩 목록 조회 + 계정 정보 복호화(개별·요청 시에만).
//
// GET  : 온보딩 전체 목록 (비밀번호 미포함, 병원명 조인)
// POST : { userId } — 해당 회원의 위임 계정 정보를 복호화해 반환.
//        발행 작업 직전에만 호출하는 용도. 호출 사실을 서버 로그에 남긴다.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/dev/lib/supabase/server'
import { isAdmin } from '@/hr/lib/admin'
import { decryptCredential } from '@/payment/lib/care-credentials'

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

    // 병원명 조인 (별도 조회 — FK 조인 의존 없이)
    const ids = rows.map((r) => r.user_id)
    const names = new Map<string, string>()
    if (ids.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, hospital_name')
        .in('id', ids)
      for (const p of (profiles ?? []) as Array<{ id: string; hospital_name: string | null }>) {
        names.set(p.id, p.hospital_name ?? '(병원명 미입력)')
      }
    }

    return NextResponse.json({
      items: rows.map((r) => ({
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
      })),
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

    // 복호화 접근 기록 — 열람자(관리자 이메일)·대상을 남긴다 (시각은 로그 타임스탬프)
    console.warn(
      `[admin/care-onboarding] 계정 정보 복호화 열람 (admin=${auth.email}, target=${userId})`,
    )

    return NextResponse.json({
      blogId: row.blog_id,
      blogPassword: row.blog_pw_enc ? decryptCredential(row.blog_pw_enc) : null,
      instaId: row.insta_id,
      instaPassword: row.insta_pw_enc ? decryptCredential(row.insta_pw_enc) : null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
