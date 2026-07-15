import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import {
  fetchKeywordBoard,
  type KeywordBoardResult,
} from '@/content/lib/scoreboard/keyword-volume-board';
import { normalizeKeyword } from '@/content/lib/keyword-volume';
import { cacheGet, cacheSet } from '@/content/lib/scoreboard/cache';

export const dynamic = 'force-dynamic';

/**
 * POST /api/competitor-keywords
 * body: { specialty, region }
 *
 * 경쟁 종합 비교 — 키워드 검색량·경쟁정도 카드 데이터.
 * 네이버 검색광고 keywordstool 공개 지표(월 검색량·compIdx)만 반환한다.
 * 컴플라이언스: 매출·방문자 추정치 절대 반환 금지.
 * 그레이스풀: 검색광고 env 없으면 { available:false } → 카드가 조용히 숨는다.
 */

interface RequestBody {
  specialty?: string;
  region?: string;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = (await req.json()) as RequestBody;
    const specialty = typeof body.specialty === 'string' ? body.specialty.trim() : '';
    const region = typeof body.region === 'string' ? body.region.trim() : '';

    if (!specialty || !region) {
      return NextResponse.json({ error: '진료과목과 지역을 입력해주세요.' }, { status: 400 });
    }
    if (specialty.length > 30 || region.length > 30) {
      return NextResponse.json({ error: '입력값이 너무 깁니다.' }, { status: 400 });
    }

    const cacheKey = `kwboard:${normalizeKeyword(specialty)}:${normalizeKeyword(region)}`;
    const cached = cacheGet<KeywordBoardResult>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const result = await fetchKeywordBoard(specialty, region);
    if (result.available) {
      cacheSet(cacheKey, result);
    }
    return NextResponse.json(result);
  } catch {
    // 카드 하나의 실패가 스코어보드 전체를 막지 않도록 그레이스풀
    return NextResponse.json({ available: false, rows: [] } satisfies KeywordBoardResult);
  }
}
