import { BLOG_CHECK_ID_PATTERN } from '../blog-check-input.ts';
import { normalizeClinicName, stripInstitutionSuffix, deriveBrandCore } from './registry.ts';
import type { BlogGuess, BlogResolution } from './types.ts';

/**
 * 2단계 ① — 병원 네이버 블로그 자동 탐색.
 *
 * ⚠️ 제1원칙(그대로 유지): **남의 블로그를 그 병원 것으로 잘못 짚는 위험은 여전히 크다.**
 * 그래서 어느 블로그를 썼는지 결과 화면 맨 위에 눈에 띄게 표시하고, 주소를 눌러
 * 확인하고 바꿀 수 있게 한다.
 *
 * ★ 다만 **흐름을 끊지는 않는다**(대표 실사용 지적: "병원을 골랐는데 블로그를 왜 또 고르지?").
 *   사용자는 이미 병원을 한 번 확정했다. 여기서 또 고르라고 멈추면 진단을 못 본 채 이탈한다.
 *   판정은 3단계다:
 *     confident : 블로거명 자체에 병원명이 들어 있고(가장 강한 소유 신호) 점수·격차 충족
 *     assumed   : 이름 신호는 있으나 확신까지는 아니다 → **1위로 일단 진단하고 화면에 밝힌다**
 *     uncertain : 이름 신호가 아예 없다(블로거명·제목 어디에도 병원명 없음) → 기존처럼 물어본다
 *
 * ★ 병원을 이미 특정했으므로 그 병원의 **지역·진료과**를 채점에 쓴다.
 *   실측(리팅성형외과)에서 블로그 아이디가 `night140160` 이라 이름만으로는 확신이 서지 않았다.
 *   그 블로그 글에 "대구"·"수성구"·"성형외과"가 반복해서 나오면 판정이 달라진다.
 *
 * 판정 근거는 BlogGuess 에 그대로 담아 화면에 노출한다 — "왜 이 블로그라고
 * 봤는지"를 사용자가 직접 검증할 수 있어야 오탐이 신뢰 손상으로 이어지지 않는다.
 *
 * 크롤링 금지 — 네이버 공식 검색 API(blog.json) 응답만 쓴다(추가 호출 없음).
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

/** 확신 확정 최소 점수. */
export const CONFIDENT_SCORE = 70;
/** 1위·2위 최소 점수 차 — 이보다 붙어 있으면 확신하지 않는다. */
export const MIN_GAP = 20;
/**
 * 자동 진행(assumed) 최소 점수 — **블로거명에 병원명이 들어 있는 경로**.
 *
 * 블로거명은 남이 흉내 낼 수 없는 소유 신호라 기존 기준(40)을 그대로 둔다.
 */
export const ASSUME_SCORE = 40;
/**
 * 자동 진행(assumed) 최소 점수 — **제목 언급만으로 올라온 경로**.
 *
 * ★ 2026-07-27 점검 지적: 제목 2편(22) + 점유 2편(12) + 지역 1편(7) = 41 로
 *   기존 임계(40)를 넘어 자동 진행됐다. 병원 리뷰·체험단·마케팅 대행 블로그가
 *   흔히 만족하는 조합이다. 제목 2편 조합의 최대치는
 *   22 + 20(점유 3편+) + 12(지역 2편+) + 8(진료과 2편+) = 62 라 점수만으로는
 *   갈라낼 수 없어, **편수 요건(MIN_TITLE_MENTIONS_FOR_ASSUME)을 따로 건다.**
 */
export const TITLE_ASSUME_SCORE = 55;
/**
 * 블로거명 신호 없이 자동 진행하려면 필요한 **제목 언급 편수**.
 *
 * 남의 블로그가 특정 병원 이름을 제목에 3편 이상 쓰는 일은 드물다(체험단·리뷰는
 * 보통 1~2편이다). 이 요건이 오판의 실질 방어선이고 점수는 보조다.
 */
export const MIN_TITLE_MENTIONS_FOR_ASSUME = 3;
/**
 * 자동 진행에 필요한 1위·2위 최소 점수 차.
 *
 * ★ 예전에는 assumed 에 격차 요건이 아예 없어서 **1점 차여도 진행**했다.
 *   잘못 짚은 블로그의 발행주기·키워드·의료광고법 검출이 전부 그 병원 것으로
 *   표시되고 그 수치가 리드에 저장돼 전화 대본 재료가 된다 — 남의 블로그에서 나온
 *   "후기 5건"으로 원장에게 전화하는 사고가 성립한다. 붙어 있으면 물어본다.
 */
export const MIN_ASSUME_GAP = 12;
/** 검색 1회당 수집 건수. */
export const SEARCH_DISPLAY = 20;
/** 사용자에게 보여줄 후보 상한. */
export const MAX_GUESSES = 5;
/** 검색 1회 타임아웃(ms). */
export const SEARCH_TIMEOUT_MS = 6_000;

const NAVER_BLOG_SEARCH = 'https://openapi.naver.com/v1/search/blog.json';

/** 병원 블로그일 리 없는 블로거명 신호 — 주소록·모음 계정 배제. */
const NOISE_BLOGGER_HINTS: readonly string[] = [
  '주소록', '전화번호부', '모음', '정리', '리스트', '디렉토리', '디렉터리',
];

/**
 * 체험단·리뷰·대가성 협찬 블로그 신호 (제목·글 앞부분에서 본다).
 *
 * ★ NOISE_BLOGGER_HINTS 만으로는 못 걸렀다 — 그건 블로거명이 '주소록'인 계정만
 *   잡는데, 실제로 병원 이름을 제목에 쓰는 남의 블로그는 체험단·리뷰 계정이다.
 * ⚠️ 병원이 직접 체험단을 돌린 경우도 있으므로, 이 신호는 **블로거명 신호가 없는
 *    후보의 제목 가점만** 없앤다(블로거명이 병원명인 블로그는 그대로 둔다).
 */
const SPONSORED_HINTS =
  /체험단|서포터즈|기자단|협찬|제공받아|제공\s*받아|소정의|원고료|무상\s*제공|내돈내산|공동\s*구매/;

/**
 * ⚠️ "여러 병원 이름이 섞여 나오면 리뷰 계정" 규칙은 **넣었다가 뺐다**(2026-07-27 실측).
 *   병원 블로그는 인근 지역·시술을 키워드로 붙인 제목을 일상적으로 쓴다 —
 *   프라이브성형외과(newprive)의 실제 글 제목이 "경산리프팅성형외과…"였고,
 *   본문에는 "대한성형외과의사회"가 나왔다. 둘 다 남의 병원 이름이 아닌데
 *   병원명 형태로 잡혀 **자기 병원 블로그가 후보에서 통째로 빠졌다.**
 *   기계적으로 뽑은 "○○성형외과" 토큰으로는 남의 병원과 키워드 조합을 가를 수 없다.
 *   오판 방어는 아래 대가성 어휘 + 제목 편수·격차 요건이 맡는다.
 */

export interface BlogSearchItem {
  readonly title: string;
  readonly link: string;
  readonly bloggerName: string;
  readonly bloggerLink: string;
  readonly postDate: string;
  /**
   * 검색 응답이 함께 주는 글 앞부분 요약.
   * ★ 추가 호출이 아니라 **같은 응답에 이미 들어 있던 필드**다 — 지역·진료과 신호를
   *   여기서 읽어 병원 특정 결과를 블로그 판정에 활용한다.
   */
  readonly description?: string;
}

/** 이미 특정된 병원의 정보 — 블로그 판정에 그대로 활용한다. */
export interface ClinicBlogContext {
  readonly name: string;
  readonly specialty: string;
  /** 구·군 (예: '수성구'). 없으면 ''. */
  readonly region?: string;
  /** 시·도 (예: '대구광역시'). 없으면 ''. */
  readonly province?: string;
}

/** HTML 태그·엔티티 제거 (네이버 검색 응답은 <b> 강조가 섞여 온다). */
export function stripSearchMarkup(value: string): string {
  return (value ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/** blog.naver.com URL 에서 blogId 추출. 패턴 미달이면 null. */
export function extractBlogId(url: string): string | null {
  const raw = (url ?? '').trim().toLowerCase();
  if (!raw) return null;
  const match = raw.match(/blog\.naver\.com\/([a-z0-9_-]+)/);
  if (!match) return null;
  const id = match[1];
  return BLOG_CHECK_ID_PATTERN.test(id) ? id : null;
}

/** 네이버 blog.json 응답 → 검색 아이템 (순수 함수). */
export function parseBlogSearch(payload: unknown): readonly BlogSearchItem[] {
  if (!payload || typeof payload !== 'object') return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((it): it is Record<string, unknown> => Boolean(it) && typeof it === 'object')
    .map((it) => ({
      title: stripSearchMarkup(String(it.title ?? '')),
      link: String(it.link ?? '').trim(),
      bloggerName: stripSearchMarkup(String(it.bloggername ?? '')),
      bloggerLink: String(it.bloggerlink ?? '').trim(),
      postDate: String(it.postdate ?? '').trim(),
      description: stripSearchMarkup(String(it.description ?? '')),
    }));
}

/** 시·도 축약형 ('대구광역시' → '대구'). 지역 신호 매칭용. */
function shortProvince(province: string): string {
  return (province ?? '').replace(/(특별자치도|특별자치시|특별시|광역시|도)$/u, '');
}

/**
 * 검색 결과를 블로그 단위로 묶어 확신도를 매긴다 (순수 함수).
 *
 * 점수 구성 (합계 상한 100):
 *   [이름 신호]
 *   · 블로거명이 병원명과 정확히 같음                       60
 *   · 블로거명이 병원명(접미사 제거)을 포함                  45
 *   · 블로거명이 브랜드 코어 + 진료과를 모두 포함            35
 *   · 제목에 병원명이 등장한 글 3+ / 2 / 1편              30 / 22 / 12
 *   [보조 신호 — 이름 신호가 하나라도 있을 때만 더한다]
 *   · 검색결과 점유 편수 3+ / 2 / 1                       20 / 12 / 5
 *   · 병원 지역(구·군 또는 시)이 등장한 글 2+ / 1편          12 / 7
 *   · 병원 진료과가 등장한 글 2+ / 1편                       8 / 4
 *
 * ★ 이름 신호를 "블로거명"에만 걸지 않는다. 실측(리팅성형외과 = `night140160`)처럼
 *   아이디·블로거명에 병원명이 전혀 없는 병원이 실제로 있다. 그런 블로그도 자기 글
 *   제목에는 병원명을 쓴다 — 제목 언급을 독립 신호로 세고, 지역·진료과로 뒷받침한다.
 * ★ 이름 신호가 0인 블로그는 보조 신호를 아무리 받아도 후보로 올리지 않는다.
 *   그러지 않으면 그 지역 병원 글을 쓰는 체험단·정보성 블로그가 1위로 올라온다.
 * 노이즈 블로거명(주소록·모음 등)은 블로거명 가점을 주지 않는다.
 */
export function scoreBlogGuesses(
  items: readonly BlogSearchItem[],
  context: ClinicBlogContext,
): readonly BlogGuess[] {
  const clinicName = context.name;
  const target = normalizeClinicName(clinicName);
  const stripped = normalizeClinicName(stripInstitutionSuffix(clinicName));
  const core = normalizeClinicName(deriveBrandCore(clinicName));
  const spec = normalizeClinicName(context.specialty);
  if (target.length < 2) return [];

  /** 지역 신호 토큰 — '수성구', '대구' 처럼 실제 글에 쓰이는 표기. */
  const regionTokens = [normalizeClinicName(context.region ?? ''), normalizeClinicName(shortProvince(context.province ?? ''))]
    .filter((token) => token.length >= 2);

  interface Bucket {
    blogId: string;
    bloggerName: string;
    hits: number;
    titleMentions: number;
    regionMentions: number;
    specialtyMentions: number;
    /** 대가성 후기·체험단 어휘가 나온 글 수. */
    sponsoredMentions: number;
  }
  const buckets = new Map<string, Bucket>();

  for (const item of items) {
    const blogId = extractBlogId(item.bloggerLink) ?? extractBlogId(item.link);
    if (!blogId) continue;
    const bucket = buckets.get(blogId) ?? {
      blogId,
      bloggerName: item.bloggerName,
      hits: 0,
      titleMentions: 0,
      regionMentions: 0,
      specialtyMentions: 0,
      sponsoredMentions: 0,
    };
    const titleNorm = normalizeClinicName(item.title);
    // 지역·진료과는 제목 + 검색이 함께 준 글 앞부분에서 본다(추가 호출 없음).
    const rawText = `${item.title} ${item.description ?? ''}`;
    const textNorm = `${titleNorm}${normalizeClinicName(item.description ?? '')}`;

    buckets.set(blogId, {
      blogId,
      // 블로거명은 첫 등장값을 유지한다(불변 갱신).
      bloggerName: bucket.bloggerName || item.bloggerName,
      hits: bucket.hits + 1,
      titleMentions:
        bucket.titleMentions +
        (titleNorm.includes(target) || (stripped.length >= 3 && titleNorm.includes(stripped)) ? 1 : 0),
      regionMentions:
        bucket.regionMentions + (regionTokens.some((token) => textNorm.includes(token)) ? 1 : 0),
      specialtyMentions: bucket.specialtyMentions + (spec.length >= 2 && textNorm.includes(spec) ? 1 : 0),
      sponsoredMentions: bucket.sponsoredMentions + (SPONSORED_HINTS.test(rawText) ? 1 : 0),
    });
  }

  const guesses: BlogGuess[] = [];
  for (const bucket of buckets.values()) {
    const nameNorm = normalizeClinicName(bucket.bloggerName);
    const isNoise = NOISE_BLOGGER_HINTS.some((hint) => bucket.bloggerName.includes(hint));
    /**
     * 대가성 후기 어휘를 쓰는 블로그 — 제목에 병원 이름이 나와도 그 병원 블로그가 아니다.
     * (블로거명이 병원명인 후보는 여기에 걸리지 않는다 — 아래 titleScore 에만 적용한다)
     */
    const isForeignAuthored = bucket.sponsoredMentions > 0;

    let bloggerNameScore = 0;
    let exactName = false;
    if (!isNoise && nameNorm.length >= 2) {
      if (nameNorm === target || nameNorm === stripped) {
        bloggerNameScore = 60;
        exactName = true;
      } else if (stripped.length >= 3 && nameNorm.includes(stripped)) {
        bloggerNameScore = 45;
        exactName = true;
      } else if (core.length >= 2 && spec.length >= 2 && nameNorm.includes(core) && nameNorm.includes(spec)) {
        bloggerNameScore = 35;
        exactName = true;
      }
    }

    // 주소록·모음·체험단·리뷰 계정은 제목에 병원명이 나와도 자기 블로그가 아니다 — 이름 신호를 주지 않는다.
    const titleScore = isNoise || isForeignAuthored
      ? 0
      : bucket.titleMentions >= 3
        ? 30
        : bucket.titleMentions === 2
          ? 22
          : bucket.titleMentions === 1
            ? 12
            : 0;
    const nameSignal = bloggerNameScore + titleScore;

    const hitScore = bucket.hits >= 3 ? 20 : bucket.hits === 2 ? 12 : 5;
    const regionScore = bucket.regionMentions >= 2 ? 12 : bucket.regionMentions === 1 ? 7 : 0;
    const specialtyScore = bucket.specialtyMentions >= 2 ? 8 : bucket.specialtyMentions === 1 ? 4 : 0;

    const confidence =
      nameSignal > 0 ? Math.min(100, nameSignal + hitScore + regionScore + specialtyScore) : 0;

    guesses.push({
      blogId: bucket.blogId,
      bloggerName: bucket.bloggerName,
      hits: bucket.hits,
      nameInBloggerName: exactName,
      titleMentions: bucket.titleMentions,
      regionMentions: bucket.regionMentions,
      specialtyMentions: bucket.specialtyMentions,
      confidence,
    });
  }

  return guesses
    .filter((g) => g.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence || b.hits - a.hits || a.blogId.localeCompare(b.blogId))
    .slice(0, MAX_GUESSES);
}

/** 이 후보에 "병원 이름" 신호가 조금이라도 있는가 — 자동 진행의 최소 조건. */
export function hasNameSignal(guess: BlogGuess): boolean {
  return guess.nameInBloggerName || guess.titleMentions > 0;
}

/**
 * 이 후보 하나만 놓고 봤을 때 자동 진행해도 되는가 (2위 격차는 별도).
 *
 * 경로에 따라 기준이 다르다 — **블로거명은 남이 흉내 낼 수 없고, 제목은 아니다.**
 *   · 블로거명에 병원명이 있으면 : 점수 ≥ ASSUME_SCORE
 *   · 제목 언급만 있으면        : 제목 언급 3편 이상 + 점수 ≥ TITLE_ASSUME_SCORE
 */
export function meetsAssumeBar(guess: BlogGuess): boolean {
  if (guess.nameInBloggerName) return guess.confidence >= ASSUME_SCORE;
  return guess.titleMentions >= MIN_TITLE_MENTIONS_FOR_ASSUME && guess.confidence >= TITLE_ASSUME_SCORE;
}

/**
 * 확신도 목록 → 최종 판정 (순수 함수).
 *
 * confident : 블로거명 자체에 병원명이 있고(가장 강한 소유 신호) 점수 ≥ CONFIDENT_SCORE,
 *             2위와 MIN_GAP 이상 벌어짐.
 * assumed   : 이름 신호가 경로별 기준(meetsAssumeBar)을 넘고 2위와 MIN_ASSUME_GAP 이상
 *             벌어짐 → 1위로 진단을 진행하되 화면에 밝힌다.
 *             그래도 MIN_GAP 안쪽이면 close=true 로 "비슷한 후보가 하나 더 있었다"를 표시한다.
 * uncertain : 기준 미달이거나 2위와 붙어 있다 → 기존처럼 사용자에게 묻는다.
 *
 * ⚠️ 블로거명 신호(nameInBloggerName)가 없으면 아무리 점수가 높아도 confident 로 올리지
 *    않는다. 그 자리에서 "확신했다"고 말할 근거가 부족하고, 남의 블로그를 확정으로
 *    보여주는 것이 이 기능에서 가장 큰 사고이기 때문이다.
 * ⚠️ assumed 에도 격차를 요구한다. 붙어 있는 두 후보 중 하나를 임의로 골라 진단하면
 *    그 수치가 리드로 저장돼 영업 대본 재료가 된다 — 틀린 채로 굳는다.
 */
export function resolveBlogGuesses(guesses: readonly BlogGuess[]): BlogResolution {
  if (guesses.length === 0) return { kind: 'none' };
  const [top, second] = guesses;
  const gap = second ? top.confidence - second.confidence : Number.POSITIVE_INFINITY;

  if (top.nameInBloggerName && top.confidence >= CONFIDENT_SCORE && gap >= MIN_GAP) {
    return { kind: 'confident', guess: top };
  }
  if (hasNameSignal(top) && meetsAssumeBar(top) && gap >= MIN_ASSUME_GAP) {
    return { kind: 'assumed', guess: top, guesses, close: gap < MIN_GAP };
  }
  return { kind: 'uncertain', guesses };
}

export interface NaverSearchEnv {
  readonly NAVER_CLIENT_ID?: string;
  readonly NAVER_CLIENT_SECRET?: string;
}

export function isNaverSearchConfigured(env: NaverSearchEnv): boolean {
  return Boolean(env.NAVER_CLIENT_ID?.trim() && env.NAVER_CLIENT_SECRET?.trim());
}

/** 네이버 블로그 검색 1회. 실패·타임아웃은 null (절대 throw 안 함). */
export async function searchBlogPosts(
  query: string,
  options: { env: NaverSearchEnv; fetchImpl: typeof fetch; timeoutMs?: number; display?: number },
): Promise<readonly BlogSearchItem[] | null> {
  const clientId = options.env.NAVER_CLIENT_ID?.trim();
  const clientSecret = options.env.NAVER_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const trimmed = (query ?? '').trim();
  if (trimmed.length < 2) return null;

  const params = new URLSearchParams({
    query: trimmed,
    display: String(Math.min(Math.max(options.display ?? SEARCH_DISPLAY, 1), 100)),
    sort: 'sim',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SEARCH_TIMEOUT_MS);
  try {
    const res = await options.fetchImpl(`${NAVER_BLOG_SEARCH}?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });
    if (!res.ok) return null;
    return parseBlogSearch(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface DiscoverBlogOptions {
  readonly env?: NaverSearchEnv;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * 이미 특정된 병원 정보로 블로그를 탐색한다.
 * 검색은 최대 2콜(병원명 그대로 / 접미사 제거형) — 두 결과를 합쳐 채점한다.
 * 지역·진료과는 **같은 응답 안의 필드**로 채점에만 쓰므로 호출 수가 늘지 않는다.
 */
export async function discoverClinicBlog(
  context: ClinicBlogContext,
  options: DiscoverBlogOptions = {},
): Promise<BlogResolution> {
  const env = options.env ?? (process.env as NaverSearchEnv);
  if (!isNaverSearchConfigured(env)) return { kind: 'unavailable' };
  const fetchImpl = options.fetchImpl ?? fetch;

  const primary = context.name.trim();
  const secondary = stripInstitutionSuffix(primary);
  const queries = primary === secondary ? [primary] : [primary, secondary];

  const results = await Promise.all(
    queries.map((q) => searchBlogPosts(q, { env, fetchImpl, timeoutMs: options.timeoutMs })),
  );
  if (results.every((r) => r === null)) return { kind: 'unavailable' };

  // 같은 글이 두 질의에 겹쳐 나오면 중복 가중을 막기 위해 link 기준 dedup.
  const seen = new Set<string>();
  const merged: BlogSearchItem[] = [];
  for (const list of results) {
    for (const item of list ?? []) {
      const key = item.link || `${item.bloggerLink}#${item.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }

  return resolveBlogGuesses(scoreBlogGuesses(merged, context));
}
