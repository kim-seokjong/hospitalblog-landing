/**
 * 병원명 무료진단 — 파이프라인 공통 타입.
 *
 * 4축(네이버 블로그 · 홈페이지 · AI 인용 · 의료광고법)의 각 축은
 * "확인함 / 확인하지 못함"을 항상 구분해서 담는다. 데이터를 못 구한 자리는
 * null·checked:false 로 남기고 절대 추정값으로 메우지 않는다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

import type { PostSeoResult } from './post-seo.ts';

export type { PostSeoResult };

/* ── 1단계: 병원 특정 ─────────────────────────────────────── */

/**
 * 이 후보를 어디서 찾았는가.
 *
 *  · registry  : 행정안전부 '건강_의원 조회서비스' (정본)
 *  · directory : 심평원 공개자료 기반 자체 명부 (행안부가 죽었을 때의 폴백)
 *
 * ⚠️ 이 필드가 생기기 전에 저장된 리포트에는 없다 — 읽을 때는 항상 `?? 'registry'` 로 폴백한다.
 *    화면에서 출처를 밝히는 데만 쓰고, 판정 로직을 이 값으로 가르지 않는다.
 */
export type ClinicSource = 'registry' | 'directory';

/** 병원 등록자료 1건을 우리 도메인 형태로 정규화한 값 (행안부 또는 폴백 명부). */
export interface ClinicCandidate {
  /**
   * 병원 식별 정본.
   *  · 행안부 관리번호(MNG_NO) — 원천이 registry 일 때
   *  · 'hira:<16hex>'          — 원천이 directory 일 때 (키 공간이 겹치지 않는다)
   * 서버는 접두사만 보고 어느 원천으로 재검증할지 정한다.
   */
  readonly mngNo: string;
  readonly name: string;
  readonly roadAddress: string;
  readonly lotAddress: string;
  /** 주소에서 뽑은 지역(구/군, 없으면 시). 실패 시 ''. */
  readonly region: string;
  /** 시·도 (예: '대구광역시'). 실패 시 ''. */
  readonly province: string;
  /** 진료과목 원문 목록. */
  readonly subjects: readonly string[];
  /** 대표 진료과 — 우리 진료과목 어휘로 매핑. 실패 시 ''. */
  readonly specialty: string;
  /** 기관 종별 (의원 / 치과의원 / 한의원). */
  readonly institutionType: string;
  /** 대표번호. 빈 값일 수 있다(행안부 미기재). */
  readonly phone: string;
  /** 영업/정상 여부 — 폐업·휴업은 false. */
  readonly active: boolean;
  /** 영업상태 표시 문자열 (예: '영업/정상', '폐업'). */
  readonly statusLabel: string;
  /** 개설일 (YYYY-MM-DD). 없으면 ''. */
  readonly openedOn: string;
  /** 폐업일 (YYYY-MM-DD). 없으면 ''. */
  readonly closedOn: string;
  /** 이 후보를 찾은 원천. 구 리포트에는 없다 → 읽을 때 `?? 'registry'`. */
  readonly source?: ClinicSource;
  /** 폴백 명부일 때 자료 기준 시점 (예: '2026Q1'). 화면에 그대로 밝힌다. */
  readonly sourceVersion?: string;
}

export type ClinicLookupOutcome =
  /** 정확히 1건 — 자동 확정 가능. */
  | { readonly kind: 'resolved'; readonly clinic: ClinicCandidate }
  /** 2건 이상 — 사용자가 주소를 보고 고른다. */
  | { readonly kind: 'ambiguous'; readonly candidates: readonly ClinicCandidate[]; readonly truncated: boolean }
  /** 후보 없음. */
  | { readonly kind: 'not_found' }
  /** 후보가 너무 많아 이름만으로는 좁힐 수 없다 — 지역 입력 요청. */
  | { readonly kind: 'needs_region'; readonly candidates: readonly ClinicCandidate[]; readonly totalCount: number }
  /** 영업중 후보는 없고 폐업 등록만 있다. */
  | { readonly kind: 'closed_only'; readonly candidates: readonly ClinicCandidate[] }
  /**
   * 입력한 지역에서는 못 찾았고, **다른 지역**에 같은 이름이 있다.
   * 지역 필터를 조용히 무시하고 타 지역 병원을 보여주면 사용자가 그것을 자기
   * 병원으로 오인한다 — 그래서 별도 종류로 분리해 화면에서 명시한다.
   */
  | {
      readonly kind: 'region_miss';
      /** 사용자가 입력했던 지역. */
      readonly region: string;
      readonly candidates: readonly ClinicCandidate[];
      readonly truncated: boolean;
    }
  /**
   * 행안부 API 를 호출하지 못했다.
   *
   *  · not_configured : 서비스 키가 아예 설정돼 있지 않다
   *  · key_rejected   : 키는 있는데 게이트웨이가 거부했다(만료·미등록 IP·일일 한도 초과)
   *  · fetch_failed   : 네트워크·타임아웃·정체불명 응답
   *
   * ⚠️ 이 셋 중 어느 것도 not_found 로 뭉개면 안 된다. 실제로 키가 거부되던
   *    기간 동안 모든 병원이 "그런 병원 없음"으로 표시돼 아무도 장애를 눈치채지
   *    못했다. "설정 문제"와 "그런 병원이 없다"는 화면에서 반드시 달라야 한다.
   */
  | {
      readonly kind: 'unavailable';
      readonly reason: 'not_configured' | 'key_rejected' | 'fetch_failed';
    };

/* ── 2단계 ①: 네이버 블로그 ──────────────────────────────── */

/** 블로그 추정 후보 1건 — 판단 근거를 그대로 담는다(오탐 설명용). */
export interface BlogGuess {
  readonly blogId: string;
  readonly bloggerName: string;
  /** 검색 결과 중 이 블로그가 차지한 글 수. */
  readonly hits: number;
  /** 병원명이 블로거명에 정확히 들어 있는가 (강한 신호). */
  readonly nameInBloggerName: boolean;
  /** 병원명이 글 제목에 등장한 글 수. */
  readonly titleMentions: number;
  /**
   * 병원이 등록된 지역(구·군 또는 시)이 글 제목·본문 앞부분에 등장한 글 수.
   * ⚠️ 이 필드가 생기기 전에 발급된 공유 리포트에는 없다 — 항상 `?? 0` 으로 읽는다.
   */
  readonly regionMentions?: number;
  /** 병원 진료과가 글 제목·본문 앞부분에 등장한 글 수. (구 리포트에는 없음) */
  readonly specialtyMentions?: number;
  /** 0~100. 확신도. */
  readonly confidence: number;
}

export type BlogResolution =
  /** 확신 임계값을 넘은 단일 후보 — 블로거명에 병원명이 들어 있는 강한 신호까지 있다. */
  | { readonly kind: 'confident'; readonly guess: BlogGuess }
  /**
   * 확신까지는 아니지만 **1위 후보로 일단 진단을 진행**한 상태.
   *
   * ★ 왜 만들었나. 사용자는 이미 병원을 한 번 골랐다. 거기서 블로그까지 또 고르라고
   *   흐름을 끊으면 진단을 못 본 채 이탈한다("왜 또 고르지?" — 대표 실사용 지적).
   *   대신 **어느 블로그를 썼는지 결과 맨 위에 눈에 띄게 표시**하고 언제든 바꾸게 한다.
   */
  | {
      readonly kind: 'assumed';
      readonly guess: BlogGuess;
      /** 바꿔 고를 수 있는 후보 전체(1위 포함). */
      readonly guesses: readonly BlogGuess[];
      /** 2위와 점수 차가 작았는가 — "비슷한 후보가 하나 더 있었습니다" 표기용. */
      readonly close: boolean;
    }
  /** 후보는 있으나 이름 신호가 아예 없다 — 사용자가 고르거나 직접 입력. */
  | { readonly kind: 'uncertain'; readonly guesses: readonly BlogGuess[] }
  /** 후보 없음. */
  | { readonly kind: 'none' }
  /** 네이버 검색 API 미설정·실패. */
  | { readonly kind: 'unavailable' };

export interface BlogAxis {
  /** 이 축을 실제로 측정했는가. false 면 아래 값들은 전부 의미 없음. */
  readonly checked: boolean;
  /** 추정 경로 — 'auto' 자동 탐색, 'manual' 사용자가 직접 입력. */
  readonly source: 'auto' | 'manual' | null;
  readonly resolution: BlogResolution;
  /** 확정된 블로그 ID (확신 or 직접 입력). */
  readonly blogId: string | null;
  readonly blogTitle: string | null;
  /** 수집한 최근 글 수 (RSS 최대 50). */
  readonly postCount: number | null;
  /** 최근 발행일 ISO. */
  readonly latestPostAt: string | null;
  /** 마지막 발행 이후 경과 일수. */
  readonly daysSinceLatest: number | null;
  /** 최근 12주 주당 발행 편수. */
  readonly postsPerWeek: number | null;
  /** 키워드별 노출 실측. */
  readonly keywords: readonly KeywordRank[];
  /** 노출 실측을 실제로 수행했는가 (네이버 오픈API 가용 여부). */
  readonly rankChecked: boolean;
  /**
   * 최근 글 검색 최적화 점검 결과 (post-seo.ts).
   * 수집한 글이 없거나 점검을 못 했으면 null.
   * ⚠️ 이 필드가 생기기 전에 저장된 리포트에는 없을 수 있어 항상 null 체크한다.
   */
  readonly postSeo: PostSeoResult | null;
}

export interface KeywordRank {
  readonly keyword: string;
  /** 네이버 블로그 검색 API 상 순위(1~100). 미노출이면 null. */
  readonly apiRank: number | null;
  /** 총 문서수. 조회 실패 시 null. */
  readonly docCount: number | null;
}

/* ── 2단계 ②: 홈페이지 ───────────────────────────────────── */

export type SiteCheckState = 'pass' | 'fail' | 'unknown';

export interface SiteAxis {
  readonly checked: boolean;
  readonly source: 'naver' | 'manual' | null;
  /** 진단 대상 URL (정규화 완료). */
  readonly url: string | null;
  /** 최종 응답 URL (리다이렉트 후). */
  readonly finalUrl: string | null;
  /** HTTPS 로 정상 응답했는가. */
  readonly https: SiteCheckState;
  /** HTTPS 실패 사유 (TLS 핸드셰이크 실패 등). */
  readonly httpsNote: string | null;
  readonly httpStatus: number | null;
  readonly title: string | null;
  readonly metaDescription: SiteCheckState;
  readonly openGraph: SiteCheckState;
  readonly viewport: SiteCheckState;
  readonly jsonLd: SiteCheckState;
  /** 감지된 JSON-LD @type 목록. */
  readonly jsonLdTypes: readonly string[];
  readonly robotsTxt: SiteCheckState;
  readonly sitemapXml: SiteCheckState;
  /** robots.txt 가 AI 크롤러를 차단하는가. blocked=차단, allowed=허용. */
  readonly aiCrawler: 'allowed' | 'blocked' | 'unknown';
  /** 차단된 AI 크롤러 UA 목록. */
  readonly blockedAiBots: readonly string[];
  /**
   * 홈페이지 HTML 에서 찾은 인스타·유튜브 링크.
   *
   * ★ 이미 받아 둔 그 HTML 에서 뽑는다 — **추가 요청을 만들지 않는다.**
   * ⚠️ 이 필드가 생기기 전에 저장된 리포트에는 없다 → 항상 `?? []` 로 읽는다.
   */
  readonly socialLinks?: readonly SocialLink[];
}

/* ── 2단계 ⑤: 인스타 · 유튜브 (링크 탐지) ─────────────────── */

export type SocialPlatform = 'instagram' | 'youtube';

/**
 * 판정 3값 — **not_found 를 '없음'으로 읽지 않는다.**
 *
 *  found     : 계정·채널 링크를 실제로 찾았다
 *  not_found : 우리가 본 범위(홈페이지·블로그)에서 **확인되지 않았다**
 *              → 운영 중인데 링크만 없을 수 있다. 화면 문구는 언제나 '확인되지 않음'.
 *  unknown   : 볼 자료 자체를 못 구했다(홈페이지도 블로그도 확보 실패)
 */
export type SocialPresence = 'found' | 'not_found' | 'unknown';

/**
 * 이 계정을 **어디서 찾았는가** — 오탐 추적의 유일한 단서다.
 *
 * site         : 홈페이지 HTML 에 걸린 링크
 * blog         : 블로그 글 본문·요약에 적힌 주소
 * naver_search : 네이버 웹문서 검색에서 찾음 (링크가 안 걸린 병원용 우회로)
 * youtube_api  : 유튜브 공식 검색 API(search.list)에서 찾음
 *
 * ⚠️ 이 필드가 생기기 전에 저장된 리포트에는 없다 → 항상 옵셔널로 읽는다.
 */
export type SocialSource = 'site' | 'blog' | 'naver_search' | 'youtube_api';

export interface SocialLink {
  readonly platform: SocialPlatform;
  /**
   * channel : 계정·채널 주소 (instagram.com/handle, youtube.com/@handle 등)
   * content : 게시물·영상 주소 (instagram.com/p/…, youtu.be/… )
   *           → 남의 영상이 임베드된 것일 수 있어 **운영 근거로 쓰지 않는다**.
   */
  readonly kind: 'channel' | 'content';
  /** 계정 이름. content 링크에는 없다(''). */
  readonly handle: string;
  readonly url: string;
  /** 근거 출처. 옛 리포트에는 없다. */
  readonly source?: SocialSource;
  /**
   * 유튜브 채널의 최근 업로드 시각(ISO). 확인 못 했으면 null·없음.
   * ★ "채널만 있고 3년째 안 올림"과 "주 1회 올림"은 영업에서 완전히 다른 말이다.
   */
  readonly lastUploadAt?: string | null;
  /** 진단 시점 기준 최근 업로드 경과일. 확인 못 했으면 null·없음. */
  readonly daysSinceUpload?: number | null;
}

export interface SocialAxis {
  /** 링크를 찾아볼 자료를 실제로 확보했는가. false 면 아래 판정은 전부 unknown. */
  readonly checked: boolean;
  readonly instagram: SocialPresence;
  readonly youtube: SocialPresence;
  readonly links: readonly SocialLink[];
  /** 홈페이지 HTML 을 실제로 봤는가 — "어디까지 봤는지" 문구의 근거. */
  readonly scannedSite: boolean;
  /** 블로그 글 본문·요약을 실제로 봤는가. */
  readonly scannedBlog: boolean;
  /**
   * 네이버 웹문서 검색까지 돌려 봤는가.
   * 홈페이지·블로그에서 인스타 계정을 못 찾았을 때만 true 다(1회 한정).
   * ⚠️ 옵셔널 — 이 경로가 생기기 전 리포트에는 없다.
   */
  readonly searchedNaver?: boolean;
  /** 유튜브 공식 API 를 실제로 호출했는가(키가 있을 때만 true). */
  readonly searchedYoutube?: boolean;
}

/* ── 2단계 ⑥: 네이버 플레이스 ─────────────────────────────── */

export type { PlaceRank, PlaceRankState, PlaceScopeKind } from './place.ts';

/**
 * 플레이스 축.
 *
 * ⚠️ 나중에 추가된 축이라 **저장된 옛 리포트에는 없다** — 읽을 때 항상 옵셔널로 다룬다.
 * ⚠️ 순위는 **상위 5개까지만** 볼 수 있다(서버 렌더 HTML 한계). 그 밖은 순위 숫자가
 *    아니라 `outside_top` 이며, 확인 실패(`unchecked`)와 절대 뭉개지 않는다.
 */
export interface PlaceAxis {
  readonly checked: boolean;
  /**
   * 플레이스에 등록돼 있는가.
   *  found     : 병원명으로 찾았다
   *  not_found : 우리가 본 범위에서 확인되지 않았다 (등록돼 있는데 이름이 다를 수도 있다)
   *  unknown   : 조회 자체를 못 했다
   */
  readonly presence: 'found' | 'not_found' | 'unknown';
  /** 네이버 플레이스 id. 못 찾았으면 null. */
  readonly placeId: string | null;
  readonly placeName: string | null;
  /** 플레이스 업종 (예: '치과'). */
  readonly category: string | null;
  /** 업주가 직접 등록한 키워드 원문 — 화면에 그대로 보여준다. */
  readonly registeredKeywords: readonly string[];
  /** 순위를 실제로 재 본 키워드(업종 + 정제된 등록 키워드). */
  readonly measuredKeywords: readonly string[];
  /** 지역 3단계 × 키워드 조합의 노출 결과. */
  readonly ranks: readonly PlaceRankRow[];
  /** 순위 측정을 실제로 수행했는가. */
  readonly rankChecked: boolean;
  /** 상위 몇 위까지 볼 수 있었는가 — 화면에 그대로 밝힌다. */
  readonly topN: number;
}

export interface PlaceRankRow {
  readonly keyword: string;
  readonly scope: 'dong' | 'gu' | 'city';
  readonly region: string;
  readonly query: string;
  readonly state: 'ranked' | 'outside_top' | 'unchecked';
  readonly rank: number | null;
}

/* ── 2단계 ③: AI 인용 ────────────────────────────────────── */

/** 인용 경로 — 이 진단에서 가장 설득력 있는 구분. */
export type CitationPath =
  /** 병원 자기 자산(블로그·홈페이지)이 근거로 잡혔다. */
  | 'owned'
  /** 디렉터리·포털 등 제3자 문서를 통해 언급됐다. */
  | 'directory'
  /** 이름만 언급되고 출처를 특정하지 못했다. */
  | 'name_only'
  /** 언급 자체가 없다. */
  | 'none';

/**
 * 질의 종류 — **이 진단에서 가장 중요한 구분**이다.
 *
 * named     : 병원 이름을 넣고 물었다 ("대구 수성구 하이업성형외과의원 어떤 병원이야?")
 *             → 나오는 게 기본이다. 나왔다고 성과가 아니다.
 *             안 나오면 심각하다(AI 가 병원 존재 자체를 모른다).
 * recommend : 이름 없이 지역+진료과로만 물었다 ("대구 수성구 성형외과 추천해줘")
 *             → **환자가 실제로 하는 검색이다. 종합 판정은 이것만으로 한다.**
 *
 * 실측에서 이 구분이 없어 "6개 중 2개 등장 → 잘하고 있어요"가 나갔는데,
 * 그 2개는 전부 병원 이름을 넣은 질의였고 추천 질의 4개는 전부 미등장이었다.
 */
export type CitationQueryKind = 'named' | 'recommend';

export interface CitationProbe {
  readonly question: string;
  readonly kind: CitationQueryKind;
  readonly engine: string;
  readonly mentioned: boolean;
  readonly path: CitationPath;
  /** 근거 발췌 (새니타이즈 완료). 미언급 시 null. */
  readonly evidence: string | null;
  /** 자기 자산으로 인정된 출처 URL. */
  readonly ownedSources: readonly string[];
  /** 제3자 출처 호스트 목록. */
  readonly thirdPartyHosts: readonly string[];
}

/**
 * 같은 질문을 여러 엔진에 돌린 결과를 **질문 하나로 묶은** 것 — 판정의 정본 단위.
 *
 * ★ 왜 질문 단위인가.
 *   질의 3개를 엔진 2곳에 돌리면 프로브는 6건이 된다. 그 6건을 그대로 분모로 쓰면
 *   "6번 중 4번(67%) 등장 → 잘하고 있어요"가 나오는데, 질문별로 보면 한 표현에서는
 *   아예 안 나오는 상태였다. 원장에게 의미 있는 단위는 "환자가 하는 질문"이지
 *   "우리가 돌린 엔진 호출"이 아니다. 엔진 호출 수를 분모로 쓰면 실제보다 좋게 보인다.
 *
 * 환자는 엔진을 가려 쓰지 않으므로 **어느 엔진에서든 나오면 그 질문은 등장**으로 본다.
 * 다만 한쪽 엔진에서만 나오는 상태는 불안정하므로 그 사실을 따로 드러낸다.
 */
export interface CitationQuestionResult {
  readonly question: string;
  readonly kind: CitationQueryKind;
  /** 이 질문을 실제로 물어본 엔진 수. */
  readonly engineTotal: number;
  /** 그중 병원 이름이 나온 엔진 수. */
  readonly engineMentioned: number;
  /** 어느 엔진에서든 나왔는가 — **질문 단위 판정값**. */
  readonly mentioned: boolean;
  /** 이 질문에서 AI가 참고한 근거 (자기 자산 > 디렉터리 > 출처없음 순으로 대표값). */
  readonly path: CitationPath;
  /** 병원이 나온 엔진 목록. */
  readonly mentionedEngines: readonly string[];
  /** 병원이 나오지 않은 엔진 목록 — 엔진 편차 설명용. */
  readonly missingEngines: readonly string[];
  /** 이 질문에서 근거로 잡힌 제3자 출처 호스트(합집합). */
  readonly thirdPartyHosts: readonly string[];
  /** 근거 발췌 하나 (새니타이즈 완료). 없으면 null. */
  readonly evidence: string | null;
}

export interface AiAxis {
  readonly checked: boolean;
  /** 미측정 사유. */
  readonly skippedReason: 'not_configured' | 'budget' | null;
  readonly probes: readonly CitationProbe[];
  /** 프로브를 질문 단위로 묶은 결과 — **판정과 문구는 전부 여기서 나온다**. */
  readonly questions: readonly CitationQuestionResult[];
  /** 추천 질문 수 — **종합 판정의 분모**(엔진 호출 수가 아니다). */
  readonly recommendQuestionTotal: number;
  /** 그중 어느 엔진에서든 병원이 등장한 질문 수 — **종합 판정의 분자**. */
  readonly recommendQuestionMentioned: number;
  /** 엔진에 따라 결과가 갈린 질문 수 (한쪽에서만 등장) — 불안정 신호. */
  readonly recommendQuestionSplit: number;
  readonly mentionedCount: number;
  readonly ownedCount: number;
  readonly directoryCount: number;
  /** 추천 질의 엔진 호출 수 — 원자료. **판정에 쓰지 않는다.** */
  readonly recommendTotal: number;
  /** 그중 병원 이름이 등장한 호출 수 — 원자료. **판정에 쓰지 않는다.** */
  readonly recommendMentioned: number;
  /** 이름 확인 질의 수 — 배경 사실용(성과 지표 아님). */
  readonly namedTotal: number;
  readonly namedMentioned: number;
  /** 실제 발생한 HTTP 시도 수 (비용 산정 정본). */
  readonly httpAttempts: number;
}

/* ── 2단계 ④: 의료광고법 ─────────────────────────────────── */

/**
 * 검출 1건의 위험 등급 — **모든 지적을 같은 무게로 늘어놓지 않기 위한 구분**.
 *
 * prohibited : 의료법이 광고에서 **명시적으로 금지한 유형**에 해당하는 표현.
 *              (환자 후기·치료경험담 / 치료 전후 비교 사진 / 치료효과 보장·부작용 없음 단정 /
 *               다른 의료기관과의 비교·비방)
 *              → 화면에서 빨간 "위험" 배지로 앞세운다.
 * caution    : 심의에서 자주 지적되지만 **문맥에 따라 갈리는** 표현.
 *              (최상급 표현, "최신" 주장, 유명인 언급, 이벤트·가격 유인 등)
 *              → 기존 톤 그대로.
 *
 * ⚠️ prohibited 라 해도 **"위반입니다"라고 단정하지 않는다.** 우리는 심의기관이 아니다.
 *    "의료법이 명시적으로 금지한 유형입니다"까지가 우리가 말할 수 있는 한계다.
 */
export type ComplianceRisk = 'prohibited' | 'caution';

/** 검출 단어가 어디에 있었는가 — 제목인지 본문인지에 따라 원장의 판단이 달라진다. */
export type ComplianceExcerptWhere = 'title' | 'lead' | 'body';

/**
 * 검출 단어가 **실제로 걸린 문장** — 진단 신뢰의 핵심.
 *
 * ★ 왜 필요한가(실측 근거).
 *   프라이브성형외과 진단에서 "위험 — 환자 후기·치료경험담" 9편이 떴는데, 열어 보니
 *   "후기가 많으면 믿을 만한 걸까?"·"'후기'를 그대로 믿고 병원을 고르시는 일입니다"처럼
 *   **후기를 믿지 말라는 정보성 문장**이었다. 화면에는 글 제목과 단어만 있었으니
 *   원장은 "제목엔 후기가 없는데 왜 위험이냐"고 물을 수밖에 없었고, 글을 열어보는
 *   순간 오탐임을 알게 된다 — 진단 전체의 신뢰가 거기서 무너진다.
 *
 * 그래서 **걸린 문장을 그대로 보여준다.** 원장이 스스로 판단할 수 있어야 한다.
 *
 * ⚠️ 개인정보·본문 유출 방지: before/after 는 각각 상한 길이로 자르고
 *    이메일·전화번호 형태는 마스킹한다(compliance-scan.ts).
 * ⚠️ 이 필드가 생기기 전에 저장된 리포트에는 없다 — 화면은 반드시 제목만 보여주는
 *    폴백을 유지한다(없다고 깨지면 안 된다).
 */
export interface ComplianceExcerpt {
  /** 검출 단어 앞 문맥 (상한 길이로 자름). */
  readonly before: string;
  /** 검출 단어 원문 그대로 — 화면에서 강조한다. */
  readonly match: string;
  /** 검출 단어 뒤 문맥 (상한 길이로 자름). */
  readonly after: string;
  readonly where: ComplianceExcerptWhere;
  /** 앞이 잘렸는가 — 화면에서 말줄임표를 붙인다. */
  readonly clippedBefore: boolean;
  /** 뒤가 잘렸는가. */
  readonly clippedAfter: boolean;
}

export interface ComplianceHit {
  readonly postTitle: string;
  readonly postLink: string;
  /** 지적 표현 (원문에서 검출된 문자열). */
  readonly phrase: string;
  /** 심의에서 자주 지적되는 이유. */
  readonly note: string;
  readonly level: 'review' | 'caution';
  /** 실제로 걸린 문장. 구 리포트·문장 패턴 검출에는 없다(제목만 보여주는 폴백). */
  readonly excerpt?: ComplianceExcerpt;
  /**
   * 위험 등급. ⚠️ 이 필드가 생기기 전에 발급된 공유 리포트에는 없다 —
   * 읽을 때는 반드시 `hit.risk ?? 'caution'` 로 폴백한다(없는 것을 위험으로 올리지 않는다).
   */
  readonly risk?: ComplianceRisk;
  /** 어떤 금지 유형인가 (prohibited 일 때만). 예: '환자 후기·치료경험담'. */
  readonly riskLabel?: string;
}

export interface ComplianceAxis {
  readonly checked: boolean;
  /** 검사한 글 편수 (제목 전체 + 본문 수집분). */
  readonly postsScanned: number;
  /** 본문 전문까지 확보한 편수. */
  readonly bodiesScanned: number;
  /** 본문 앞부분(RSS 요약)까지만 확보한 편수 — 나머지는 제목만 봤다. */
  readonly summariesScanned: number;
  readonly hits: readonly ComplianceHit[];
  /** 검출된 글 수. */
  readonly postsWithHits: number;
  /**
   * 위험(명시적 금지 유형) 검출 건수 — **표시 상한(MAX_HITS)에 잘리기 전 전체 수**.
   * 구 리포트에는 없으므로 화면·판정에서는 hits 로 폴백한다.
   */
  readonly prohibitedCount?: number;
  /** 주의 검출 건수 (상한 이전 전체 수). 구 리포트에는 없음. */
  readonly cautionCount?: number;
  /** 위험 검출이 있는 글 수. 구 리포트에는 없음. */
  readonly postsWithProhibited?: number;
}

/* ── 3단계: 결과 카드 ────────────────────────────────────── */

export type FindingTone = 'good' | 'warn' | 'unknown';

/**
 * 결과 화면의 3분류 — 축(블로그/홈페이지/AI/의료광고법)이 아니라 **원장이 할 판단**으로 나눈다.
 *
 * bad     : 지금 고쳐야 할 것 — 지금 손해를 보고 있거나 리스크를 지고 있는 것 (맨 위, 가장 크게)
 * improve : 챙기면 좋을 것 — 해두면 나아지는 것
 * good    : 잘하고 있는 것 — 이미 되고 있는 것 (짧게, 접어도 됨)
 * unknown : 확인하지 못한 것
 *
 * ⚠️ 화면 문구는 `FINDING_GROUP_LABEL`(findings.ts) 한 곳에서만 정한다.
 *    내부 식별자(bad/improve/good)는 저장된 리포트 호환을 위해 그대로 둔다.
 */
export type FindingGroup = 'bad' | 'improve' | 'good' | 'unknown';

/**
 * 접어두기(details) 안에 넣는 세부 점검 항목.
 * 기본 화면에는 보이지 않는다 — 원장이 알 필요 없는 기술 용어를 앞에 세우지 않기 위해.
 */
export interface FindingDetail {
  readonly label: string;
  /** true=갖춰짐, false=빠짐, null=확인 못 함. */
  readonly ok: boolean | null;
  /** 이게 뭔지 한 줄 쉬운 말. */
  readonly hint: string;
}

/** 결과 카드에서 실제로 클릭해 열어볼 수 있는 주소(홈페이지·블로그). */
export interface FindingLink {
  readonly href: string;
  /** 화면에 보일 문자열 (스킴 없이 짧게). */
  readonly label: string;
  /** https 가 아닌 주소인가 — 화면에 그 사실을 표시한다. */
  readonly insecure: boolean;
}

/**
 * 결과 화면의 최소 단위.
 * 항목마다 "지금 상태(사실) / 왜 문제인가 / 그래서 뭘 해야 하나"가 반드시 붙는다.
 */
export interface Finding {
  readonly id: string;
  /**
   * ⚠️ 'social' 은 나중에 추가된 축이다. 저장된 옛 리포트에는 없고, 화면은 모르는
   *    축이 섞여 있어도 버리지 않고 맨 뒤에 붙인다(groupFindingsByChannel).
   */
  readonly axis: 'blog' | 'site' | 'ai' | 'compliance' | 'social' | 'place';
  readonly label: string;
  readonly tone: FindingTone;
  /** ① 지금 상태 — 사실·수치만. */
  readonly state: string;
  /** ② 왜 문제인가 — 한 줄, 원장 언어. tone==='good' 이면 null. */
  readonly why: string | null;
  /** ③ 그래서 뭘 해야 하나 — 구체적 행동. */
  readonly action: string;
  /**
   * 이 행동을 닥터포스트로 해결할 수 있는가.
   * false 인 항목(홈페이지 TLS·robots 등)을 반드시 섞어 광고로 읽히지 않게 한다.
   */
  readonly ourScope: boolean;
  /** 클릭해서 열어볼 주소. 없으면 생략. */
  readonly link?: FindingLink;
  /** 접어두기 안에 넣을 세부 항목. 기본 화면에는 안 보인다. */
  readonly details?: readonly FindingDetail[];
}

export interface DiagnosisReport {
  readonly version: 1;
  readonly runAt: string;
  readonly clinic: ClinicCandidate;
  readonly blog: BlogAxis;
  readonly site: SiteAxis;
  readonly ai: AiAxis;
  readonly compliance: ComplianceAxis;
  /**
   * 인스타·유튜브 링크 탐지.
   * ⚠️ 나중에 추가된 축이라 **저장된 옛 리포트에는 없다** — 읽을 때 항상 옵셔널로 다룬다.
   */
  readonly social?: SocialAxis;
  /**
   * 네이버 플레이스 — 등록·등록 키워드·지역 3단계 노출.
   * ⚠️ 나중에 추가된 축이라 저장된 옛 리포트에는 없다 — 항상 옵셔널로 읽는다.
   */
  readonly place?: PlaceAxis;
  readonly findings: readonly Finding[];
  /** 확인하지 못한 축 이름 목록 — 화면에 그대로 표기한다. */
  readonly unchecked: readonly string[];
}
