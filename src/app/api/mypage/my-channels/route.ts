import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { cacheGet, cacheSet, DEFAULT_TTL_MS } from '@/content/lib/scoreboard/cache';
import { fetchSocialMetric, sanitizeHandle } from '@/content/lib/scoreboard/social';
import { fetchChannelStats, isValidChannelId } from '@/content/lib/scoreboard/youtube';
import { fetchOwnBlogFrequency } from '@/content/lib/scoreboard/own-blog';
import { extractNaverBlogId } from '@/content/lib/rank-tracking';
import {
  toNaverView,
  toSocialView,
  toYoutubeView,
  hasUnavailableConfigured,
  type MyChannelsData,
} from '@/content/lib/scoreboard/my-channels';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/mypage/my-channels
 *
 * 로그인 회원의 프로필에 등록된 자사 채널(인스타·쓰레드·유튜브·네이버 블로그)의
 * 공개 사실 지표를 한 번에 반환한다. 경쟁사 스코어보드 수집기를 그대로 재사용한다.
 *
 * - 각 채널 독립 실패 = graceful degrade (하나 죽어도 나머지는 반환).
 * - 쿼터 보호: 조립 결과를 6시간 캐싱(스코어보드 cache 재사용). 확인 불가 채널이
 *   있으면 30분만 캐싱해 재시도 여지를 남긴다.
 * - 응답: ApiResponse<MyChannelsData> 엔벨로프(success/data/error).
 * - 컴플라이언스: 매출·방문자수 추정치 미포함(공개 사실 지표만).
 */

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** 042(자사 채널) 미적용 환경에서도 안 깨지게 컬럼 셋을 단계적으로 축소해 조회. */
const CHANNEL_COL_SETS: readonly string[] = [
  'instagram_handle, threads_handle, youtube_channel_id, naver_blog_url',
  'naver_blog_url',
  'id',
];

interface ProfileChannels {
  instagram_handle?: string | null;
  threads_handle?: string | null;
  youtube_channel_id?: string | null;
  naver_blog_url?: string | null;
}

function isMissingColumnError(error: { code?: string } | null): boolean {
  return error?.code === '42703';
}

/** 존재하는 컬럼만 단계적으로 조회 — 마이그레이션 미적용 컬럼은 조용히 생략. */
async function loadProfileChannels(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
): Promise<ProfileChannels | null> {
  for (const cols of CHANNEL_COL_SETS) {
    const { data, error } = await supabase
      .from('profiles')
      .select(cols)
      .eq('id', userId)
      .single();
    if (isMissingColumnError(error)) continue;
    if (error && error.code !== 'PGRST116') return null;
    return (data ?? {}) as ProfileChannels;
  }
  return {};
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: '로그인이 필요합니다.' },
        { status: 401 },
      );
    }

    const profile = await loadProfileChannels(supabase, user.id);
    if (!profile) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: '프로필 정보를 불러올 수 없습니다.' },
        { status: 500 },
      );
    }

    // SSRF 방어: 저장값을 raw 로 쓰지 않고 검증된 핸들/ID 만 수집기에 넘긴다.
    const igHandle = profile.instagram_handle ? sanitizeHandle(profile.instagram_handle) : null;
    const thHandle = profile.threads_handle ? sanitizeHandle(profile.threads_handle) : null;
    const rawYt = typeof profile.youtube_channel_id === 'string' ? profile.youtube_channel_id.trim() : '';
    const ytChannelId = isValidChannelId(rawYt) ? rawYt : null;
    const blogId = profile.naver_blog_url ? extractNaverBlogId(profile.naver_blog_url) : null;

    const cacheKey = `mychannels:${user.id}`;
    const cached = cacheGet<MyChannelsData>(cacheKey);
    if (cached) {
      return NextResponse.json<ApiResponse<MyChannelsData>>({ success: true, data: cached });
    }

    const youtubeApiKey = process.env.YOUTUBE_API_KEY;

    // 각 채널 독립 조회 — 하나가 실패해도 나머지는 그대로 반환.
    const [instagram, threads, youtube, naver] = await Promise.all([
      igHandle
        ? fetchSocialMetric({ platform: 'instagram', handle: igHandle })
        : Promise.resolve(null),
      thHandle
        ? fetchSocialMetric({ platform: 'threads', handle: thHandle })
        : Promise.resolve(null),
      (async () => {
        if (!ytChannelId || !youtubeApiKey) return null;
        try {
          const stats = await fetchChannelStats(youtubeApiKey, [ytChannelId]);
          return stats[0] ?? null;
        } catch (err) {
          console.error('[my-channels] 유튜브 조회 실패:', err instanceof Error ? err.message : err);
          return null;
        }
      })(),
      blogId ? fetchOwnBlogFrequency(blogId) : Promise.resolve(null),
    ]);

    const data: MyChannelsData = {
      instagram: toSocialView(igHandle, instagram),
      threads: toSocialView(thHandle, threads),
      youtube: toYoutubeView(ytChannelId, youtube),
      naver: toNaverView(blogId, naver),
    };

    // 확인 불가 채널이 있으면 짧게(30분) 캐싱 — 재시도 여지 확보.
    const ttl = hasUnavailableConfigured(data) ? 30 * 60 * 1000 : DEFAULT_TTL_MS;
    cacheSet(cacheKey, data, ttl);

    return NextResponse.json<ApiResponse<MyChannelsData>>({ success: true, data });
  } catch (err) {
    console.error('[my-channels] 오류:', err instanceof Error ? err.message : err);
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: '채널 지표를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 500 },
    );
  }
}
