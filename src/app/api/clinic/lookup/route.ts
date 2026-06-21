import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/dev/lib/supabase/server'
import { searchNaverLocal } from '@/dev/lib/naver-search'

export const dynamic = 'force-dynamic'

/**
 * GET /api/clinic/lookup?query=...
 * 인증 사용자만 네이버 지역검색으로 병원 후보를 조회한다(남용 방지).
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const query = req.nextUrl.searchParams.get('query')?.trim()
    if (!query) {
      return NextResponse.json({ error: '검색어가 필요합니다' }, { status: 400 })
    }

    const results = await searchNaverLocal(query, 5)
    return NextResponse.json({ results })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
