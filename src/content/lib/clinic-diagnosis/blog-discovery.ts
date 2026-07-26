import { BLOG_CHECK_ID_PATTERN } from '../blog-check-input.ts';
import { normalizeClinicName, stripInstitutionSuffix, deriveBrandCore } from './registry.ts';
import type { BlogGuess, BlogResolution } from './types.ts';

/**
 * 2단계 ① — 병원 네이버 블로그 자동 탐색.
 *
 * ⚠️ 이 모듈의 제1원칙: **틀린 블로그를 그 병원 것으로 잘못 짚느니 "찾지 못했다"고 한다.**
 * 남의 블로그를 진단해 보여주면 그 자리에서 신뢰를 잃는다. 그래서
 *   · 확신 임계값(CONFIDENT_SCORE)을 넘고
 *   · 2위와의 점수 차가 MIN_GAP 이상일 때만
 * confident 로 확정하고, 그 외에는 전부 사용자에게 넘긴다(uncertain/none).
 *
 * 판정 근거는 BlogGuess 에 그대로 담아 화면에 노출한다 — "왜 이 블로그라고
 * 봤는지"를 사용자가 직접 검증할 수 있어야 오탐이 신뢰 손상으로 이어지지 않는다.
 *
 * 크롤링 금지 — 네이버 공식 검색 API(blog.json) 응답만 쓴다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

/** 확신 확정 최소 점수. */
export const CONFIDENT_SCORE = 70;
/** 1위·2위 최소 점수 차 — 이보다 붙어 있으면 사람이 고르게 한다. */
export const MIN_GAP = 20;
/** 검색 1회당 수집 건수. */
export const SEARCH_DISPLAY = 20;
/** 사용자에게 보여줄 후보 상한. */
export const MAX_GUESSES = 5;
/** 검색 1회 타임아웃(ms). */
export const SEARCH_TIMEOUT_MS = 6_000;

const NAVER_BLOG_SEARCH = 'https://openapi.naver.com/v1/search/blog.json';

/** 병원 블로그일 리 없는 블로거명 신호 — 체험단·정보성 계정 배제. */
const NOISE_BLOGGER_HINTS: readonly string[] = [
  '주소록', '전화번호부', '모음', '정리', '리스트', '디렉토리', '디렉터리',
];

export interface BlogSearchItem {
  readonly title: string;
  readonly link: string;
  readonly bloggerName: string;
  readonly bloggerLink: string;
  readonly postDate: string;
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
    }));
}

/**
 * 검색 결과를 블로그 단위로 묶어 확신도를 매긴다 (순수 함수).
 *
 * 점수 구성 (합계 상한 100):
 *   · 블로거명이 병원명과 정확히 같음                       60
 *   · 블로거명이 병원명(접미사 제거)을 포함                  45
 *   · 블로거명이 브랜드 코어 + 진료과를 모두 포함            35
 *   · 검색결과 점유 편수 3+ / 2 / 1                       25 / 15 / 5
 *   · 제목에 병원명이 등장한 글 2편 이상                     15
 * 노이즈 블로거명(주소록·모음 등)은 이름 가점을 주지 않는다.
 */
export function scoreBlogGuesses(
  items: readonly BlogSearchItem[],
  clinicName: string,
  specialty: string,
): readonly BlogGuess[] {
  const target = normalizeClinicName(clinicName);
  const stripped = normalizeClinicName(stripInstitutionSuffix(clinicName));
  const core = normalizeClinicName(deriveBrandCore(clinicName));
  const spec = normalizeClinicName(specialty);
  if (target.length < 2) return [];

  interface Bucket {
    blogId: string;
    bloggerName: string;
    hits: number;
    titleMentions: number;
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
    };
    const titleNorm = normalizeClinicName(item.title);
    buckets.set(blogId, {
      blogId,
      // 블로거명은 첫 등장값을 유지한다(불변 갱신).
      bloggerName: bucket.bloggerName || item.bloggerName,
      hits: bucket.hits + 1,
      titleMentions:
        bucket.titleMentions +
        (titleNorm.includes(target) || (stripped.length >= 3 && titleNorm.includes(stripped)) ? 1 : 0),
    });
  }

  const guesses: BlogGuess[] = [];
  for (const bucket of buckets.values()) {
    const nameNorm = normalizeClinicName(bucket.bloggerName);
    const isNoise = NOISE_BLOGGER_HINTS.some((hint) => bucket.bloggerName.includes(hint));

    let nameScore = 0;
    let exactName = false;
    if (!isNoise && nameNorm.length >= 2) {
      if (nameNorm === target || nameNorm === stripped) {
        nameScore = 60;
        exactName = true;
      } else if (stripped.length >= 3 && nameNorm.includes(stripped)) {
        nameScore = 45;
        exactName = true;
      } else if (core.length >= 2 && spec.length >= 2 && nameNorm.includes(core) && nameNorm.includes(spec)) {
        nameScore = 35;
        exactName = true;
      }
    }

    const hitScore = bucket.hits >= 3 ? 25 : bucket.hits === 2 ? 15 : 5;
    const titleScore = bucket.titleMentions >= 2 ? 15 : 0;
    const confidence = Math.min(100, nameScore + (nameScore > 0 ? hitScore + titleScore : 0));

    guesses.push({
      blogId: bucket.blogId,
      bloggerName: bucket.bloggerName,
      hits: bucket.hits,
      nameInBloggerName: exactName,
      titleMentions: bucket.titleMentions,
      confidence,
    });
  }

  return guesses
    .filter((g) => g.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence || b.hits - a.hits || a.blogId.localeCompare(b.blogId))
    .slice(0, MAX_GUESSES);
}

/**
 * 확신도 목록 → 최종 판정 (순수 함수).
 * 1위가 임계값을 넘고 2위와 MIN_GAP 이상 벌어졌을 때만 confident.
 */
export function resolveBlogGuesses(guesses: readonly BlogGuess[]): BlogResolution {
  if (guesses.length === 0) return { kind: 'none' };
  const [top, second] = guesses;
  const gap = second ? top.confidence - second.confidence : Number.POSITIVE_INFINITY;
  if (top.confidence >= CONFIDENT_SCORE && gap >= MIN_GAP) {
    return { kind: 'confident', guess: top };
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
 * 병원명(+진료과)으로 블로그를 탐색한다.
 * 검색은 최대 2콜(병원명 그대로 / 접미사 제거형) — 두 결과를 합쳐 채점한다.
 */
export async function discoverClinicBlog(
  clinicName: string,
  specialty: string,
  options: DiscoverBlogOptions = {},
): Promise<BlogResolution> {
  const env = options.env ?? (process.env as NaverSearchEnv);
  if (!isNaverSearchConfigured(env)) return { kind: 'unavailable' };
  const fetchImpl = options.fetchImpl ?? fetch;

  const primary = clinicName.trim();
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

  return resolveBlogGuesses(scoreBlogGuesses(merged, clinicName, specialty));
}
