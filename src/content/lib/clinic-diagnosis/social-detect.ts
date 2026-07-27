import type { SocialAxis, SocialLink, SocialPlatform, SocialPresence } from './types.ts';

/**
 * 2단계 ⑤ — 인스타그램 · 유튜브 탐지 (링크 기반, 순수 함수).
 *
 * ★ 왜 필요한가.
 *   성형외과·피부과의 주 채널은 블로그가 아니라 인스타다. 그 사실을 모른 채
 *   "블로그가 멈췄습니다"만 말하면 진단이 헛다리를 짚는다 — 원장은 인스타를
 *   매일 올리고 있는데 "아무것도 안 하고 계시네요"로 읽힌다. 반대로 인스타를
 *   하고 있다는 걸 알면 문장이 정확해진다:
 *     "인스타는 운영하시는데 블로그는 1년째 비어 있습니다.
 *      검색으로 찾는 환자는 못 만나고 계십니다."
 *
 * ★ 왜 API 연동을 하지 않는가.
 *   Meta 토큰은 주기적 갱신이 필요하다 = 또 하나의 '조용히 죽는 것'이 된다.
 *   대신 **이미 받아 둔 HTML/글 본문에서 링크만** 찾는다. 요청을 늘리지 않는다.
 *
 * ⚠️ 한계를 문구로 지킨다 — 링크가 없다고 "인스타를 안 한다"고 단정하지 않는다.
 *    우리가 말할 수 있는 한계는 "홈페이지·블로그에서 확인되지 않았습니다"까지다.
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

/** 링크 1건 판정. 계정으로 볼 수 없으면 null(추정으로 메우지 않는다). */
export function classifySocialUrl(host: string, path: string): SocialLink | null {
  const domain = host.toLowerCase();
  const raw = decodeLoose(path);

  if (domain === 'instagram.com' || domain === 'instagr.am') {
    const first = firstSegment(raw);
    if (!first) return null;
    if (INSTAGRAM_RESERVED.has(first.toLowerCase())) {
      // 게시물·릴스 링크 — 병원 계정일 가능성이 높지만 계정명을 알 수 없다.
      return {
        platform: 'instagram',
        kind: 'content',
        handle: '',
        url: `https://www.instagram.com/${first.toLowerCase()}/`,
      };
    }
    if (!INSTAGRAM_HANDLE_RE.test(first)) return null;
    const handle = first.toLowerCase();
    return {
      platform: 'instagram',
      kind: 'channel',
      handle,
      url: `https://www.instagram.com/${handle}/`,
    };
  }

  if (domain === 'youtu.be') {
    // 항상 영상 단축 주소다 — 채널이 아니다.
    const first = firstSegment(raw);
    if (!first) return null;
    return { platform: 'youtube', kind: 'content', handle: '', url: 'https://youtu.be/' };
  }

  // youtube.com / youtube-nocookie.com
  const first = firstSegment(raw);
  if (!first) return null;
  const lower = first.toLowerCase();

  if (lower.startsWith('@')) {
    const handle = first.slice(1);
    if (!YOUTUBE_HANDLE_RE.test(handle)) return null;
    return {
      platform: 'youtube',
      kind: 'channel',
      handle: `@${handle}`,
      url: `https://www.youtube.com/@${handle}`,
    };
  }
  if (lower === 'channel') {
    const id = secondSegment(raw);
    if (!YOUTUBE_CHANNEL_ID_RE.test(id)) return null;
    return {
      platform: 'youtube',
      kind: 'channel',
      handle: id,
      url: `https://www.youtube.com/channel/${id}`,
    };
  }
  if (lower === 'c' || lower === 'user') {
    const name = secondSegment(raw);
    if (!YOUTUBE_HANDLE_RE.test(name)) return null;
    return {
      platform: 'youtube',
      kind: 'channel',
      handle: name,
      url: `https://www.youtube.com/${lower}/${name}`,
    };
  }
  if (YOUTUBE_CONTENT_PATHS.has(lower)) {
    return { platform: 'youtube', kind: 'content', handle: '', url: 'https://www.youtube.com/' };
  }
  return null;
}

/**
 * HTML·본문 텍스트에서 인스타·유튜브 링크를 찾는다 (순수 함수, 요청 없음).
 * 같은 계정이 여러 번 나와도 1건으로 합치고, 채널 링크를 앞에 둔다.
 */
export function extractSocialLinks(text: string): readonly SocialLink[] {
  const source = (text ?? '').slice(0, MAX_SCAN_CHARS);
  if (source.length === 0) return [];

  const byKey = new Map<string, SocialLink>();
  SOCIAL_URL_RE.lastIndex = 0;
  for (;;) {
    const match = SOCIAL_URL_RE.exec(source);
    if (match === null) break;
    const link = classifySocialUrl(match[1], match[2] ?? '');
    if (!link) continue;
    const key = `${link.platform}|${link.kind}|${link.handle}`;
    if (!byKey.has(key)) byKey.set(key, link);
    if (byKey.size >= MAX_SOCIAL_LINKS * 4) break; // 폭주 방어 (합치기 전 상한)
  }

  return [...byKey.values()]
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'channel' ? -1 : 1;
      if (a.platform !== b.platform) return a.platform === 'instagram' ? -1 : 1;
      return a.handle.localeCompare(b.handle);
    })
    .slice(0, MAX_SOCIAL_LINKS);
}

/** 여러 출처에서 모은 링크를 합친다 (중복 제거, 채널 우선). */
export function mergeSocialLinks(...groups: readonly (readonly SocialLink[])[]): readonly SocialLink[] {
  const all: SocialLink[] = [];
  for (const group of groups) {
    for (const link of group ?? []) all.push(link);
  }
  const byKey = new Map<string, SocialLink>();
  for (const link of all) {
    const key = `${link.platform}|${link.kind}|${link.handle}`;
    if (!byKey.has(key)) byKey.set(key, link);
  }
  return [...byKey.values()]
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'channel' ? -1 : 1;
      if (a.platform !== b.platform) return a.platform === 'instagram' ? -1 : 1;
      return a.handle.localeCompare(b.handle);
    })
    .slice(0, MAX_SOCIAL_LINKS);
}

export const EMPTY_SOCIAL_AXIS: SocialAxis = {
  checked: false,
  instagram: 'unknown',
  youtube: 'unknown',
  links: [],
  scannedSite: false,
  scannedBlog: false,
};

export interface BuildSocialAxisInput {
  /** 홈페이지 HTML 을 실제로 받아 봤는가 (auditSite 가 본문을 확보했는가). */
  readonly scannedSite: boolean;
  readonly siteLinks: readonly SocialLink[];
  /** 블로그 글 본문·요약을 실제로 받아 봤는가. */
  readonly scannedBlog: boolean;
  readonly blogLinks: readonly SocialLink[];
}

/**
 * 소셜 축 조립.
 *
 * · 어느 쪽도 못 본 상태 → checked:false, 전부 unknown ("확인하지 못했다")
 * · 한 곳이라도 봤는데 채널 링크가 없다 → not_found ("확인되지 않았다" — '없다'가 아니다)
 * · 채널 링크가 있다 → found
 */
export function buildSocialAxis(input: BuildSocialAxisInput): SocialAxis {
  const scanned = Boolean(input.scannedSite) || Boolean(input.scannedBlog);
  if (!scanned) return EMPTY_SOCIAL_AXIS;

  const links = mergeSocialLinks(input.siteLinks ?? [], input.blogLinks ?? []);
  const presenceOf = (platform: SocialPlatform): SocialPresence =>
    links.some((l) => l.platform === platform && l.kind === 'channel') ? 'found' : 'not_found';

  return {
    checked: true,
    instagram: presenceOf('instagram'),
    youtube: presenceOf('youtube'),
    links,
    scannedSite: Boolean(input.scannedSite),
    scannedBlog: Boolean(input.scannedBlog),
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

/**
 * 어디를 봤는지 한 줄로 — 판정 문구에 **반드시** 함께 나간다.
 * "확인되지 않았다"가 "안 한다"로 읽히지 않게 하는 유일한 장치다.
 */
export function scanScopeText(social: SocialAxis | null | undefined): string {
  const site = Boolean(social?.scannedSite);
  const blog = Boolean(social?.scannedBlog);
  if (site && blog) return '홈페이지와 블로그 글';
  if (site) return '홈페이지';
  if (blog) return '블로그 글';
  return '';
}
