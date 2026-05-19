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
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('profiles')
      .select(
        'full_name, phone, hospital_name, hospital_address, position, specialty, specialty_detail, hospital_desc, hospital_keywords, region, sms_enabled, sms_phone, notify_expiry, notify_usage'
      )
      .eq('id', user.id)
      .single()

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
    ]

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const key of allowed) {
      if (key in body) {
        updates[key] = body[key]
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)

    if (error) {
      return NextResponse.json({ error: '프로필 저장 실패' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
