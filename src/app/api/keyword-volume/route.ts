import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { fetchKeywordVolumes } from '@/content/lib/keyword-volume';

/**
 * GET /api/keyword-volume?hintKeywords=kw1,kw2
 * 네이버 검색광고 API(keywordstool) 로 월 검색량·경쟁강도 조회.
 *
 * 그레이스풀: 검색광고 env(NAVER_AD_API_KEY / NAVER_AD_SECRET_KEY /
 * NAVER_AD_CUSTOMER_ID) 가 하나라도 없으면 throw 하지 않고
 * { available:false, volumes:{} } 를 반환한다. 호출/파싱 실패도 동일.
 * 인증 게이트는 competitor-monitor 와 동일하게 "로그인 필요" 수준.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const raw = searchParams.get('hintKeywords') ?? '';
    const keywords = raw
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
      .slice(0, 5);

    const result = await fetchKeywordVolumes(keywords);
    return NextResponse.json(result);
  } catch {
    // 라우트 레벨 예외도 그레이스풀하게 — 검색량 배지는 숨기고 전체 다운 방지
    return NextResponse.json({ available: false, volumes: {} });
  }
}
