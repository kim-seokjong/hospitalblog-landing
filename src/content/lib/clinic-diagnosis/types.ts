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

/** 행안부 '건강_의원 조회서비스' 1건을 우리 도메인 형태로 정규화한 값. */
export interface ClinicCandidate {
  /** 행안부 관리번호(MNG_NO) — 후보 확정 키. */
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
  /** 0~100. 확신도. */
  readonly confidence: number;
}

export type BlogResolution =
  /** 확신 임계값을 넘은 단일 후보. */
  | { readonly kind: 'confident'; readonly guess: BlogGuess }
  /** 후보는 있으나 확신 부족 — 사용자가 고르거나 직접 입력. */
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

export interface AiAxis {
  readonly checked: boolean;
  /** 미측정 사유. */
  readonly skippedReason: 'not_configured' | 'budget' | null;
  readonly probes: readonly CitationProbe[];
  readonly mentionedCount: number;
  readonly ownedCount: number;
  readonly directoryCount: number;
  /** 추천 질의(이름 없이 지역+진료과) 수 — **종합 판정의 분모**. */
  readonly recommendTotal: number;
  /** 그중 병원 이름이 등장한 수 — **종합 판정의 분자**. */
  readonly recommendMentioned: number;
  /** 이름 확인 질의 수 — 배경 사실용(성과 지표 아님). */
  readonly namedTotal: number;
  readonly namedMentioned: number;
  /** 실제 발생한 HTTP 시도 수 (비용 산정 정본). */
  readonly httpAttempts: number;
}

/* ── 2단계 ④: 의료광고법 ─────────────────────────────────── */

export interface ComplianceHit {
  readonly postTitle: string;
  readonly postLink: string;
  /** 지적 표현 (원문에서 검출된 문자열). */
  readonly phrase: string;
  /** 심의에서 자주 지적되는 이유. */
  readonly note: string;
  readonly level: 'review' | 'caution';
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
}

/* ── 3단계: 결과 카드 ────────────────────────────────────── */

export type FindingTone = 'good' | 'warn' | 'unknown';

/**
 * 결과 화면의 3분류 — 축(블로그/홈페이지/AI/의료광고법)이 아니라 **원장이 할 판단**으로 나눈다.
 *
 * bad     : 못된 점 — 지금 손해를 보고 있는 것 (맨 위, 가장 크게)
 * improve : 개선할 점 — 해두면 나아지는 것
 * good    : 잘된 점 — 이미 되고 있는 것 (짧게, 접어도 됨)
 * unknown : 확인 못 한 것
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
  readonly axis: 'blog' | 'site' | 'ai' | 'compliance';
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
  readonly findings: readonly Finding[];
  /** 확인하지 못한 축 이름 목록 — 화면에 그대로 표기한다. */
  readonly unchecked: readonly string[];
}
