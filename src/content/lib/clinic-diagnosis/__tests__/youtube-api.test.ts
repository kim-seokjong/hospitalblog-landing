import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichYoutubeRecency,
  findYoutubeChannel,
  isYoutubeConfigured,
  parseChannelSearch,
  parseLatestUpload,
  parseUploadsPlaylistId,
  pickChannelByName,
} from '../youtube-api.ts';
import type { SocialLink } from '../types.ts';

/**
 * 유튜브 공식 Data API v3 경로 검증.
 *
 * ★ 지금 이 키는 아직 없다. **키가 없을 때 아무 일도 일어나지 않는 것**이 이 파일에서
 *   가장 중요한 테스트다 — 키가 없다고 진단이 실패하거나 축이 죽으면 안 된다.
 * ★ 그리고 키가 생기는 날 코드 수정 없이 바로 돌아야 하므로, 응답 파싱·오탐 방어는
 *   지금 가짜 응답으로 전부 검증해 둔다.
 */

const KEY_ENV = { YOUTUBE_API_KEY: 'test-key' };
const NOW = Date.parse('2026-07-27T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const CHANNEL_ID = 'UCabcdefghijklmnopqrstuv';

function jsonFetch(routes: Readonly<Record<string, unknown>>, seen: string[]): typeof fetch {
  return (async (url: string) => {
    seen.push(String(url));
    const hit = Object.keys(routes).find((key) => String(url).includes(key));
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(routes[hit]), { status: 200 });
  }) as unknown as typeof fetch;
}

/* ── 키 없음 ───────────────────────────────────────────── */

test('★키가 없으면 아무것도 하지 않는다 — 네트워크도 안 탄다', async () => {
  assert.equal(isYoutubeConfigured({}), false);
  assert.equal(isYoutubeConfigured(undefined), false);
  assert.equal(isYoutubeConfigured({ YOUTUBE_API_KEY: '   ' }), false);
  assert.equal(isYoutubeConfigured(KEY_ENV), true);

  const boom = (async () => {
    throw new Error('불러선 안 된다');
  }) as unknown as typeof fetch;
  assert.deepEqual(await findYoutubeChannel('엣지성형외과의원', { env: {}, fetchImpl: boom }), {
    called: false,
    link: null,
  });
  const link: SocialLink = {
    platform: 'youtube',
    kind: 'channel',
    handle: CHANNEL_ID,
    url: `https://www.youtube.com/channel/${CHANNEL_ID}`,
  };
  assert.deepEqual(await enrichYoutubeRecency(link, { env: {}, fetchImpl: boom }), {
    called: false,
    link: null,
  });
});

/* ── 파싱 ──────────────────────────────────────────────── */

test('search.list 응답에서 채널 후보를 뽑는다 (망가진 항목은 버린다)', () => {
  const candidates = parseChannelSearch({
    items: [
      { id: { channelId: CHANNEL_ID }, snippet: { channelTitle: '대구엣지성형외과' } },
      { id: { channelId: '짧음' }, snippet: { channelTitle: '이상한 채널' } },
      { snippet: { channelTitle: 'id 없음' } },
      null,
    ],
  });
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], { channelId: CHANNEL_ID, title: '대구엣지성형외과' });
  assert.deepEqual(parseChannelSearch(null), []);
  assert.deepEqual(parseChannelSearch({ items: {} }), []);
});

test('uploads 재생목록 id 와 최신 업로드 시각을 읽는다', () => {
  assert.equal(
    parseUploadsPlaylistId({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUabc' } } }] }),
    'UUabc',
  );
  assert.equal(parseUploadsPlaylistId({ items: [] }), null);
  assert.equal(parseUploadsPlaylistId(null), null);

  assert.equal(
    parseLatestUpload({ items: [{ contentDetails: { videoPublishedAt: '2026-07-01T00:00:00Z' } }] }),
    '2026-07-01T00:00:00.000Z',
  );
  // snippet.publishedAt 만 오는 형태도 읽는다
  assert.equal(
    parseLatestUpload({ items: [{ snippet: { publishedAt: '2026-06-01T00:00:00Z' } }] }),
    '2026-06-01T00:00:00.000Z',
  );
  assert.equal(parseLatestUpload({ items: [{ snippet: { publishedAt: '없는날짜' } }] }), null);
  assert.equal(parseLatestUpload({ items: [] }), null);
});

/* ── ★ 오탐 방어 ───────────────────────────────────────── */

test('★채널명에 병원 이름이 없으면 채택하지 않는다 — 1위여도 버린다', () => {
  const candidates = [
    { channelId: CHANNEL_ID, title: '앤드성형외과의원 [ 눈서코TV ]' },
    { channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz', title: '성형잘한대희' },
  ];
  assert.equal(pickChannelByName(candidates, '엣지성형외과의원'), null);
});

test('채널명에 병원 이름이 있으면 채택한다 (접미사 제거형도 인정)', () => {
  const picked = pickChannelByName(
    [
      { channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz', title: '성형잘한대희' },
      { channelId: CHANNEL_ID, title: '대구 엣지성형외과 공식채널' },
    ],
    '엣지성형외과의원',
  );
  assert.equal(picked?.channelId, CHANNEL_ID);
});

/* ── 채널 찾기 ─────────────────────────────────────────── */

test('채널을 찾으면 최근 업로드 시점까지 함께 돌려준다', async () => {
  const seen: string[] = [];
  const fetchImpl = jsonFetch(
    {
      '/search': { items: [{ id: { channelId: CHANNEL_ID }, snippet: { channelTitle: '엣지성형외과 TV' } }] },
      '/channels': { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUabc' } } }] },
      '/playlistItems': { items: [{ contentDetails: { videoPublishedAt: new Date(NOW - 12 * DAY).toISOString() } }] },
    },
    seen,
  );

  const result = await findYoutubeChannel('엣지성형외과의원', { env: KEY_ENV, fetchImpl, now: NOW });
  assert.equal(result.called, true);
  assert.equal(result.link?.handle, CHANNEL_ID);
  assert.equal(result.link?.source, 'youtube_api');
  assert.equal(result.link?.daysSinceUpload, 12);
  assert.equal(seen.length, 3, 'search 1 + channels 1 + playlistItems 1');
});

test('업로드 시점을 못 구해도 채널은 살린다 (추정으로 메우지 않는다)', async () => {
  const seen: string[] = [];
  const fetchImpl = jsonFetch(
    { '/search': { items: [{ id: { channelId: CHANNEL_ID }, snippet: { channelTitle: '엣지성형외과 TV' } }] } },
    seen,
  );
  const result = await findYoutubeChannel('엣지성형외과의원', { env: KEY_ENV, fetchImpl, now: NOW });
  assert.equal(result.link?.handle, CHANNEL_ID);
  assert.equal(result.link?.lastUploadAt, null);
  assert.equal(result.link?.daysSinceUpload, null);
});

test('★API 가 실패해도 throw 하지 않는다', async () => {
  const boom = (async () => {
    throw new Error('구글 폭발');
  }) as unknown as typeof fetch;
  const result = await findYoutubeChannel('엣지성형외과의원', { env: KEY_ENV, fetchImpl: boom, now: NOW });
  assert.deepEqual(result, { called: true, link: null });
});

test('예산이 이미 지났으면 호출하지 않는다', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  await findYoutubeChannel('엣지성형외과의원', {
    env: KEY_ENV,
    fetchImpl,
    now: NOW,
    deadline: Date.now() - 1,
  });
  assert.equal(calls, 0);
});

/* ── 이미 아는 채널의 최근 업로드 보강 ─────────────────── */

test('이미 찾은 채널은 검색 쿼터를 쓰지 않고 최근 업로드만 채운다', async () => {
  const seen: string[] = [];
  const fetchImpl = jsonFetch(
    {
      '/channels': { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUabc' } } }] },
      '/playlistItems': { items: [{ contentDetails: { videoPublishedAt: new Date(NOW - 400 * DAY).toISOString() } }] },
    },
    seen,
  );
  const link: SocialLink = {
    platform: 'youtube',
    kind: 'channel',
    handle: CHANNEL_ID,
    url: `https://www.youtube.com/channel/${CHANNEL_ID}`,
    source: 'site',
  };
  const result = await enrichYoutubeRecency(link, { env: KEY_ENV, fetchImpl, now: NOW });
  assert.equal(result.link?.daysSinceUpload, 400);
  assert.equal(result.link?.source, 'site', '어디서 찾았는지는 그대로 남는다');
  assert.ok(seen.every((url) => !url.includes('/search')), '검색(쿼터 100)은 안 쓴다');
  assert.equal(seen.length, 2);
});

test('@핸들 채널은 forHandle 로 조회한다', async () => {
  const seen: string[] = [];
  const fetchImpl = jsonFetch({ '/channels': { items: [] } }, seen);
  const link: SocialLink = {
    platform: 'youtube',
    kind: 'channel',
    handle: '@edge0501',
    url: 'https://www.youtube.com/@edge0501',
    source: 'site',
  };
  const result = await enrichYoutubeRecency(link, { env: KEY_ENV, fetchImpl, now: NOW });
  assert.equal(result.called, true);
  assert.equal(result.link, null);
  assert.ok(seen[0].includes('forHandle=%40edge0501'));
});

test('/c/이름 형식은 조회하지 않고 넘어간다 (싼 경로가 없다)', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  const link: SocialLink = {
    platform: 'youtube',
    kind: 'channel',
    handle: '브이성형외과',
    url: 'https://www.youtube.com/c/브이성형외과',
    source: 'site',
  };
  const result = await enrichYoutubeRecency(link, { env: KEY_ENV, fetchImpl, now: NOW });
  assert.deepEqual(result, { called: false, link: null });
  assert.equal(calls, 0);
});
