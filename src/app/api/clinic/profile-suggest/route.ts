import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/dev/lib/supabase/server'
import { suggestClinicProfile } from '@/content/lib/clinic-profile'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/clinic/profile-suggest
 * body: { hospital_name, specialty, specialty_detail?, region? }
 * Claude 로 병원 소개문·키워드 초안을 생성한다.
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

    const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const hospitalName = typeof raw?.hospital_name === 'string' ? raw.hospital_name.trim() : ''
    const specialty = typeof raw?.specialty === 'string' ? raw.specialty.trim() : ''
    const specialtyDetail =
      typeof raw?.specialty_detail === 'string' ? raw.specialty_detail.trim() : ''
    const region = typeof raw?.region === 'string' ? raw.region.trim() : ''

    if (!hospitalName || !specialty) {
      return NextResponse.json(
        { error: '병원명과 진료과목이 필요합니다' },
        { status: 400 },
      )
    }

    const result = await suggestClinicProfile({
      hospitalName,
      specialty,
      specialtyDetail,
      region,
    })

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
