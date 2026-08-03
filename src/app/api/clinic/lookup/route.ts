import { NextRequest, NextResponse } from 'next/server'
import { searchNaverLocal } from '@/dev/lib/naver-search'
import {
  consumeClinicLookupQuota,
  extractClientIp,
  publicLimitMessage,
} from '@/content/lib/public-endpoint-limits'

export const dynamic = 'force-dynamic'

/**
 * GET /api/clinic/lookup?query=...
 *
 * 회원가입(미로그인) 단계의 병원 정보 자동채우기를 위해 공개로 둔다.
 * 네이버 공개 지역검색(사업자 디렉터리)만 프록시하며, 사용자 PII는 반환하지 않는다.
 * 남용 완화: 일일 캡(IP·전체) + 빈 쿼리/과도한 길이 차단 + display 서버 고정(5).
 *
 * ⚠️ 캡을 나중에 붙였다(2026-08-03 주간점검). 이건 **네이버 지역검색 일일 쿼터를
 *    태우는 프록시**다. 쿼터가 마르면 이 화면만 죽는 게 아니라 진단의 폴백 검색까지
 *    함께 죽고, 남의 집 한도라 우리가 복구할 수 없다 — 하루를 기다려야 한다.
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

    // 캡은 형식 검증 뒤에 — 반려된 입력이 한도를 갉아먹지 않게 한다.
    const quota = consumeClinicLookupQuota(extractClientIp(req.headers))
    if (!quota.allowed) {
      return NextResponse.json({ error: publicLimitMessage(quota.reason) }, { status: 429 })
    }

    const results = await searchNaverLocal(query, 5)
    return NextResponse.json({ results })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
