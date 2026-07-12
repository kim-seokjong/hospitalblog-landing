import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toSocialView,
  toYoutubeView,
  toNaverView,
  hasUnavailableConfigured,
  type MyChannelsData,
} from '../scoreboard/my-channels.ts';
import type { SocialMetric } from '../scoreboard/social.ts';
import type { YoutubeChannelStats } from '../scoreboard/youtube.ts';
import type { PublishFrequencyResult } from '../scoreboard/publish-frequency.ts';

// ---------------------------------------------------------------------------
// toSocialView — 미입력 / 조회실패 / 성공
// ---------------------------------------------------------------------------

test('toSocialView: 핸들 미입력 → not_configured', () => {
  const v = toSocialView(null, null);
  assert.equal(v.status, 'not_configured');
  assert.equal(v.handle, null);
  assert.equal(v.followers, null);
  assert.equal(v.posts, null);
});

test('toSocialView: 핸들 있으나 metric 없음(조회 실패) → unavailable', () => {
  const v = toSocialView('myclinic', null);
  assert.equal(v.status, 'unavailable');
  assert.equal(v.handle, 'myclinic');
  assert.equal(v.followers, null);
});

test('toSocialView: metric.status unavailable → unavailable (수치 숨김)', () => {
  const metric: SocialMetric = {
    platform: 'instagram',
    handle: 'myclinic',
    status: 'unavailable',
    followers: 100,
    posts: 5,
  };
  const v = toSocialView('myclinic', metric);
  assert.equal(v.status, 'unavailable');
  assert.equal(v.followers, null);
  assert.equal(v.posts, null);
});

test('toSocialView: metric.status ok → ok + 수치 전달', () => {
  const metric: SocialMetric = {
    platform: 'instagram',
    handle: 'myclinic',
    status: 'ok',
    followers: 1234,
    posts: 56,
  };
  const v = toSocialView('myclinic', metric);
  assert.equal(v.status, 'ok');
  assert.equal(v.followers, 1234);
  assert.equal(v.posts, 56);
});

// ---------------------------------------------------------------------------
// toYoutubeView
// ---------------------------------------------------------------------------

const YT_ID = 'UCabcdefghijklmnopqrstuv';

test('toYoutubeView: 채널ID 미입력 → not_configured', () => {
  const v = toYoutubeView(null, null);
  assert.equal(v.status, 'not_configured');
  assert.equal(v.channelId, null);
  assert.equal(v.subscriberCount, null);
});

test('toYoutubeView: 채널ID 있으나 stats 없음(키 없음/실패) → unavailable', () => {
  const v = toYoutubeView(YT_ID, null);
  assert.equal(v.status, 'unavailable');
  assert.equal(v.channelId, YT_ID);
  assert.equal(v.viewCount, null);
});

test('toYoutubeView: stats 있음 → ok + 지표 매핑 (구독자 숨김은 null 유지)', () => {
  const stats: YoutubeChannelStats = {
    channelId: YT_ID,
    title: '우리병원 채널',
    thumbnailUrl: null,
    subscriberCount: null, // 숨김
    videoCount: 42,
    viewCount: 100000,
    uploadsIn30Days: 3,
    uploadsPerWeek: 0.7,
  };
  const v = toYoutubeView(YT_ID, stats);
  assert.equal(v.status, 'ok');
  assert.equal(v.title, '우리병원 채널');
  assert.equal(v.subscriberCount, null);
  assert.equal(v.videoCount, 42);
  assert.equal(v.viewCount, 100000);
  assert.equal(v.uploadsPerWeek, 0.7);
});

// ---------------------------------------------------------------------------
// toNaverView
// ---------------------------------------------------------------------------

test('toNaverView: 블로그 미입력 → not_configured', () => {
  const v = toNaverView(null, null);
  assert.equal(v.status, 'not_configured');
  assert.equal(v.perWeek, null);
});

test('toNaverView: 블로그 있으나 조회 실패(null) → unavailable', () => {
  const v = toNaverView('myclinic', null);
  assert.equal(v.status, 'unavailable');
  assert.equal(v.blogId, 'myclinic');
  assert.equal(v.perWeek, null);
});

test('toNaverView: 조회 성공·본인 발행 → ok + 본인 blogId 항목 사용', () => {
  const freq: PublishFrequencyResult = {
    windowDays: 30,
    sampleSize: 3,
    bloggers: [{ bloggerName: 'myclinic', postsIn30Days: 3, perWeek: 0.7 }],
  };
  const v = toNaverView('myclinic', freq);
  assert.equal(v.status, 'ok');
  assert.equal(v.perWeek, 0.7);
  assert.equal(v.postsIn30Days, 3);
});

test('toNaverView: 조회 성공했지만 최근 30일 발행 없음 → ok + 0 (확인 불가와 구분)', () => {
  const freq: PublishFrequencyResult = { windowDays: 30, sampleSize: 0, bloggers: [] };
  const v = toNaverView('myclinic', freq);
  assert.equal(v.status, 'ok');
  assert.equal(v.perWeek, 0);
  assert.equal(v.postsIn30Days, 0);
});

// ---------------------------------------------------------------------------
// graceful degrade — 한 채널이 죽어도 나머지는 독립 유지
// ---------------------------------------------------------------------------

test('채널 독립 실패: 인스타 성공 + 유튜브 실패가 서로 영향 없음', () => {
  const data: MyChannelsData = {
    instagram: toSocialView('myclinic', {
      platform: 'instagram',
      handle: 'myclinic',
      status: 'ok',
      followers: 10,
      posts: 2,
    }),
    threads: toSocialView(null, null),
    youtube: toYoutubeView(YT_ID, null),
    naver: toNaverView(null, null),
  };

  assert.equal(data.instagram.status, 'ok');
  assert.equal(data.instagram.followers, 10);
  assert.equal(data.threads.status, 'not_configured');
  assert.equal(data.youtube.status, 'unavailable');
  assert.equal(data.naver.status, 'not_configured');
  assert.equal(hasUnavailableConfigured(data), true);
});

test('hasUnavailableConfigured: 모두 ok/not_configured면 false', () => {
  const data: MyChannelsData = {
    instagram: toSocialView(null, null),
    threads: toSocialView(null, null),
    youtube: toYoutubeView(null, null),
    naver: toNaverView('myclinic', { windowDays: 30, sampleSize: 0, bloggers: [] }),
  };
  assert.equal(hasUnavailableConfigured(data), false);
});
