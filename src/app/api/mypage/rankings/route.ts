// 마이페이지 성과 리포트 — 발행글별 최신 추정순위 + 순위 시계열 + 키워드 검색량.
// 모든 데이터는 본인 것만(RLS + user_id). 검색량은 그레이스풀(키 없으면 생략).

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { fetchKeywordVolumes, type KeywordVolume } from '@/content/lib/keyword-volume';
import { extractNaverBlogId } from '@/content/lib/rank-tracking';

export const dynamic = 'force-dynamic';

const LOOKBACK_MONTHS = 3;
const MAX_HISTORY_PER_POST = 12; // 글당 최근 추적 N회
const MAX_VOLUME_KEYWORDS = 5;   // 검색광고 hintKeywords 권장 상한

interface RankingRow {
  post_id: string | null;
  keyword: string;
  rank: number | null;
  checked_at: string;
}

export interface RankPoint {
  rank: number | null;
  checkedAt: string;
}

export interface PostRankingItem {
  postId: string;
  title: string;
  keyword: string | null;
  targetSite: 'naver' | 'google' | null;
  publishedUrl: string | null;
  publishedAt: string | null;
  latestRank: number | null;
  history: RankPoint[];
  volume: KeywordVolume | null;
}

export interface RankingsResponse {
  items: PostRankingItem[];
  volumeAvailable: boolean;
  /** 프로필에 유효한 공개 블로그 주소가 설정돼 추적 가능한지 여부 */
  blogConfigured: boolean;
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const since = new Date();
    since.setMonth(since.getMonth() - LOOKBACK_MONTHS);

    // 0) 추적 가능 여부 — 프로필에 유효한 공개 블로그 주소가 설정됐는지
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('naver_blog_url')
      .eq('id', user.id)
      .single();
    const blogConfigured = extractNaverBlogId(profileRow?.naver_blog_url ?? null) !== null;

    // 1) 최근 발행글 (RLS로 본인 것만)
    const { data: postsData, error: postsErr } = await supabase
      .from('saved_posts')
      .select('id, title, keyword, target_site, published_url, published_at')
      .eq('status', 'published')
      .gte('published_at', since.toISOString())
      .order('published_at', { ascending: false })
      .limit(100);

    if (postsErr) {
      return NextResponse.json({ error: postsErr.message }, { status: 500 });
    }
    const posts = postsData ?? [];
    if (posts.length === 0) {
      return NextResponse.json({ items: [], volumeAvailable: false, blogConfigured } satisfies RankingsResponse);
    }

    // 2) 순위 시계열 (RLS로 본인 것만). 최신순으로 가져와 글별로 그룹핑.
    const { data: rankData } = await supabase
      .from('post_rankings')
      .select('post_id, keyword, rank, checked_at')
      .order('checked_at', { ascending: false })
      .limit(2000);

    const byPost = new Map<string, RankPoint[]>();
    for (const row of (rankData ?? []) as RankingRow[]) {
      if (!row.post_id) continue;
      const list = byPost.get(row.post_id) ?? [];
      if (list.length < MAX_HISTORY_PER_POST) {
        list.push({ rank: row.rank, checkedAt: row.checked_at });
        byPost.set(row.post_id, list);
      }
    }

    // 3) 검색량 (그레이스풀) — 최신순 발행글 키워드 상위 N개만 조회
    const keywords = Array.from(
      new Set(
        posts
          .map((p) => (p.keyword ?? '').trim())
          .filter((k) => k.length > 0),
      ),
    ).slice(0, MAX_VOLUME_KEYWORDS);
    const volumeResult = await fetchKeywordVolumes(keywords);

    const items: PostRankingItem[] = posts.map((p) => {
      const history = byPost.get(p.id) ?? []; // 최신순
      const latestRank = history.length > 0 ? history[0].rank : null;
      const kw = (p.keyword ?? '').trim();
      const volume = kw ? volumeResult.volumes[kw] ?? null : null;
      const targetSite =
        p.target_site === 'naver' || p.target_site === 'google' ? p.target_site : null;
      return {
        postId: p.id,
        title: p.title,
        keyword: p.keyword ?? null,
        targetSite,
        publishedUrl: p.published_url ?? null,
        publishedAt: p.published_at ?? null,
        latestRank,
        // 차트는 과거→현재 순이 자연스러우므로 뒤집어 반환
        history: [...history].reverse(),
        volume,
      };
    });

    return NextResponse.json({
      items,
      volumeAvailable: volumeResult.available,
      blogConfigured,
    } satisfies RankingsResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
