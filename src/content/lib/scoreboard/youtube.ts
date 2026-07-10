import { fetchWithTimeout } from '@/content/lib/scoreboard/fetch-utils';

/**
 * 유튜브 경쟁 채널 비교 — 공식 YouTube Data API v3 만 사용.
 *
 * 쿼터 보호:
 * - 라우트에서 결과를 6시간 캐싱한다 (scoreboard/cache).
 * - 요청당 채널 최대 5개 (MAX_CHANNELS).
 * - 업로드 빈도는 search 대신 uploads 재생목록 playlistItems(쿼터 1)로 계산.
 */

export const MAX_CHANNELS = 5;

export interface YoutubeChannelStats {
  channelId: string;
  title: string;
  thumbnailUrl: string | null;
  subscriberCount: number | null; // 채널이 구독자 수를 숨기면 null
  videoCount: number | null;
  viewCount: number | null;
  uploadsIn30Days: number | null; // 최근 30일 업로드 수 (확인 실패 시 null)
  uploadsPerWeek: number | null;  // 위 값의 주당 환산 (소수 1자리)
}

const API_BASE = 'https://www.googleapis.com/youtube/v3';

export function isValidChannelId(id: string): boolean {
  return /^UC[A-Za-z0-9_-]{22}$/.test(id);
}

interface SearchListResponse {
  items?: Array<{ id?: { channelId?: string } }>;
}

interface ChannelsListResponse {
  items?: Array<{
    id?: string;
    snippet?: { title?: string; thumbnails?: { default?: { url?: string } } };
    statistics?: {
      subscriberCount?: string;
      hiddenSubscriberCount?: boolean;
      videoCount?: string;
      viewCount?: string;
    };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
}

interface PlaylistItemsResponse {
  items?: Array<{ contentDetails?: { videoPublishedAt?: string } }>;
}

async function apiGet<T>(apiKey: string, path: string, params: Record<string, string>): Promise<T> {
  const search = new URLSearchParams({ ...params, key: apiKey });
  const res = await fetchWithTimeout(`${API_BASE}/${path}?${search}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API 오류 (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** 검색어로 채널 ID 최대 5개 조회 (search.list, 쿼터 100). */
export async function searchChannelIds(apiKey: string, query: string): Promise<string[]> {
  const data = await apiGet<SearchListResponse>(apiKey, 'search', {
    part: 'snippet',
    type: 'channel',
    q: query,
    maxResults: String(MAX_CHANNELS),
    regionCode: 'KR',
    relevanceLanguage: 'ko',
  });
  return (data.items ?? [])
    .map((item) => item.id?.channelId ?? '')
    .filter((id) => isValidChannelId(id))
    .slice(0, MAX_CHANNELS);
}

function toNullableNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 최근 30일 업로드 수 (uploads 재생목록 최신 10개 기준 — 하한 추정). */
async function fetchUploadsIn30Days(
  apiKey: string,
  uploadsPlaylistId: string,
  now: Date
): Promise<number | null> {
  try {
    const data = await apiGet<PlaylistItemsResponse>(apiKey, 'playlistItems', {
      part: 'contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: '10',
    });
    const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    return (data.items ?? []).filter((item) => {
      const publishedAt = item.contentDetails?.videoPublishedAt;
      if (!publishedAt) return false;
      const t = Date.parse(publishedAt);
      return Number.isFinite(t) && t >= cutoff;
    }).length;
  } catch {
    // 업로드 빈도는 부가 정보 — 실패해도 채널 통계는 그대로 반환
    return null;
  }
}

/** 채널 통계 + 최근 업로드 빈도 조회. */
export async function fetchChannelStats(
  apiKey: string,
  channelIds: string[],
  now: Date = new Date()
): Promise<YoutubeChannelStats[]> {
  const ids = channelIds.filter(isValidChannelId).slice(0, MAX_CHANNELS);
  if (ids.length === 0) return [];

  const data = await apiGet<ChannelsListResponse>(apiKey, 'channels', {
    part: 'snippet,statistics,contentDetails',
    id: ids.join(','),
    maxResults: String(MAX_CHANNELS),
  });

  const results: YoutubeChannelStats[] = [];
  for (const item of data.items ?? []) {
    if (!item.id) continue;
    const stats = item.statistics;
    const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads;

    const uploadsIn30Days = uploadsPlaylistId
      ? await fetchUploadsIn30Days(apiKey, uploadsPlaylistId, now)
      : null;

    results.push({
      channelId: item.id,
      title: item.snippet?.title ?? '',
      thumbnailUrl: item.snippet?.thumbnails?.default?.url ?? null,
      subscriberCount: stats?.hiddenSubscriberCount ? null : toNullableNumber(stats?.subscriberCount),
      videoCount: toNullableNumber(stats?.videoCount),
      viewCount: toNullableNumber(stats?.viewCount),
      uploadsIn30Days,
      uploadsPerWeek:
        uploadsIn30Days === null ? null : Math.round((uploadsIn30Days / 30) * 7 * 10) / 10,
    });
  }
  return results;
}
