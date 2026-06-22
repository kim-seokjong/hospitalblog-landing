import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/dev/lib/supabase/server'

interface ProfileUpdateBody {
  full_name?: string
  phone?: string
  hospital_name?: string
  hospital_address?: string
  position?: string
  specialty?: string
  specialty_detail?: string
  hospital_desc?: string
  hospital_keywords?: string[]
  region?: string
  sms_enabled?: boolean
  sms_phone?: string
  notify_expiry?: boolean
  notify_usage?: boolean
  naver_blog_url?: string
}

// 마이그레이션 028(naver_blog_url) 미적용 환경에서도 안 깨지게 base/full 분리.
const PROFILE_COLS_BASE =
  'full_name, phone, hospital_name, hospital_address, position, specialty, specialty_detail, hospital_desc, hospital_keywords, region, sms_enabled, sms_phone, notify_expiry, notify_usage'
const PROFILE_COLS_FULL = `${PROFILE_COLS_BASE}, naver_blog_url`

function isMissingBlogUrlColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42703' || (error.message?.includes('naver_blog_url') ?? false)
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    let { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLS_FULL)
      .eq('id', user.id)
      .single()

    // naver_blog_url 컬럼이 아직 없으면(마이그 028 미적용) 컬럼 제외 후 재조회
    if (isMissingBlogUrlColumn(error)) {
      ;({ data, error } = await supabase
        .from('profiles')
        .select(PROFILE_COLS_BASE)
        .eq('id', user.id)
        .single())
    }

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json({ error: '프로필 조회 실패' }, { status: 500 })
    }

    return NextResponse.json({ profile: data ?? {} })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const body = await req.json() as ProfileUpdateBody

    const allowed: (keyof ProfileUpdateBody)[] = [
      'full_name', 'phone', 'hospital_name', 'hospital_address', 'position',
      'specialty', 'specialty_detail', 'hospital_desc', 'hospital_keywords',
      'region', 'sms_enabled', 'sms_phone', 'notify_expiry', 'notify_usage',
      'naver_blog_url',
    ]

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const key of allowed) {
      if (key in body) {
        // 빈 문자열은 null 로 저장 (미설정 의미 명확화)
        if (key === 'naver_blog_url') {
          const v = typeof body.naver_blog_url === 'string' ? body.naver_blog_url.trim() : ''
          updates[key] = v === '' ? null : v
        } else {
          updates[key] = body[key]
        }
      }
    }

    let { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)

    // naver_blog_url 컬럼이 아직 없으면(마이그 028 미적용) 해당 키 제외 후 재저장
    if (isMissingBlogUrlColumn(error)) {
      const { naver_blog_url, ...rest } = updates
      void naver_blog_url
      ;({ error } = await supabase
        .from('profiles')
        .update(rest)
        .eq('id', user.id))
    }

    if (error) {
      return NextResponse.json({ error: '프로필 저장 실패' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
