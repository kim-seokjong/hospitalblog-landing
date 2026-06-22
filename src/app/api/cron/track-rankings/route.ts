// 매일 1회 실행 — 발행글의 네이버 블로그 검색 추정 순위를 수집해 post_rankings에 적재.
// 추정 순위(관련도 sort=sim 기준)이며 정확한 웹 SERP 순위가 아니다.
// 인증: Authorization: Bearer ${CRON_SECRET} (Vercel Cron 자동 헤더). service role로 insert(RLS 우회).

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/dev/lib/cron-auth';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { getDecryptedCredentials } from '@/publish/lib/credentials';
import { searchNaverBlogRankItems } from '@/dev/lib/naver-search';
import { findRankInResults, extractNaverBlogId } from '@/content/lib/rank-tracking';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// 쿼터/부하 방어 상한
const LOOKBACK_MONTHS = 3;        // 최근 N개월 내 발행글만 추적
const MAX_POSTS = 200;            // 1회 실행 글 상한
const MAX_KEYWORD_CALLS = 200;    // 1회 실행 네이버 검색 호출 상한
const THROTTLE_MS = 250;          // 호출 사이 소폭 지연

interface PostRow {
  id: string;
  user_id: string;
  keyword: string | null;
  target_site: string | null;
  published_url: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const since = new Date();
  since.setMonth(since.getMonth() - LOOKBACK_MONTHS);

  let scanned = 0;
  let inserted = 0;
  let calls = 0;
  const failures: Array<{ postId: string; reason: string }> = [];

  try {
    // 최근 N개월 발행글 (키워드가 있는 것만 — 순위 추적의 전제)
    // published_at 은 현재 발행 시 기록되지 않아 null 인 경우가 많다 → created_at 폴백 포함.
    const sinceIso = since.toISOString();
    const { data, error } = await admin
      .from('saved_posts')
      .select('id, user_id, keyword, target_site, published_url')
      .eq('status', 'published')
      .or(`published_at.gte.${sinceIso},and(published_at.is.null,created_at.gte.${sinceIso})`)
      .order('created_at', { ascending: false })
      .limit(MAX_POSTS);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const posts = (data ?? []) as PostRow[];

    // 프로필 naver_blog_url 배치 조회 (대상 유저 한정, N+1 방지)
    // 추적 대상 blogId 우선순위: ① post.published_url(findRankInResults가 우선 사용)
    //   → ② profiles.naver_blog_url(공개 블로그 주소, 자동발행 연동 불필요)
    //   → ③ naver_credentials.naverId(기존 자동발행 연동, 하위호환)
    const userIds = Array.from(new Set(posts.map((p) => p.user_id)));
    const profileBlogIdCache = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profileRows } = await admin
        .from('profiles')
        .select('id, naver_blog_url')
        .in('id', userIds);
      for (const row of (profileRows ?? []) as Array<{ id: string; naver_blog_url: string | null }>) {
        const blogId = extractNaverBlogId(row.naver_blog_url);
        if (blogId) profileBlogIdCache.set(row.id, blogId);
      }
    }

    // 유저별 최종 blogId 캐시 (프로필 우선, 없으면 자격증명 복호화 1회/유저)
    const blogIdCache = new Map<string, string>();

    // 동일 (유저, 키워드) 검색결과 캐시 — 중복 호출 제거
    const searchCache = new Map<string, Awaited<ReturnType<typeof searchNaverBlogRankItems>>>();

    for (const post of posts) {
      scanned++;
      const keyword = (post.keyword ?? '').trim();
      // 네이버 대상 글만 추적 (target_site null = 네이버 간주). google은 스킵.
      if (post.target_site === 'google') continue;
      if (!keyword) continue;

      try {
        // blogId 확보 (유저별 캐시) — 프로필 공개 블로그 주소 우선, 없으면 자동발행 자격증명
        let blogId = blogIdCache.get(post.user_id);
        if (blogId === undefined) {
          const fromProfile = profileBlogIdCache.get(post.user_id);
          if (fromProfile) {
            blogId = fromProfile;
          } else {
            const creds = await getDecryptedCredentials(post.user_id);
            blogId = creds?.naverId?.trim() ?? '';
          }
          blogIdCache.set(post.user_id, blogId);
        }
        // blogId·publishedUrl 둘 다 없으면 매칭 불가 → 스킵
        if (!blogId && !post.published_url) continue;

        // 검색결과 (키워드 단위 캐시)
        const cacheKey = keyword.toLowerCase();
        let results = searchCache.get(cacheKey);
        if (results === undefined) {
          if (calls >= MAX_KEYWORD_CALLS) break; // 호출 상한 도달
          if (calls > 0) await sleep(THROTTLE_MS);
          results = await searchNaverBlogRankItems(keyword, 100);
          calls++;
          searchCache.set(cacheKey, results);
        }

        const rank = findRankInResults(results, {
          blogId: blogId || undefined,
          publishedUrl: post.published_url || undefined,
        });

        const { error: insErr } = await admin.from('post_rankings').insert({
          user_id: post.user_id,
          post_id: post.id,
          keyword,
          target_site: post.target_site ?? 'naver',
          rank, // null = 100위 내 미발견
        });
        if (insErr) {
          failures.push({ postId: post.id, reason: insErr.message });
          continue;
        }
        inserted++;
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'unknown';
        failures.push({ postId: post.id, reason });
      }
    }

    return NextResponse.json({ ok: true, scanned, inserted, calls, failures });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'cron failed';
    return NextResponse.json(
      { ok: false, error: message, scanned, inserted, calls, failures },
      { status: 500 },
    );
  }
}
