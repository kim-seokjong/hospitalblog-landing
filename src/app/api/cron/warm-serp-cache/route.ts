// 주 1회 실행 — 자주 쓰는 키워드의 SERP 역분석 벤치마크를 미리 계산·캐시(워밍).
// 평소 글 생성 시 항상 캐시 히트가 되도록 해 첫 생성도 느리지 않게 한다.
// 인증: Authorization: Bearer ${CRON_SECRET} (Vercel Cron 자동 헤더). service role로 캐시 upsert(RLS 우회).
// 스케줄(vercel.json): "0 20 * * 0" = 매주 일요일 20:00 UTC = 월요일 05:00 KST(업무 시작 전).

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/dev/lib/cron-auth';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { buildSerpBenchmark } from '@/content/lib/serp-benchmark';
import {
  selectWarmKeywords,
  warmSerpCache,
  WARM_KEYWORD_LIMIT,
  WARM_TARGET_SITES,
} from '@/content/lib/serp-benchmark-cache';
import { createSupabaseBenchmarkStore } from '@/content/lib/serp-benchmark-store';
import { getDefaultSeedKeywords } from '@/content/lib/serp-warm-seeds';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// 부하/비용 가드
const POST_SCAN_LIMIT = 500; // 키워드 집계용으로 훑을 최근 글 상한
const WARM_CONCURRENCY = 3; // 동시 벤치마크 산출 수

interface PostKeywordRow {
  keyword: string | null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const admin = createAdminClient();

  try {
    // 1) 키워드 소스 = 최근 생성된 글의 keyword (없으면 진료과 시드로 폴백)
    let postKeywords: Array<string | null> = [];
    try {
      const { data } = await admin
        .from('saved_posts')
        .select('keyword')
        .not('keyword', 'is', null)
        .order('created_at', { ascending: false })
        .limit(POST_SCAN_LIMIT);
      postKeywords = ((data ?? []) as PostKeywordRow[]).map((r) => r.keyword);
    } catch {
      // 조회 실패는 무시 — 시드 폴백으로 진행
      postKeywords = [];
    }

    const keywords = selectWarmKeywords(
      postKeywords,
      getDefaultSeedKeywords(),
      WARM_KEYWORD_LIMIT
    );

    if (keywords.length === 0) {
      return NextResponse.json({
        ok: true,
        attempted: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        cachedEntries: 0,
        usedSeedFallback: postKeywords.length === 0,
        elapsedMs: Date.now() - startedAt,
      });
    }

    // 2) 워밍 — 키워드당 1회 산출 후 naver/google 캐시에 강제 upsert(만료 무관 갱신)
    const store = createSupabaseBenchmarkStore(admin);
    const result = await warmSerpCache({
      keywords,
      targetSites: WARM_TARGET_SITES,
      store,
      compute: (keyword) => buildSerpBenchmark(keyword),
      concurrency: WARM_CONCURRENCY,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      keywordCount: keywords.length,
      usedSeedFallback: postKeywords.length === 0,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'cron failed';
    return NextResponse.json(
      { ok: false, error: message, elapsedMs: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
