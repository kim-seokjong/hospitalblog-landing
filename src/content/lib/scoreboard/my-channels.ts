import type { SocialMetric } from '@/content/lib/scoreboard/social';
import type { YoutubeChannelStats } from '@/content/lib/scoreboard/youtube';
import type { PublishFrequencyResult } from '@/content/lib/scoreboard/publish-frequency';

/**
 * "내 채널 통합 뷰"(My Channels) 응답 shaping — 순수 로직 (외부 의존성 0).
 *
 * 각 채널은 서로 독립이며, 수집 실패는 다른 채널에 영향을 주지 않는다.
 * 상태 규칙(각 채널 독립 적용):
 *  - not_configured : 프로필에 핸들/주소 미입력 (수집 자체를 시도하지 않음)
 *  - unavailable    : 입력은 있으나 조회 실패(비공개·차단·타임아웃·API 키 없음 등)
 *  - ok             : 공개 사실 지표 조회 성공
 *
 * 컴플라이언스(회사 규칙): 매출·방문자수 추정치는 절대 포함하지 않는다.
 * 도달·참여·발행량 등 공개 사실 지표만 담는다.
 */

export type ChannelStatus = 'ok' | 'unavailable' | 'not_configured';

export interface SocialChannelView {
  status: ChannelStatus;
  handle: string | null;
  followers: number | null;
  posts: number | null;
}

export interface YoutubeChannelView {
  status: ChannelStatus;
  channelId: string | null;
  title: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  uploadsPerWeek: number | null;
  uploadsIn30Days: number | null;
}

export interface NaverChannelView {
  status: ChannelStatus;
  blogId: string | null;
  perWeek: number | null;
  postsIn30Days: number | null;
}

export interface MyChannelsData {
  instagram: SocialChannelView;
  threads: SocialChannelView;
  youtube: YoutubeChannelView;
  naver: NaverChannelView;
}

/**
 * 인스타/쓰레드 뷰 매핑.
 * @param handle 검증된 핸들(미입력이면 null)
 * @param metric fetchSocialMetric 결과(조회 실패/시도 안 함이면 null)
 */
export function toSocialView(
  handle: string | null,
  metric: SocialMetric | null,
): SocialChannelView {
  if (!handle) {
    return { status: 'not_configured', handle: null, followers: null, posts: null };
  }
  if (!metric || metric.status !== 'ok') {
    return { status: 'unavailable', handle, followers: null, posts: null };
  }
  return { status: 'ok', handle, followers: metric.followers, posts: metric.posts };
}

/**
 * 유튜브 뷰 매핑.
 * @param channelId 검증된 채널 ID(미입력이면 null)
 * @param stats fetchChannelStats 결과 중 해당 채널(조회 실패/시도 안 함이면 null)
 */
export function toYoutubeView(
  channelId: string | null,
  stats: YoutubeChannelStats | null,
): YoutubeChannelView {
  if (!channelId) {
    return {
      status: 'not_configured',
      channelId: null,
      title: null,
      subscriberCount: null,
      viewCount: null,
      videoCount: null,
      uploadsPerWeek: null,
      uploadsIn30Days: null,
    };
  }
  if (!stats) {
    return {
      status: 'unavailable',
      channelId,
      title: null,
      subscriberCount: null,
      viewCount: null,
      videoCount: null,
      uploadsPerWeek: null,
      uploadsIn30Days: null,
    };
  }
  return {
    status: 'ok',
    channelId,
    title: stats.title || null,
    subscriberCount: stats.subscriberCount,
    viewCount: stats.viewCount,
    videoCount: stats.videoCount,
    uploadsPerWeek: stats.uploadsPerWeek,
    uploadsIn30Days: stats.uploadsIn30Days,
  };
}

/**
 * 네이버 블로그 뷰 매핑.
 * @param blogId 검증된 블로그 ID(미입력이면 null)
 * @param freq fetchOwnBlogFrequency 결과(조회 실패면 null)
 *
 * 조회는 성공했으나 최근 30일 발행 글이 없으면 status='ok' + perWeek 0 으로 본다
 * (블로그는 정상이지만 발행이 없었던 것 — 확인 불가와 구분).
 */
export function toNaverView(
  blogId: string | null,
  freq: PublishFrequencyResult | null,
): NaverChannelView {
  if (!blogId) {
    return { status: 'not_configured', blogId: null, perWeek: null, postsIn30Days: null };
  }
  if (!freq) {
    return { status: 'unavailable', blogId, perWeek: null, postsIn30Days: null };
  }
  const own = freq.bloggers.find((b) => b.bloggerName === blogId) ?? freq.bloggers[0] ?? null;
  return {
    status: 'ok',
    blogId,
    perWeek: own ? own.perWeek : 0,
    postsIn30Days: own ? own.postsIn30Days : 0,
  };
}

/** 설정된(입력된) 채널 중 하나라도 unavailable 이면 true — 캐시 TTL 단축 판단용. */
export function hasUnavailableConfigured(data: MyChannelsData): boolean {
  return [data.instagram, data.threads, data.youtube, data.naver].some(
    (c) => c.status === 'unavailable',
  );
}
