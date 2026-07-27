import { stripSearchMarkup, type NaverSearchEnv } from './blog-discovery.ts';
import { normalizeClinicName, stripInstitutionSuffix } from './registry.ts';
import { extractSocialLinks } from './social-detect.ts';
import type { SocialLink } from './types.ts';

/**
 * 2단계 ⑤-b — **링크를 안 걸어 둔 병원의 인스타 계정 찾기** (네이버 웹문서 검색).
 *
 * ★ 왜 필요한가 (2026-07-27 대표 지적).
 *   지금까지는 홈페이지·블로그 HTML 에 인스타 주소가 적혀 있을 때만 "운영 중"으로
 *   판정했다. 그래서 **링크를 안 걸어 둔 병원은 인스타를 매일 올려도 '확인되지 않음'**
 *   이었다. 성형외과·피부과의 주 채널이 인스타인데 그걸 놓치면 진단이 헛다리를 짚는다.
 *
 * ★ 왜 네이버 검색인가.
 *   인스타그램에는 **이름으로 계정을 찾는 공식 API 가 없다** — Graph API 는 계정
 *   아이디를 이미 알고 있어야 조회된다. 크롤링은 금지다. 남는 합법 경로는 우리가
 *   이미 쓰는 네이버 검색 API 뿐이고, 네이버 웹문서 색인에는 인스타 프로필 페이지가
 *   그대로 들어 있다("@edge__ps - Instagram").
 *
 * 비용 규칙 (강제):
 *   · **병원당 1회.** 진단은 이미 네이버를 10~15회 부른다 — 일 25,000회 한도와
 *     응답 시간을 지키려면 여기서 더 늘릴 수 없다.
 *   · 홈페이지·블로그에서 이미 인스타 계정을 찾았으면 **호출 자체를 하지 않는다**
 *     (호출부 run.ts 가 판단한다).
 *
 * ⚠️ 이 모듈에서 가장 큰 위험은 **오탐**이다. 실측(2026-07-27):
 *   "한피부과의원 인스타그램" 검색 1위가 @oaro_skyl65 였다 — 아무 관계 없는 병원이다.
 *   같은 지역·진료과의 남의 병원 계정, 체험단 계정이 상위에 섞여 들어온다.
 *   그래서 **순위는 근거로 쓰지 않고**, 아래 세 가지 중 하나를 만족할 때만 채택한다:
 *     ① 계정 아이디가 병원 자기 도메인 이름을 담고 있다 (edge1.co.kr → @edge__ps)
 *     ② 그 검색 결과 문서가 **병원 소유**다 (병원 홈페이지 또는 병원 네이버 블로그)
 *     ③ 문서 제목·본문에 **병원 이름이 그대로** 있고, 대가성·제3자 매체가 아니다
 *   하나도 안 걸리면 채택하지 않는다 — **'확인되지 않음'이 틀린 계정보다 낫다.**
 *
 * ⚠️ 로마자 발음 유사도(한 → hann)는 쓰지 않는다. 실측에서 '한피부과의원' 검색에
 *    @woo.hann_skin_clinic 이 잡혔다 — 발음만 비슷한 남의 병원이다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

const NAVER_WEB_SEARCH = 'https://openapi.naver.com/v1/search/webkr.json';

/** 검색 1회 타임아웃(ms) — 진단 전체 예산을 지키려면 짧게. */
export const SOCIAL_SEARCH_TIMEOUT_MS = 5_000;
/** 한 번에 훑는 문서 수. */
export const SOCIAL_SEARCH_DISPLAY = 20;
/** 브랜드 토큰 최소 길이 — 3자 이하는 남의 계정에 우연히 들어가기 쉽다. */
export const MIN_BRAND_TOKEN = 4;
/** 플랫폼당 채택 상한 — 계정이 2개까지는 실제로 있다(본원/이벤트 계정). */
export const MAX_ACCEPTED_PER_PLATFORM = 2;

/**
 * 도메인 라벨 중 **병원 고유 이름으로 볼 수 없는** 것.
 * 이런 토큰으로 계정을 매칭하면 남의 병원 계정이 전부 걸린다(@brandnew_clinic 등).
 */
const GENERIC_HOST_LABELS: ReadonlySet<string> = new Set([
  'clinic', 'clinics', 'beauty', 'plastic', 'surgery', 'skin', 'derma', 'dermatology',
  'medical', 'hospital', 'doctor', 'seoul', 'daegu', 'busan', 'incheon', 'gwangju',
  'blog', 'naver', 'modoo', 'imweb', 'cafe24', 'wixsite', 'creatorlink', 'kr',
  'co', 'com', 'net', 'org', 'info', 'shop', 'site', 'page', 'link', 'bit',
]);

/**
 * 제3자가 쓴 글이 올라오는 매체 — 여기 실린 인스타 주소는 **글쓴이 것일 수 있다.**
 * (병원 이름이 본문에 나온다고 그 밑의 인스타가 병원 계정이라는 보장이 없다)
 * 병원 자기 네이버 블로그는 예외로 통과시킨다(blogId 로 확인).
 */
const THIRD_PARTY_HOSTS: readonly string[] = [
  'blog.naver.com', 'cafe.naver.com', 'post.naver.com', 'in.naver.com', 'm.blog.naver.com',
  'tistory.com', 'brunch.co.kr', 'blog.me', 'egloos.com', 'velog.io', 'medium.com',
  'gangnamunni.com', 'babitalk.com', 'modoodoc.com', 'goodoc.co.kr', 'hidoc.co.kr',
  'sungyesa.com', 'nowdoc.co.kr', '114.co.kr', 'saramin.co.kr', 'jobkorea.co.kr',
  'wanted.co.kr', 'youtube.com', 'instagram.com', 'facebook.com', 'x.com', 'twitter.com',
];

/**
 * 대가성 후기·체험단 신호. 이런 글에 적힌 인스타는 글쓴이(체험단) 계정일 확률이 높다.
 * blog-discovery 의 같은 규칙과 목적이 같지만, 두 모듈은 서로 의존하지 않는다
 * (여기서 정규식을 공유하려고 import 를 만들면 순수 모듈 경계가 깨진다).
 */
const SPONSORED_HINTS =
  /체험단|서포터즈|기자단|협찬|제공받아|제공\s*받아|소정의|원고료|무상\s*제공|내돈내산|공동\s*구매/;

export interface WebDoc {
  readonly title: string;
  readonly description: string;
  readonly link: string;
}

/** 네이버 webkr.json 응답 파싱 (순수 함수). */
export function parseWebSearch(payload: unknown): readonly WebDoc[] {
  if (!payload || typeof payload !== 'object') return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((it): it is Record<string, unknown> => Boolean(it) && typeof it === 'object')
    .map((it) => ({
      title: stripSearchMarkup(String(it.title ?? '')),
      description: stripSearchMarkup(String(it.description ?? '')),
      link: String(it.link ?? '').trim(),
    }));
}

/** URL → 호스트(소문자, www. 제거). 못 읽으면 ''. */
export function hostOf(url: string): string {
  const raw = (url ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * 병원 자기 도메인에서 뽑은 **브랜드 토큰** (순수 함수).
 *
 *   edge1.co.kr    → ['edge']     (@edge__ps 와 이어진다)
 *   vbeauty.co.kr  → ['vbeauty']  (@vbeautyps)
 *   prive.co.kr    → ['prive']    (@priveskin)
 *
 * 끝자리 숫자를 떼고, 일반 명사 라벨(clinic·beauty 등)과 짧은 라벨은 버린다.
 */
export function brandTokensFromHost(host: string | null | undefined): readonly string[] {
  const clean = hostOf(host?.includes('://') ? host : `https://${host ?? ''}`);
  if (!clean) return [];
  const tokens = clean
    .split('.')
    .map((label) => label.replace(/[0-9]+$/, '').toLowerCase())
    .filter((label) => label.length >= MIN_BRAND_TOKEN && !GENERIC_HOST_LABELS.has(label));
  return [...new Set(tokens)];
}

/** 계정 아이디에서 기호를 뺀 형태 — @edge__ps → edgeps. */
function flattenHandle(handle: string): string {
  return (handle ?? '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
}

export interface ClinicSocialContext {
  readonly name: string;
  /** 진단이 확인한 병원 홈페이지 호스트. 없으면 null. */
  readonly siteHost?: string | null;
  /** 진단이 확인한 병원 네이버 블로그 id. 없으면 null. */
  readonly blogId?: string | null;
}

/** 채택 근거 — 강한 순. 화면에는 안 나가지만 정렬·테스트에 쓴다. */
export type AcceptReason = 'owned' | 'brand_token' | 'name_context';

const REASON_WEIGHT: Readonly<Record<AcceptReason, number>> = {
  owned: 3,
  brand_token: 2,
  name_context: 1,
};

/** 이 문서가 병원 **소유**인가 (병원 홈페이지 또는 병원 네이버 블로그). */
export function isOwnedDoc(doc: WebDoc, context: ClinicSocialContext): boolean {
  const host = hostOf(doc.link);
  if (!host) return false;
  const siteHost = hostOf(context.siteHost?.includes('://') ? context.siteHost : `https://${context.siteHost ?? ''}`);
  if (siteHost && (host === siteHost || host.endsWith(`.${siteHost}`))) return true;
  const blogId = (context.blogId ?? '').trim().toLowerCase();
  if (blogId && /(^|\.)blog\.naver\.com$/.test(host)) {
    const path = (() => {
      try {
        return new URL(doc.link).pathname.toLowerCase();
      } catch {
        return '';
      }
    })();
    return path === `/${blogId}` || path.startsWith(`/${blogId}/`);
  }
  return false;
}

/** 제3자 매체인가 (병원 자기 블로그는 isOwnedDoc 에서 이미 걸러진 뒤 본다). */
export function isThirdPartyDoc(doc: WebDoc): boolean {
  const host = hostOf(doc.link);
  if (!host) return true; // 출처를 모르면 근거로 쓰지 않는다
  return THIRD_PARTY_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`));
}

/**
 * 이 문서가 **그 계정의 프로필 페이지 자체**인가.
 *
 * 검색 결과가 "대구엣지성형외과 (@edge__ps) - Instagram" 처럼 계정 페이지 본문일 때,
 * 그 제목에 병원 이름이 있으면 계정 주인이 그 병원이라는 뜻이다. 이 경우는 제3자 매체
 * 규칙(인스타 도메인)에 걸리지 않게 예외로 둔다 — 남이 쓴 글이 아니라 계정 자기 소개다.
 */
function isProfileDocFor(doc: WebDoc, link: SocialLink): boolean {
  const [own] = extractSocialLinks(doc.link);
  return Boolean(own && own.kind === 'channel' && own.platform === link.platform && own.handle === link.handle);
}

/** 문서 텍스트에 병원 이름이 그대로 있는가. */
export function mentionsClinicName(doc: WebDoc, clinicName: string): boolean {
  const text = normalizeClinicName(`${doc.title} ${doc.description}`);
  const full = normalizeClinicName(clinicName);
  const stripped = normalizeClinicName(stripInstitutionSuffix(clinicName));
  if (full.length >= MIN_BRAND_TOKEN && text.includes(full)) return true;
  return stripped.length >= MIN_BRAND_TOKEN && text.includes(stripped);
}

interface Candidate {
  readonly link: SocialLink;
  readonly reason: AcceptReason;
  readonly hits: number;
}

/**
 * 검색 결과에서 **병원 것이라고 볼 수 있는 계정만** 골라낸다 (순수 함수).
 *
 * 판단 순서는 문서 단위다 — 어떤 문서에서 나왔는지가 곧 근거이기 때문이다.
 * 확신이 없으면 버린다. 진단에서 계정 하나를 못 찾는 손해보다,
 * 남의 계정을 원장에게 "원장님 인스타"라고 보여주는 손해가 훨씬 크다.
 */
export function pickSearchedSocialLinks(
  docs: readonly WebDoc[],
  context: ClinicSocialContext,
): readonly SocialLink[] {
  const tokens = brandTokensFromHost(context.siteHost);
  const byKey = new Map<string, Candidate>();

  for (const doc of docs ?? []) {
    const owned = isOwnedDoc(doc, context);
    const rawText = `${doc.title} ${doc.description}`;
    /** 이름 근거의 공통 조건 — 대가성 글이 아니고, 문서에 병원 이름이 그대로 있다. */
    const nameSignal =
      !owned && !SPONSORED_HINTS.test(rawText) && mentionsClinicName(doc, context.name);
    const thirdParty = isThirdPartyDoc(doc);

    const links = extractSocialLinks(`${doc.title} ${doc.description} ${doc.link}`, 'naver_search');
    for (const link of links) {
      if (link.kind !== 'channel') continue;

      const flat = flattenHandle(link.handle);
      const tokenMatch = tokens.some((token) => flat.includes(token));
      // 제3자 매체에 적힌 계정은 글쓴이 것일 수 있다. 단 그 계정의 프로필 페이지 자체는 예외.
      const nameContext = nameSignal && (!thirdParty || isProfileDocFor(doc, link));
      const reason: AcceptReason | null = owned
        ? 'owned'
        : tokenMatch
          ? 'brand_token'
          : nameContext
            ? 'name_context'
            : null;
      if (!reason) continue;

      const key = `${link.platform}|${link.handle}`;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, { link, reason, hits: 1 });
        continue;
      }
      byKey.set(key, {
        link: prev.link,
        reason: REASON_WEIGHT[reason] > REASON_WEIGHT[prev.reason] ? reason : prev.reason,
        hits: prev.hits + 1,
      });
    }
  }

  const ranked = [...byKey.values()].sort(
    (a, b) =>
      REASON_WEIGHT[b.reason] - REASON_WEIGHT[a.reason] ||
      b.hits - a.hits ||
      a.link.handle.localeCompare(b.link.handle),
  );

  const perPlatform = new Map<string, number>();
  const out: SocialLink[] = [];
  for (const candidate of ranked) {
    const used = perPlatform.get(candidate.link.platform) ?? 0;
    if (used >= MAX_ACCEPTED_PER_PLATFORM) continue;
    perPlatform.set(candidate.link.platform, used + 1);
    out.push(candidate.link);
  }
  return out;
}

export interface SearchSocialOptions {
  readonly env?: NaverSearchEnv;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface SearchSocialResult {
  /** 실제로 네이버를 불렀는가 — 화면 문구("어디까지 봤는지")의 근거. */
  readonly called: boolean;
  readonly links: readonly SocialLink[];
}

const EMPTY_RESULT: SearchSocialResult = { called: false, links: [] };

/**
 * 네이버 웹문서 검색 **1회**로 인스타·유튜브 계정을 찾는다.
 * 실패·타임아웃·키 없음은 조용히 빈 결과 — 절대 throw 하지 않는다.
 */
export async function searchSocialAccounts(
  context: ClinicSocialContext,
  options: SearchSocialOptions = {},
): Promise<SearchSocialResult> {
  const env = options.env ?? (process.env as NaverSearchEnv);
  const fetchImpl = options.fetchImpl ?? fetch;
  const clientId = env.NAVER_CLIENT_ID?.trim();
  const clientSecret = env.NAVER_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return EMPTY_RESULT;

  const name = (context.name ?? '').trim();
  if (name.length < 2 || name.length > 60) return EMPTY_RESULT;

  const params = new URLSearchParams({
    query: `${name} 인스타그램`,
    display: String(SOCIAL_SEARCH_DISPLAY),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SOCIAL_SEARCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${NAVER_WEB_SEARCH}?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });
    if (!res.ok) return { called: true, links: [] };
    const docs = parseWebSearch(await res.json());
    return { called: true, links: pickSearchedSocialLinks(docs, context) };
  } catch {
    // 타임아웃·네트워크 실패 — 진단은 계속된다. 못 본 것은 못 봤다고 남긴다.
    return EMPTY_RESULT;
  } finally {
    clearTimeout(timer);
  }
}
