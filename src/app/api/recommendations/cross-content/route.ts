// 크로스 콘텐츠 추천 API — 블로그 ↔ 영상 선순환 루프.
// 인증 필수 · 본인 데이터만(RLS) · 전부 기존 테이블 조회 + 규칙 기반 계산 (LLM/마이그레이션 없음).

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { PLANS, isPaidPlanId } from '@/payment/lib/plans';
import {
  recommendBlogToVideo,
  recommendVideoToBlog,
  extractConversionTexts,
  type CrossPostInput,
  type CrossConversionInput,
  type ToVideoRecommendation,
  type ToBlogRecommendation,
} from '@/content/lib/cross-content';

export const dynamic = 'force-dynamic';

const LOOKBACK_MONTHS = 3; // 순위 추적(마이페이지)과 동일한 발행 글 조회 범위
const MAX_POSTS = 100;
const MAX_RANK_ROWS = 2000;
const MAX_CONVERSIONS = 30;
/** 같은 세션 반복 요청 대비 브라우저 캐시 (5분) */
const CACHE_CONTROL = 'private, max-age=300';

export interface CrossContentResponse {
  toVideo: ToVideoRecommendation[];
  toBlog: ToBlogRecommendation[];
  /** 번들(영상 포함) 미보유 → 영상 버튼을 업그레이드 안내로 대체 */
  bundleGated: boolean;
  /** 발행 글이 아예 없어 추천을 계산할 수 없는 상태 (에러 아님) */
  noPublishedPosts: boolean;
}

interface SavedPostRow {
  id: string;
  title: string;
  keyword: string | null;
  published_at: string | null;
  created_at: string | null;
}

interface RankingRow {
  post_id: string | null;
  rank: number | null;
  checked_at: string;
}

interface ConversionRow {
  conversion_id: string;
  created_at: string;
  result_assets: unknown;
  /** 마이그 038 — 미적용 DB 재조회 시 undefined */
  source_post_id?: string | null;
  source_keyword?: string | null;
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    // 0) 플랜 → 번들 게이트 (영상 한도가 있는 플랜만 영상 버튼 활성)
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single();
    const plan = profileRow?.plan ?? null;
    const bundleGated = !(isPaidPlanId(plan) && PLANS[plan].limits.video > 0);

    // 1) 최근 발행 글 (RLS 로 본인 것만, published_at 없으면 created_at 폴백)
    const since = new Date();
    since.setMonth(since.getMonth() - LOOKBACK_MONTHS);
    const sinceIso = since.toISOString();
    const { data: postsData, error: postsErr } = await supabase
      .from('saved_posts')
      .select('id, title, keyword, published_at, created_at')
      .eq('status', 'published')
      .or(`published_at.gte.${sinceIso},and(published_at.is.null,created_at.gte.${sinceIso})`)
      .order('created_at', { ascending: false })
      .limit(MAX_POSTS);
    if (postsErr) {
      return NextResponse.json({ error: postsErr.message }, { status: 500 });
    }
    const posts = (postsData ?? []) as SavedPostRow[];

    if (posts.length === 0) {
      // 데이터 부족 — 에러가 아니라 빈 추천 + 안내 플래그
      return NextResponse.json(
        { toVideo: [], toBlog: [], bundleGated, noPublishedPosts: true } satisfies CrossContentResponse,
        { headers: { 'Cache-Control': CACHE_CONTROL } },
      );
    }

    // 2) 글별 최신 순위 (최신순 조회 → 글당 첫 관측치만 사용)
    const { data: rankData } = await supabase
      .from('post_rankings')
      .select('post_id, rank, checked_at')
      .order('checked_at', { ascending: false })
      .limit(MAX_RANK_ROWS);
    const latestRankByPost = new Map<string, number | null>();
    for (const row of (rankData ?? []) as RankingRow[]) {
      if (!row.post_id || latestRankByPost.has(row.post_id)) continue;
      latestRankByPost.set(row.post_id, row.rank);
    }

    // 3) 최근 영상(멀티채널) 변환 이력 (RLS select_own 정책으로 본인 것만)
    //    source_post_id / source_keyword (마이그 038) 를 함께 읽어 중복 판정 1순위로 쓴다.
    //    마이그 미적용 DB(42703)면 기존 컬럼만으로 재조회 — 추천 자체는 계속 동작.
    let convRows: ConversionRow[];
    const firstTry = await supabase
      .from('clinicflix_conversions')
      .select('conversion_id, created_at, result_assets, source_post_id, source_keyword')
      .order('created_at', { ascending: false })
      .limit(MAX_CONVERSIONS);
    if (firstTry.error && firstTry.error.code === '42703') {
      const fallback = await supabase
        .from('clinicflix_conversions')
        .select('conversion_id, created_at, result_assets')
        .order('created_at', { ascending: false })
        .limit(MAX_CONVERSIONS);
      convRows = (fallback.data ?? []) as ConversionRow[];
    } else {
      convRows = (firstTry.data ?? []) as ConversionRow[];
    }
    const conversions: CrossConversionInput[] = convRows.map((c) => ({
      conversionId: c.conversion_id,
      createdAt: c.created_at,
      texts: extractConversionTexts(c.result_assets),
      sourcePostId: c.source_post_id ?? null,
      sourceKeyword: c.source_keyword ?? null,
    }));

    // 4) 규칙 기반 추천 계산 (순수 함수)
    const postInputs: CrossPostInput[] = posts.map((p) => ({
      id: p.id,
      title: p.title,
      keyword: p.keyword,
      publishedAt: p.published_at ?? p.created_at,
      latestRank: latestRankByPost.get(p.id) ?? null,
    }));

    const toVideo = recommendBlogToVideo(postInputs, conversions);
    const toBlog = recommendVideoToBlog(conversions, postInputs);

    return NextResponse.json(
      { toVideo, toBlog, bundleGated, noPublishedPosts: false } satisfies CrossContentResponse,
      { headers: { 'Cache-Control': CACHE_CONTROL } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
