import { NextRequest, NextResponse } from 'next/server'
import { searchNaverLocal } from '@/dev/lib/naver-search'

export const dynamic = 'force-dynamic'

/**
 * GET /api/clinic/lookup?query=...
 *
 * 회원가입(미로그인) 단계의 병원 정보 자동채우기를 위해 공개로 둔다.
 * 네이버 공개 지역검색(사업자 디렉터리)만 프록시하며, 사용자 PII는 반환하지 않는다.
 * 남용 완화를 위해 빈 쿼리/과도한 길이 쿼리는 차단하고, display는 서버에서 5로 고정한다.
 *
 * 주의: Claude 비용이 드는 /api/clinic/profile-suggest 는 인증 필수를 유지한다.
 */
export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get('query')?.trim()
    if (!query) {
      return NextResponse.json({ error: '검색어가 필요합니다' }, { status: 400 })
    }
    if (query.length > 60) {
      return NextResponse.json({ error: '검색어가 너무 깁니다' }, { status: 400 })
    }

    const results = await searchNaverLocal(query, 5)
    return NextResponse.json({ results })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
