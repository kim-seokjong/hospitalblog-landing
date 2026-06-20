import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/dev/lib/supabase/server'

export const dynamic = 'force-dynamic'

const CATEGORIES = ['exterior', 'interior', 'equipment', 'staff', 'etc'] as const
type Category = (typeof CATEGORIES)[number]

interface ClinicPhotoRow {
  id: string
  category: string
  url: string
  consent: boolean
  note: string | null
  created_at: string
}

/**
 * GET /api/clinicflix/photos
 * 인증 사용자의 사진 보관함을 최신순으로 반환한다.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('clinic_photos')
      .select('id, category, url, consent, note, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: '사진 조회 실패' }, { status: 500 })
    }

    return NextResponse.json({ photos: (data ?? []) as ClinicPhotoRow[] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

type ValidatedPhoto = {
  category: Category
  url: string
  consent: boolean
  note: string | null
}

type ValidationResult =
  | { ok: true; value: ValidatedPhoto }
  | { ok: false; error: string }

function validate(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: '요청 본문이 올바르지 않습니다.' }
  }
  const b = raw as Record<string, unknown>

  const category = b.category
  if (typeof category !== 'string' || !(CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: '사진 카테고리가 올바르지 않습니다.' }
  }

  const url = b.url
  if (typeof url !== 'string' || !url.trim()) {
    return { ok: false, error: '사진 URL 이 없습니다.' }
  }

  const consent = typeof b.consent === 'boolean' ? b.consent : false

  let note: string | null = null
  if ('note' in b && b.note != null) {
    if (typeof b.note !== 'string') {
      return { ok: false, error: '메모 형식이 올바르지 않습니다.' }
    }
    note = b.note.trim() || null
  }

  // 의료진 사진은 게시 동의 필수
  if (category === 'staff' && consent !== true) {
    return { ok: false, error: '의료진 사진은 동의가 필요합니다' }
  }

  return { ok: true, value: { category: category as Category, url: url.trim(), consent, note } }
}

/**
 * POST /api/clinicflix/photos
 * 인증 사용자 본인 소유로 사진 1건을 등록한다.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const raw = await req.json().catch(() => null)
    const result = validate(raw)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    const { error, data } = await supabase
      .from('clinic_photos')
      .insert({
        user_id: user.id,
        category: result.value.category,
        url: result.value.url,
        consent: result.value.consent,
        note: result.value.note,
      })
      .select('id, category, url, consent, note, created_at')
      .single()

    if (error) {
      return NextResponse.json({ error: '사진 저장 실패' }, { status: 500 })
    }

    return NextResponse.json({ photo: data as ClinicPhotoRow })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * DELETE /api/clinicflix/photos?id=...
 * 본인 소유 사진만 삭제한다.
 */
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: '삭제할 사진 ID 가 없습니다.' }, { status: 400 })
    }

    const { error } = await supabase
      .from('clinic_photos')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json({ error: '사진 삭제 실패' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
