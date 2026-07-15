import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { fetchGoldenKeywords, type GoldenKeywordResult } from '@/content/lib/golden-keywords';
import {
  applySeasonalBoost,
  fetchSeasonalKeywords,
  type GoldenKeywordWithSeasonal,
  type SeasonalKeywordResult,
} from '@/content/lib/seasonal-keywords';
import { normalizeKeyword } from '@/content/lib/keyword-volume';
import { cacheGet, cacheSet } from '@/content/lib/scoreboard/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/keywords/golden
 * body: { keyword, region?, specialty? }
 *
 * 황금 키워드 추천 — "검색량은 충분한데 블로그 문서수(경쟁)는 적은" 키워드.
 * - keywordstool 연관 키워드(1콜) + 상위 20개만 블로그 문서수 조회 (호출 낭비 방지)
 * - specialty 가 있으면 데이터랩 계절성 부스트 반영 (지금 달·다음 달 상승 국면)
 * - 캐시: 황금 6시간 / 계절성은 월 단위로 사실상 고정 → 7일 (인메모리 — 새 테이블 없음)
 * - 그레이스풀: 검색광고 env 없으면 available:false, 데이터랩 실패는 계절 섹션만 숨김
 */

interface RequestBody {
  keyword?: string;
  region?: string;
  specialty?: string;
}

interface GoldenResponse {
  available: boolean;
  docAvailable: boolean;
  items: GoldenKeywordWithSeasonal[];
  seasonal: { available: boolean; items: SeasonalKeywordResult['items'] };
}

const EMPTY_RESPONSE: GoldenResponse = {
  available: false,
  docAvailable: false,
  items: [],
  seasonal: { available: false, items: [] },
};

/** 계절성 캐시 TTL: 월 단위 데이터라 7일이면 충분 (데이터랩 일 1,000회 한도 보호) */
const SEASONAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 계절성 조회 + 월 단위 캐시 (진료과 없으면 즉시 빈 결과) */
async function getSeasonalCached(specialty: string): Promise<SeasonalKeywordResult> {
  if (!specialty) {
    return { available: true, targetMonths: [], items: [] };
  }
  const yearMonth = new Date().toISOString().slice(0, 7);
  const cacheKey = `seasonal:${normalizeKeyword(specialty)}:${yearMonth}`;
  const cached = cacheGet<SeasonalKeywordResult>(cacheKey);
  if (cached) return cached;

  const result = await fetchSeasonalKeywords(specialty);
  if (result.available) {
    cacheSet(cacheKey, result, SEASONAL_TTL_MS);
  }
  return result;
}

/** 황금 키워드 조회 + 6시간 캐시 */
async function getGoldenCached(keyword: string, region: string): Promise<GoldenKeywordResult> {
  const cacheKey = `golden:${normalizeKeyword(keyword)}:${normalizeKeyword(region)}`;
  const cached = cacheGet<GoldenKeywordResult>(cacheKey);
  if (cached) return cached;

  const result = await fetchGoldenKeywords(keyword, { region });
  if (result.available) {
    cacheSet(cacheKey, result);
  }
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = (await req.json()) as RequestBody;
    const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';
    const region = typeof body.region === 'string' ? body.region.trim() : '';
    const specialty = typeof body.specialty === 'string' ? body.specialty.trim() : '';

    if (!keyword) {
      return NextResponse.json({ error: '키워드를 입력해주세요.' }, { status: 400 });
    }
    if (keyword.length > 40 || region.length > 30 || specialty.length > 30) {
      return NextResponse.json({ error: '입력값이 너무 깁니다.' }, { status: 400 });
    }

    const [golden, seasonal] = await Promise.all([
      getGoldenCached(keyword, region),
      getSeasonalCached(specialty),
    ]);

    const seasonalItems = seasonal.available ? seasonal.items : [];
    const response: GoldenResponse = {
      available: golden.available,
      docAvailable: golden.docAvailable,
      items: applySeasonalBoost(golden.items, seasonalItems),
      seasonal: { available: seasonal.available, items: seasonalItems },
    };
    return NextResponse.json(response);
  } catch {
    // 라우트 레벨 예외도 그레이스풀 — 추천 패널만 숨기고 글 생성 플로우 방해 금지
    return NextResponse.json(EMPTY_RESPONSE);
  }
}
