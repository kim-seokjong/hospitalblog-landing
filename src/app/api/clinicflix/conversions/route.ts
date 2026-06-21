import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/dev/lib/supabase/server'
import { getConversionsByUser } from '@/content/lib/clinicflix-usage'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    const conversions = await getConversionsByUser(user.id, 50)
    return NextResponse.json({ conversions })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
