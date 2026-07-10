import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { cacheGet, cacheSet } from '@/content/lib/scoreboard/cache';
import {
  fetchChannelStats,
  isValidChannelId,
  MAX_CHANNELS,
  searchChannelIds,
  type YoutubeChannelStats,
} from '@/content/lib/scoreboard/youtube';

export const dynamic = 'force-dynamic';

/**
 * POST /api/competitor-video
 * body: { query?: string } 또는 { channelIds?: string[] }
 *
 * 유튜브 경쟁 채널 비교 (공식 YouTube Data API v3).
 * - env YOUTUBE_API_KEY 없으면 501 + configRequired (UI는 설정 안내만 표시).
 * - 쿼터 보호: 결과 6h 인메모리 캐싱 + 요청당 채널 최대 5개.
 */

interface RequestBody {
  query?: string;
  channelIds?: string[];
}

interface VideoCompareResponse {
  channels: YoutubeChannelStats[];
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error: '유튜브 비교 기능은 관리자 키 설정이 필요합니다. (YOUTUBE_API_KEY)',
          configRequired: true,
        },
        { status: 501 }
      );
    }

    const body = (await req.json()) as RequestBody;
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const rawChannelIds = Array.isArray(body.channelIds) ? body.channelIds : [];

    const channelIdsInput = rawChannelIds
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter((id) => isValidChannelId(id))
      .slice(0, MAX_CHANNELS);

    if (!query && channelIdsInput.length === 0) {
      return NextResponse.json(
        { error: '검색어(query) 또는 채널 ID(channelIds)를 입력해주세요.' },
        { status: 400 }
      );
    }
    if (query && query.length > 60) {
      return NextResponse.json({ error: '검색어는 60자 이하로 입력해주세요.' }, { status: 400 });
    }

    const cacheKey = channelIdsInput.length > 0
      ? `video:ids:${channelIdsInput.slice().sort().join(',')}`
      : `video:q:${query}`;

    const cached = cacheGet<VideoCompareResponse>(cacheKey);
    if (cached) {
      return NextResponse.json({ ...cached, cached: true });
    }

    const channelIds = channelIdsInput.length > 0
      ? channelIdsInput
      : await searchChannelIds(apiKey, query);

    if (channelIds.length === 0) {
      const empty: VideoCompareResponse = { channels: [] };
      cacheSet(cacheKey, empty);
      return NextResponse.json(empty);
    }

    const channels = await fetchChannelStats(apiKey, channelIds);
    const payload: VideoCompareResponse = { channels };
    cacheSet(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (err) {
    console.error('[competitor-video] 오류:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: '유튜브 채널 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 502 }
    );
  }
}
