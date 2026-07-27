import { normalizeClinicName, stripInstitutionSuffix } from './registry.ts';
import { daysSince } from './social-detect.ts';
import type { SocialLink } from './types.ts';

/**
 * 2단계 ⑤-c — 유튜브 채널 탐지 (공식 Data API v3).
 *
 * ★ 인스타와 달리 유튜브는 **이름으로 채널을 찾는 공식 API 가 있다**(search.list,
 *   type=channel). 하루 10,000 쿼터 무료다. 그래서 크롤링 없이 정면으로 찾는다.
 *
 * ★ 키가 없으면 아무 일도 하지 않는다.
 *   `YOUTUBE_API_KEY` 가 없으면 지금처럼 **링크 탐지만** 하고 진단은 그대로 돈다.
 *   키가 없다고 진단이 실패하거나 축이 죽으면 안 된다(그게 '조용히 죽는 것'의 시작이다).
 *   키가 생기는 날 코드 수정 없이 바로 돌아야 하므로 경로는 미리 다 깔아 둔다.
 *
 * ★ 최근 업로드 시점까지 가져온다.
 *   "채널만 있고 3년째 안 올림"과 "주 1회 올림"은 영업에서 완전히 다른 말이다.
 *   채널 → uploads 재생목록 → 최신 1건 순으로, 각 단계는 실패해도 앞 단계 결과를 지킨다.
 *
 * ⚠️ 오탐 방어: **채널명에 병원 이름이 들어 있을 때만** 채택한다.
 *    "성형외과" 같은 일반명사 일치로는 채택하지 않는다 — 검색 결과 상위는 늘
 *    같은 진료과의 남의 채널이다.
 *
 * 쿼터: search.list 100 + channels.list 1 + playlistItems.list 1 = 병원당 최대 102.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

const YOUTUBE_SEARCH = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_CHANNELS = 'https://www.googleapis.com/youtube/v3/channels';
const YOUTUBE_PLAYLIST_ITEMS = 'https://www.googleapis.com/youtube/v3/playlistItems';

/** 호출 1회 타임아웃(ms). */
export const YOUTUBE_TIMEOUT_MS = 5_000;
/** 유튜브 축 전체 예산(ms) — 넘으면 남은 단계를 건너뛴다(진단 응답 시간 방어). */
export const YOUTUBE_BUDGET_MS = 9_000;
/** 채널 후보 수 — 많이 받아도 이름이 안 맞으면 어차피 버린다. */
export const YOUTUBE_SEARCH_RESULTS = 5;
/** 채널명 대조에 필요한 최소 길이 — 짧은 이름은 우연히 겹친다. */
export const MIN_CHANNEL_NAME_MATCH = 3;

export interface YoutubeEnv {
  readonly YOUTUBE_API_KEY?: string;
}

export function isYoutubeConfigured(env: YoutubeEnv | undefined | null): boolean {
  return Boolean(env?.YOUTUBE_API_KEY?.trim());
}

export interface YoutubeChannelCandidate {
  readonly channelId: string;
  readonly title: string;
}

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{20,26}$/;

/** search.list(type=channel) 응답 파싱 (순수 함수). */
export function parseChannelSearch(payload: unknown): readonly YoutubeChannelCandidate[] {
  if (!payload || typeof payload !== 'object') return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: YoutubeChannelCandidate[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = record.id as Record<string, unknown> | undefined;
    const snippet = record.snippet as Record<string, unknown> | undefined;
    const channelId = String(id?.channelId ?? snippet?.channelId ?? '').trim();
    const title = String(snippet?.channelTitle ?? snippet?.title ?? '').trim();
    if (!CHANNEL_ID_RE.test(channelId) || !title) continue;
    out.push({ channelId, title });
  }
  return out;
}

/**
 * 채널명에 병원 이름이 들어 있는 후보만 고른다 (순수 함수).
 * 하나도 없으면 null — 1위를 그냥 쓰지 않는다.
 */
export function pickChannelByName(
  candidates: readonly YoutubeChannelCandidate[],
  clinicName: string,
): YoutubeChannelCandidate | null {
  const full = normalizeClinicName(clinicName);
  const stripped = normalizeClinicName(stripInstitutionSuffix(clinicName));
  if (full.length < MIN_CHANNEL_NAME_MATCH) return null;

  for (const candidate of candidates) {
    const title = normalizeClinicName(candidate.title);
    if (title.includes(full)) return candidate;
    if (stripped.length >= MIN_CHANNEL_NAME_MATCH && title.includes(stripped)) return candidate;
  }
  return null;
}

/** channels.list 응답에서 uploads 재생목록 id (순수 함수). */
export function parseUploadsPlaylistId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const first = items[0] as Record<string, unknown> | undefined;
  const details = first?.contentDetails as Record<string, unknown> | undefined;
  const related = details?.relatedPlaylists as Record<string, unknown> | undefined;
  const uploads = String(related?.uploads ?? '').trim();
  return uploads.length >= 2 ? uploads : null;
}

/** channels.list 응답에서 채널 id·이름 (핸들로 조회했을 때 쓴다). */
export function parseChannelInfo(payload: unknown): YoutubeChannelCandidate | null {
  if (!payload || typeof payload !== 'object') return null;
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const first = items[0] as Record<string, unknown> | undefined;
  const snippet = first?.snippet as Record<string, unknown> | undefined;
  const channelId = String(first?.id ?? '').trim();
  const title = String(snippet?.title ?? '').trim();
  if (!CHANNEL_ID_RE.test(channelId)) return null;
  return { channelId, title };
}

/** playlistItems.list 응답에서 최신 업로드 시각 (순수 함수). */
export function parseLatestUpload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) return null;
  let latest: number | null = null;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const snippet = (item as Record<string, unknown>).snippet as Record<string, unknown> | undefined;
    const details = (item as Record<string, unknown>).contentDetails as Record<string, unknown> | undefined;
    const raw = String(details?.videoPublishedAt ?? snippet?.publishedAt ?? '').trim();
    const at = Date.parse(raw);
    if (!Number.isFinite(at)) continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest === null ? null : new Date(latest).toISOString();
}

export interface YoutubeLookupOptions {
  readonly env?: YoutubeEnv;
  readonly fetchImpl?: typeof fetch;
  readonly now?: number;
  /** 이 시각(ms)을 넘으면 남은 단계를 건너뛴다. */
  readonly deadline?: number;
  readonly timeoutMs?: number;
}

interface CallContext {
  readonly key: string;
  readonly fetchImpl: typeof fetch;
  readonly deadline: number;
  readonly timeoutMs: number;
}

/** JSON GET 1회. 실패·타임아웃·예산 초과는 null (절대 throw 안 함). */
async function getJson(url: string, params: URLSearchParams, ctx: CallContext): Promise<unknown> {
  if (Date.now() >= ctx.deadline) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  try {
    const res = await ctx.fetchImpl(`${url}?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 채널 id → uploads 재생목록 → 최신 업로드 시각. 못 구하면 null. */
async function fetchLastUpload(channelId: string, ctx: CallContext): Promise<string | null> {
  const channelPayload = await getJson(
    YOUTUBE_CHANNELS,
    new URLSearchParams({ part: 'contentDetails', id: channelId, key: ctx.key }),
    ctx,
  );
  const uploads = parseUploadsPlaylistId(channelPayload);
  if (!uploads) return null;
  const itemsPayload = await getJson(
    YOUTUBE_PLAYLIST_ITEMS,
    new URLSearchParams({ part: 'contentDetails', playlistId: uploads, maxResults: '1', key: ctx.key }),
    ctx,
  );
  return parseLatestUpload(itemsPayload);
}

function channelLink(channelId: string, lastUploadAt: string | null, now: number): SocialLink {
  return {
    platform: 'youtube',
    kind: 'channel',
    handle: channelId,
    url: `https://www.youtube.com/channel/${channelId}`,
    source: 'youtube_api',
    lastUploadAt,
    daysSinceUpload: daysSince(lastUploadAt, now),
  };
}

function contextOf(options: YoutubeLookupOptions): CallContext | null {
  const env = options.env ?? (process.env as YoutubeEnv);
  const key = env?.YOUTUBE_API_KEY?.trim();
  if (!key) return null;
  return {
    key,
    fetchImpl: options.fetchImpl ?? fetch,
    deadline: options.deadline ?? Date.now() + YOUTUBE_BUDGET_MS,
    timeoutMs: options.timeoutMs ?? YOUTUBE_TIMEOUT_MS,
  };
}

export interface YoutubeLookupResult {
  /** 실제로 API 를 불렀는가 (키가 없으면 false — 화면 문구의 근거). */
  readonly called: boolean;
  readonly link: SocialLink | null;
}

const NOT_CALLED: YoutubeLookupResult = { called: false, link: null };

/**
 * 병원 이름으로 유튜브 채널을 찾는다. 키가 없으면 아무것도 하지 않는다.
 * 채널명에 병원 이름이 없으면 채택하지 않는다(확인되지 않음으로 남긴다).
 */
export async function findYoutubeChannel(
  clinicName: string,
  options: YoutubeLookupOptions = {},
): Promise<YoutubeLookupResult> {
  const ctx = contextOf(options);
  if (!ctx) return NOT_CALLED;
  const name = (clinicName ?? '').trim();
  if (name.length < 2) return NOT_CALLED;

  const payload = await getJson(
    YOUTUBE_SEARCH,
    new URLSearchParams({
      part: 'snippet',
      type: 'channel',
      q: name,
      maxResults: String(YOUTUBE_SEARCH_RESULTS),
      key: ctx.key,
    }),
    ctx,
  );
  const picked = pickChannelByName(parseChannelSearch(payload), name);
  if (!picked) return { called: true, link: null };

  const lastUploadAt = await fetchLastUpload(picked.channelId, ctx);
  return { called: true, link: channelLink(picked.channelId, lastUploadAt, options.now ?? Date.now()) };
}

/**
 * 이미 찾은 채널의 **최근 업로드 시점만** 보강한다 (검색 쿼터 100 을 안 쓴다).
 *
 * 홈페이지 링크로 채널을 이미 알고 있을 때 쓴다 — 채널 존재는 이미 확실하므로
 * 이름 대조를 다시 하지 않는다. 못 구하면 원래 링크를 그대로 돌려준다.
 */
export async function enrichYoutubeRecency(
  link: SocialLink,
  options: YoutubeLookupOptions = {},
): Promise<YoutubeLookupResult> {
  const ctx = contextOf(options);
  if (!ctx) return NOT_CALLED;
  if (link.platform !== 'youtube' || link.kind !== 'channel') return NOT_CALLED;

  const handle = (link.handle ?? '').trim();
  const params = CHANNEL_ID_RE.test(handle)
    ? new URLSearchParams({ part: 'contentDetails', id: handle, key: ctx.key })
    : handle.startsWith('@')
      ? new URLSearchParams({ part: 'contentDetails', forHandle: handle, key: ctx.key })
      : null;
  // /c/이름 · /user/이름 형식은 id 로 바꿀 싼 경로가 없다 — 그냥 두고 넘어간다.
  if (!params) return NOT_CALLED;

  const channelPayload = await getJson(YOUTUBE_CHANNELS, params, ctx);
  const uploads = parseUploadsPlaylistId(channelPayload);
  if (!uploads) return { called: true, link: null };

  const itemsPayload = await getJson(
    YOUTUBE_PLAYLIST_ITEMS,
    new URLSearchParams({ part: 'contentDetails', playlistId: uploads, maxResults: '1', key: ctx.key }),
    ctx,
  );
  const lastUploadAt = parseLatestUpload(itemsPayload);
  if (!lastUploadAt) return { called: true, link: null };

  return {
    called: true,
    link: {
      ...link,
      lastUploadAt,
      daysSinceUpload: daysSince(lastUploadAt, options.now ?? Date.now()),
    },
  };
}
