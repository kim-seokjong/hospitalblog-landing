import type { SocialAxis, SocialLink, SocialPlatform, SocialPresence, SocialSource } from './types.ts';

/**
 * 2단계 ⑤ — 인스타그램 · 유튜브 탐지 (링크 판정·축 조립, 순수 함수).
 *
 * ★ 왜 필요한가.
 *   성형외과·피부과의 주 채널은 블로그가 아니라 인스타다. 그 사실을 모른 채
 *   "블로그가 멈췄습니다"만 말하면 진단이 헛다리를 짚는다 — 원장은 인스타를
 *   매일 올리고 있는데 "아무것도 안 하고 계시네요"로 읽힌다. 반대로 인스타를
 *   하고 있다는 걸 알면 문장이 정확해진다:
 *     "인스타는 운영하시는데 블로그는 1년째 비어 있습니다.
 *      검색으로 찾는 환자는 못 만나고 계십니다."
 *
 * ★ 링크만 보면 놓친다 (2026-07-27 대표 지적).
 *   "홈페이지에 인스타 링크를 안 걸어 둔 병원"은 인스타를 아무리 열심히 해도
 *   '확인되지 않음'으로 나왔다. 그래서 못 찾았을 때만 도는 우회로를 붙였다:
 *     · 인스타 → 네이버 웹문서 검색 1회 (social-search.ts)
 *     · 유튜브 → 공식 Data API v3, 키가 있을 때만 (youtube-api.ts)
 *   이 파일은 그렇게 모인 링크들의 **판정·조립**만 맡는다(요청 없음).
 *
 * ★ 왜 인스타 공식 API 가 아닌가.
 *   인스타그램에는 **이름으로 계정을 찾는 공식 API 가 없다**(Graph API 는 계정
 *   아이디를 이미 알아야 조회된다). 크롤링은 금지다. 그래서 네이버 검색이 유일한
 *   합법 우회로다.
 *
 * ⚠️ 한계를 문구로 지킨다 — 링크가 없다고 "인스타를 안 한다"고 단정하지 않는다.
 *    우리가 말할 수 있는 한계는 "확인되지 않았습니다"까지다.
 *    그래서 presence 는 found / not_found / unknown 3값이고, not_found 의 화면
 *    문구는 언제나 '확인되지 않음'이지 '없음'이 아니다.
 *
 * ⚠️ 프로필(채널) 링크와 게시물(콘텐츠) 링크를 구분한다.
 *    유튜브 영상 하나가 임베드돼 있다고 그 병원 채널이 있는 것은 아니다
 *    (남의 영상일 수 있다). presence='found' 는 **채널·프로필 링크가 있을 때만**.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

/** 화면·메일에서 쓰는 판정 문구 — 여기 한 곳에서만 정한다. */
export const SOCIAL_PRESENCE_LABEL: Readonly<Record<SocialPlatform, Readonly<Record<SocialPresence, string>>>> = {
  instagram: {
    found: '인스타그램 운영 중',
    not_found: '확인되지 않음',
    unknown: '확인되지 않음',
  },
  youtube: {
    found: '유튜브 채널 있음',
    not_found: '확인되지 않음',
    unknown: '확인되지 않음',
  },
};

export const SOCIAL_PLATFORM_LABEL: Readonly<Record<SocialPlatform, string>> = {
  instagram: '인스타그램',
  youtube: '유튜브',
};

/** 근거 출처 표기 — 오탐이 나왔을 때 어디서 온 계정인지 화면에서 바로 읽힌다. */
export const SOCIAL_SOURCE_LABEL: Readonly<Record<SocialSource, string>> = {
  site: '홈페이지 링크',
  blog: '블로그 링크',
  naver_search: '네이버 검색',
  youtube_api: '유튜브 검색',
};

/** 한 축에서 담아 두는 링크 상한 — 화면·저장 용량 방어. */
export const MAX_SOCIAL_LINKS = 8;

/** 스캔할 텍스트 상한(자). 본문 여러 편을 이어붙여도 여기서 끊는다. */
export const MAX_SCAN_CHARS = 600_000;

/**
 * 인스타그램에서 **계정 이름이 아닌** 첫 경로들.
 * 이걸 계정으로 읽으면 "instagram.com/p/AbCd" 를 @p 계정으로 보고한다.
 */
const INSTAGRAM_RESERVED: ReadonlySet<string> = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'story', 'explore', 'accounts', 'about',
  'developer', 'developers', 'legal', 'directory', 'direct', 'embed', 'share',
  'challenge', 'oauth', 'graphql', 'api', 'web', 'static', 'emails', 'session',
  'ajax', 'privacy', 'terms', 'help', 'press', 'blog', 'hashtag', 'locations',
  'create', 'download', 'lite', 'igtv', 'your_activity',
]);

/** 유튜브에서 채널이 아니라 '콘텐츠'를 가리키는 첫 경로. */
const YOUTUBE_CONTENT_PATHS: ReadonlySet<string> = new Set([
  'watch', 'embed', 'shorts', 'playlist', 'results', 'v', 'live', 'clip',
]);

/** 계정 이름으로 허용하는 문자 — 이 밖의 문자가 섞이면 링크로 보지 않는다. */
const INSTAGRAM_HANDLE_RE = /^[A-Za-z0-9._]{2,40}$/;
const YOUTUBE_HANDLE_RE = /^[A-Za-z0-9._\-가-힣]{2,40}$/;
const YOUTUBE_CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{20,26}$/;

/**
 * HTML·본문 텍스트에서 소셜 URL 후보를 뽑는 정규식.
 * href 안이든 그냥 본문에 적힌 주소든 똑같이 잡는다(네이버 블로그 본문은 링크가
 * 텍스트로만 남는 경우가 흔하다).
 */
const SOCIAL_URL_RE =
  /(?:https?:)?\/\/(?:www\.|m\.)?(instagram\.com|instagr\.am|youtube\.com|youtube-nocookie\.com|youtu\.be)\/([^\s"'<>)\]}\\]{0,160})/gi;

/** HTML 엔티티로 인코딩된 URL(&amp;, &#47;)을 최소한만 되돌린다. */
function decodeLoose(value: string): string {
  return (value ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&#0*47;/g, '/')
    .replace(/&#x0*2f;/gi, '/');
}

/** 경로 첫 조각을 소문자로. 쿼리·해시·인코딩은 떼어낸다. */
function firstSegment(path: string): string {
  // ?·#·& 뒤는 전부 버린다. 계정 이름·채널 id 에는 이 문자들이 절대 오지 않으므로
  // 안전하고, 엔티티(&amp;)가 남아 있어도 여기서 함께 잘린다.
  const clean = path.split(/[?#&]/, 1)[0] ?? '';
  const seg = clean.split('/').filter((s) => s.length > 0)[0] ?? '';
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

function secondSegment(path: string): string {
  // ?·#·& 뒤는 전부 버린다. 계정 이름·채널 id 에는 이 문자들이 절대 오지 않으므로
  // 안전하고, 엔티티(&amp;)가 남아 있어도 여기서 함께 잘린다.
  const clean = path.split(/[?#&]/, 1)[0] ?? '';
  const parts = clean.split('/').filter((s) => s.length > 0);
  const seg = parts[1] ?? '';
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** 링크에 출처를 붙인다 (불변 — 새 객체를 만든다). source 가 없으면 그대로. */
function withSource(link: SocialLink, source?: SocialSource): SocialLink {
  return source ? { ...link, source } : link;
}

/** 링크 1건 판정. 계정으로 볼 수 없으면 null(추정으로 메우지 않는다). */
export function classifySocialUrl(host: string, path: string, source?: SocialSource): SocialLink | null {
  const domain = host.toLowerCase();
  const raw = decodeLoose(path);

  if (domain === 'instagram.com' || domain === 'instagr.am') {
    const first = firstSegment(raw);
    if (!first) return null;
    if (INSTAGRAM_RESERVED.has(first.toLowerCase())) {
      // 게시물·릴스 링크 — 병원 계정일 가능성이 높지만 계정명을 알 수 없다.
      return withSource({
        platform: 'instagram',
        kind: 'content',
        handle: '',
        url: `https://www.instagram.com/${first.toLowerCase()}/`,
      }, source);
    }
    if (!INSTAGRAM_HANDLE_RE.test(first)) return null;
    const handle = first.toLowerCase();
    return withSource({
      platform: 'instagram',
      kind: 'channel',
      handle,
      url: `https://www.instagram.com/${handle}/`,
    }, source);
  }

  if (domain === 'youtu.be') {
    // 항상 영상 단축 주소다 — 채널이 아니다.
    const first = firstSegment(raw);
    if (!first) return null;
    return withSource({ platform: 'youtube', kind: 'content', handle: '', url: 'https://youtu.be/' }, source);
  }

  // youtube.com / youtube-nocookie.com
  const first = firstSegment(raw);
  if (!first) return null;
  const lower = first.toLowerCase();

  if (lower.startsWith('@')) {
    const handle = first.slice(1);
    if (!YOUTUBE_HANDLE_RE.test(handle)) return null;
    return withSource({
      platform: 'youtube',
      kind: 'channel',
      handle: `@${handle}`,
      url: `https://www.youtube.com/@${handle}`,
    }, source);
  }
  if (lower === 'channel') {
    const id = secondSegment(raw);
    if (!YOUTUBE_CHANNEL_ID_RE.test(id)) return null;
    return withSource({
      platform: 'youtube',
      kind: 'channel',
      handle: id,
      url: `https://www.youtube.com/channel/${id}`,
    }, source);
  }
  if (lower === 'c' || lower === 'user') {
    const name = secondSegment(raw);
    if (!YOUTUBE_HANDLE_RE.test(name)) return null;
    return withSource({
      platform: 'youtube',
      kind: 'channel',
      handle: name,
      url: `https://www.youtube.com/${lower}/${name}`,
    }, source);
  }
  if (YOUTUBE_CONTENT_PATHS.has(lower)) {
    return withSource({ platform: 'youtube', kind: 'content', handle: '', url: 'https://www.youtube.com/' }, source);
  }
  return null;
}

/**
 * HTML·본문 텍스트에서 인스타·유튜브 링크를 찾는다 (순수 함수, 요청 없음).
 * 같은 계정이 여러 번 나와도 1건으로 합치고, 채널 링크를 앞에 둔다.
 *
 * `source` 를 주면 찾은 링크마다 근거 출처를 새겨 둔다 — 오탐이 나왔을 때
 * "어디서 온 계정인지"를 리포트만 보고 되짚을 수 있어야 한다.
 */
export function extractSocialLinks(text: string, source?: SocialSource): readonly SocialLink[] {
  const scanned = (text ?? '').slice(0, MAX_SCAN_CHARS);
  if (scanned.length === 0) return [];

  const byKey = new Map<string, SocialLink>();
  SOCIAL_URL_RE.lastIndex = 0;
  for (;;) {
    const match = SOCIAL_URL_RE.exec(scanned);
    if (match === null) break;
    const link = classifySocialUrl(match[1], match[2] ?? '', source);
    if (!link) continue;
    const key = `${link.platform}|${link.kind}|${link.handle}`;
    if (!byKey.has(key)) byKey.set(key, link);
    if (byKey.size >= MAX_SOCIAL_LINKS * 4) break; // 폭주 방어 (합치기 전 상한)
  }

  return sortSocialLinks([...byKey.values()]);
}

function sortSocialLinks(links: readonly SocialLink[]): readonly SocialLink[] {
  return [...links]
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'channel' ? -1 : 1;
      if (a.platform !== b.platform) return a.platform === 'instagram' ? -1 : 1;
      return a.handle.localeCompare(b.handle);
    })
    .slice(0, MAX_SOCIAL_LINKS);
}

/**
 * 여러 출처에서 모은 링크를 합친다 (중복 제거, 채널 우선).
 *
 * 같은 계정이 여러 출처에서 나오면 **먼저 온 쪽의 출처를 남긴다** — 호출부가
 * 홈페이지·블로그를 앞에 두므로 "링크로 직접 확인한 것"이 검색 결과보다 우선한다.
 * 다만 뒤쪽에만 있는 정보(유튜브 최근 업로드 시점)는 앞쪽 링크에 채워 넣는다 —
 * 같은 채널인데 근거만 다른 것이므로 버리면 정보가 사라진다.
 */
export function mergeSocialLinks(...groups: readonly (readonly SocialLink[])[]): readonly SocialLink[] {
  const byKey = new Map<string, SocialLink>();
  for (const group of groups) {
    for (const link of group ?? []) {
      const key = `${link.platform}|${link.kind}|${link.handle}`;
      const kept = byKey.get(key);
      if (!kept) {
        byKey.set(key, link);
        continue;
      }
      if (kept.lastUploadAt == null && link.lastUploadAt != null) {
        byKey.set(key, {
          ...kept,
          lastUploadAt: link.lastUploadAt,
          daysSinceUpload: link.daysSinceUpload ?? null,
        });
      }
    }
  }
  return sortSocialLinks([...byKey.values()]);
}

export const EMPTY_SOCIAL_AXIS: SocialAxis = {
  checked: false,
  instagram: 'unknown',
  youtube: 'unknown',
  links: [],
  scannedSite: false,
  scannedBlog: false,
  searchedNaver: false,
  searchedYoutube: false,
};

export interface BuildSocialAxisInput {
  /** 홈페이지 HTML 을 실제로 받아 봤는가 (auditSite 가 본문을 확보했는가). */
  readonly scannedSite: boolean;
  readonly siteLinks: readonly SocialLink[];
  /** 블로그 글 본문·요약을 실제로 받아 봤는가. */
  readonly scannedBlog: boolean;
  readonly blogLinks: readonly SocialLink[];
  /** 네이버 검색·유튜브 API 로 찾은 계정. 링크로 못 찾았을 때만 채워진다. */
  readonly searchLinks?: readonly SocialLink[];
  /** 네이버 웹문서 검색을 실제로 돌렸는가. */
  readonly searchedNaver?: boolean;
  /** 유튜브 공식 API 를 실제로 호출했는가. */
  readonly searchedYoutube?: boolean;
}

/**
 * 소셜 축 조립.
 *
 * · 아무것도 못 본 상태(자료도 없고 검색도 못 돌림) → checked:false, 전부 unknown
 * · 한 곳이라도 봤는데 채널 링크가 없다 → not_found ("확인되지 않았다" — '없다'가 아니다)
 * · 채널 링크가 있다 → found
 *
 * 링크 우선순위: 홈페이지 → 블로그 → 검색. 같은 계정이면 앞선 출처를 근거로 남긴다.
 */
export function buildSocialAxis(input: BuildSocialAxisInput): SocialAxis {
  const searchedNaver = Boolean(input.searchedNaver);
  const searchedYoutube = Boolean(input.searchedYoutube);
  const scanned =
    Boolean(input.scannedSite) || Boolean(input.scannedBlog) || searchedNaver || searchedYoutube;
  if (!scanned) return EMPTY_SOCIAL_AXIS;

  const links = mergeSocialLinks(input.siteLinks ?? [], input.blogLinks ?? [], input.searchLinks ?? []);
  const presenceOf = (platform: SocialPlatform): SocialPresence =>
    links.some((l) => l.platform === platform && l.kind === 'channel') ? 'found' : 'not_found';

  return {
    checked: true,
    instagram: presenceOf('instagram'),
    youtube: presenceOf('youtube'),
    links,
    scannedSite: Boolean(input.scannedSite),
    scannedBlog: Boolean(input.scannedBlog),
    searchedNaver,
    searchedYoutube,
  };
}

/** 이 축에서 실제로 확인된 채널 링크만. */
export function channelLinks(social: SocialAxis | null | undefined): readonly SocialLink[] {
  return (social?.links ?? []).filter((l) => l.kind === 'channel');
}

/** 게시물·영상 링크만 — "채널은 못 찾았지만 흔적은 있다"를 말할 때 쓴다. */
export function contentLinks(social: SocialAxis | null | undefined): readonly SocialLink[] {
  return (social?.links ?? []).filter((l) => l.kind === 'content');
}

/** 한국어 '와/과' — 앞 글자에 받침이 있으면 '과'. (홈페이지와 / 블로그 글과) */
function waGwa(word: string): string {
  const last = (word ?? '').trim().slice(-1);
  const code = last.charCodeAt(0);
  if (!Number.isFinite(code) || code < 0xac00 || code > 0xd7a3) return '와';
  return (code - 0xac00) % 28 === 0 ? '와' : '과';
}

/** ['A','B','C'] → 'A, B와 C' (마지막 연결만 조사로). */
function joinKorean(parts: readonly string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const head = parts.slice(0, -1);
  const last = parts[parts.length - 1];
  const beforeLast = head[head.length - 1];
  return `${head.join(', ')}${waGwa(beforeLast)} ${last}`;
}

/**
 * 어디를 봤는지 한 줄로 — 판정 문구에 **반드시** 함께 나간다.
 * "확인되지 않았다"가 "안 한다"로 읽히지 않게 하는 유일한 장치다.
 */
export function scanScopeText(social: SocialAxis | null | undefined): string {
  const parts: string[] = [];
  if (social?.scannedSite) parts.push('홈페이지');
  if (social?.scannedBlog) parts.push('블로그 글');
  if (social?.searchedNaver) parts.push('네이버 검색');
  if (social?.searchedYoutube) parts.push('유튜브 검색');
  return joinKorean(parts);
}

/** 이 링크들을 어디서 찾았는지 — 출처 표기(중복 제거, 홈페이지→블로그→검색 순). */
export function evidenceText(links: readonly SocialLink[]): string {
  const order: readonly SocialSource[] = ['site', 'blog', 'naver_search', 'youtube_api'];
  const used = order.filter((src) => links.some((l) => l.source === src));
  return joinKorean(used.map((src) => SOCIAL_SOURCE_LABEL[src]));
}

/**
 * 유튜브 판정 문구 — 최근 업로드 시점까지 붙인다.
 *
 * ★ "채널만 있고 3년째 안 올림"과 "주 1회 올림"은 영업에서 완전히 다른 말이다.
 *   업로드 시점을 못 구했으면 **아무 말도 덧붙이지 않는다**(추정 금지).
 */
export function youtubePresenceText(links: readonly SocialLink[]): string {
  const base = SOCIAL_PRESENCE_LABEL.youtube.found;
  const channel = links.find((l) => l.platform === 'youtube' && l.kind === 'channel');
  const days = channel?.daysSinceUpload;
  if (typeof days !== 'number' || !Number.isFinite(days) || days < 0) return base;
  if (days === 0) return `${base} (오늘 업로드)`;
  return `${base} (최근 업로드 ${days}일 전)`;
}

/** ISO 시각 → 경과일. 못 읽으면 null (추정으로 메우지 않는다). */
export function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((now - at) / (24 * 60 * 60 * 1000)));
}
