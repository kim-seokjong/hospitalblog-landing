import { complianceRiskCounts } from './compliance-scan.ts';
import { groupFindings, LEGACY_COMPLIANCE_RISK_ID } from './findings.ts';
import type { DiagnosisReport, Finding } from './types.ts';

/**
 * 진단 결과 → 닥터포스트 전환 동선 (규칙 기반 순수 함수, LLM 호출 없음).
 *
 * ★ 이 모듈이 지켜야 할 선
 *   진단의 신뢰가 이 도구의 전부다. 여기서 파는 문장을 길게 쓰면 앞의 진단까지
 *   광고로 읽히고, 그러면 진단을 아무리 정확하게 해도 소용이 없다. 그래서:
 *
 *   ① **닥터포스트가 실제로 하는 것만 쓴다.** 홈페이지 SSL·robots 수리처럼 우리가
 *      안 하는 항목에는 아무 줄도 붙이지 않는다(DOCTORPOST_SCOPE 에 아예 없다).
 *   ② **한 줄이다.** 항목마다 붙는 문장은 "닥터포스트는 X 를 한다" 한 문장뿐이고
 *      효과·성과를 약속하지 않는다.
 *   ③ **경고 항목에만 붙인다.** 잘하고 있는 항목(good)·확인 못 한 항목(unknown)에
 *      영업 문구를 붙이면 진단이 아니라 판촉이 된다.
 *   ④ **ourScope 와 이중 게이트.** findings.ts 가 이미 항목별로 "우리 범위인가"를
 *      들고 있다(ourScope). 여기 표에 있어도 ourScope 가 false 면 붙이지 않는다 —
 *      같은 id 라도 상황에 따라 우리 범위가 아닐 수 있기 때문이다
 *      (예: blog.cadence 는 발행량이 충분하면 ourScope=false).
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

/**
 * 항목별 "닥터포스트가 이걸 한다" 한 줄.
 *
 * ⚠️ 여기에 없는 항목에는 아무 줄도 붙지 않는다. 추가할 때는 저장소에 그 기능이
 *    실제로 있는지 먼저 확인한다(근거 경로를 주석에 남긴다).
 *
 * 근거:
 *  · 글 생성·네이버 발행       — /api/generate-content, /api/publish-naver
 *  · 키워드 추천              — /api/keywords, /api/keyword-volume, /api/recommendations
 *  · 검색 규격(제목·소제목·태그) — generate-content 의 SEO 구조 지시 + /api/generate-tags
 *  · 의료광고법 발행 전 점검    — medical-compliance(키워드) + medical-compliance-ai(AI 심의)
 *  · 자체 도메인 병원 블로그    — clinic-site ({slug}.hospitalblog.kr, 마이그 043·052)
 */
export const DOCTORPOST_SCOPE: Readonly<Record<string, string>> = {
  'blog.exists':
    '닥터포스트는 병원 블로그에 올릴 글을 만들고 네이버 발행까지 한 번에 처리합니다.',
  'blog.freshness':
    '닥터포스트는 발행 계획을 잡아 글이 끊기지 않게 채웁니다.',
  'blog.cadence':
    '닥터포스트는 발행 계획을 잡아 주당 편수를 맞춰 갑니다.',
  'blog.rank':
    '닥터포스트는 경쟁 문서 수와 검색량을 실제로 조회해 노려볼 키워드를 추천합니다.',
  'blog.postSeo':
    '닥터포스트는 글을 만들 때 제목·소제목·태그 구조를 검색 규격에 맞춰 잡습니다.',
  'compliance.prohibited':
    '닥터포스트는 이 표현 점검을 발행 전에 자동으로 합니다.',
  'compliance.risk':
    '닥터포스트는 이 표현 점검을 발행 전에 자동으로 합니다.',
  'ai.presence':
    '닥터포스트는 병원 이름으로 된 자체 도메인 블로그를 만들어 AI가 읽을 근거를 쌓습니다.',
  'ai.presence.partial':
    '닥터포스트는 환자가 실제로 쓰는 표현을 제목으로 잡아 글을 쌓습니다.',
  'ai.known':
    '닥터포스트는 병원명·진료과·위치가 함께 들어간 소개 글을 병원 이름으로 쌓습니다.',
  'ai.path':
    '닥터포스트는 병원 이름으로 된 자체 도메인 블로그를 만들어, 외부 목록 대신 병원 글이 근거로 잡히게 합니다.',
};

/**
 * 이 항목에 붙일 "닥터포스트가 이걸 한다" 한 줄. 없으면 null(=화면에 아무것도 안 붙는다).
 *
 * 게이트는 셋 다 통과해야 한다: 경고 항목 + ourScope + 표에 등재.
 */
export function doctorpostLine(finding: Finding): string | null {
  if (finding.tone !== 'warn') return null;
  if (finding.ourScope !== true) return null;
  return DOCTORPOST_SCOPE[finding.id] ?? null;
}

/** 닥터포스트가 대신할 수 있는 경고 항목 수. */
export function countDoctorpostScope(findings: readonly Finding[]): number {
  return findings.reduce((n, f) => (doctorpostLine(f) === null ? n : n + 1), 0);
}

/* ── 결과 맨 아래 전환 문구 ──────────────────────────────── */

export interface ConversionCta {
  /** 버튼 문구 — **원장이 방금 본 자기 숫자**가 들어간다. */
  readonly headline: string;
  /** 버튼 위 한 줄 요약 — "N건 중 M건은 닥터포스트가 대신합니다". */
  readonly sub: string;
  /** 문구를 뽑아낸 근거 항목 id. 없으면 null(기본 문구). */
  readonly basis: string | null;
  /** 지금 고쳐야 할 것 건수. */
  readonly badCount: number;
  /** 그중 닥터포스트가 대신하는 건수. */
  readonly badScopeCount: number;
}

/* ── 저장된 옛 리포트 방어 ───────────────────────────────────
 *
 * ★ 이 모듈은 **DB 에 저장된 리포트**로도 호출된다(`/clinic-check/r/[token]`).
 *   저장 시점의 형태가 지금 타입과 다를 수 있고(축·배열이 통째로 없는 옛 행),
 *   그 자리에서 예외가 나면 **이미 메일·전화로 나간 링크가 500 으로 죽는다.**
 *   그래서 리포트 필드는 타입을 믿지 않고 값으로 확인한다.
 */

function arrayOf<T>(value: readonly T[] | undefined | null): readonly T[] {
  return Array.isArray(value) ? value : [];
}

function numberOf(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 값이 없어 숫자를 못 넣을 때의 무난한 기본 문구 — 과장 없이. */
export const FALLBACK_CTA_HEADLINE = '무료 2편으로 먼저 만들어 보기';
const FALLBACK_CTA_SUB = '가입하면 글 2편을 무료로 만들어 볼 수 있어요. 결제 정보는 받지 않습니다.';

/**
 * 근거 항목 → 버튼 문구. 리포트에서 실제 값을 뽑아 쓰고, 값이 없으면 null 을
 * 돌려 다음 후보로 넘어간다(숫자 없는 자리에 "0일"·"undefined" 가 박히지 않게).
 */
function headlineFor(finding: Finding, report: DiagnosisReport): string | null {
  switch (finding.id) {
    case 'blog.freshness': {
      const days = numberOf(report.blog?.daysSinceLatest);
      return days !== null && days > 0 ? `${days}일 밀린 글, 이번 주부터 채우기` : null;
    }
    case 'compliance.prohibited': {
      const prohibited = report.compliance ? complianceRiskCounts(report.compliance).prohibited : 0;
      return prohibited > 0 ? `위험 표현 ${prohibited}건, 발행 전에 자동으로 걸러내기` : null;
    }
    case LEGACY_COMPLIANCE_RISK_ID:
    case 'compliance.risk': {
      const total = arrayOf(report.compliance?.hits).length;
      return total > 0 ? `지적 소지 ${total}건, 발행 전에 자동으로 걸러내기` : null;
    }
    case 'ai.presence': {
      const total = numberOf(report.ai?.recommendQuestionTotal) ?? 0;
      return total > 0 ? `AI 추천 질문 ${total}개 전부 미등장, 근거부터 쌓기` : null;
    }
    case 'ai.presence.partial': {
      const total = numberOf(report.ai?.recommendQuestionTotal) ?? 0;
      const hit = numberOf(report.ai?.recommendQuestionMentioned) ?? 0;
      return total > 0 && hit < total ? `AI 추천 질문 ${total}개 중 ${total - hit}개 미등장, 그 표현부터 채우기` : null;
    }
    case 'ai.known':
      return 'AI가 모르는 병원, 이름부터 알리기';
    case 'blog.rank': {
      const checked = arrayOf(report.blog?.keywords).length;
      return checked > 0 ? `키워드 ${checked}개 중 상위권 0개, 잡을 키워드부터 받기` : null;
    }
    case 'blog.postSeo': {
      const missing = numberOf(report.blog?.postSeo?.missingCount) ?? 0;
      return missing > 0 ? `글 형태 ${missing}가지 미비, 다음 글부터 규격 맞추기` : null;
    }
    case 'blog.cadence': {
      const perWeek = numberOf(report.blog?.postsPerWeek);
      return perWeek !== null ? `주당 ${perWeek.toFixed(1)}편, 발행 속도 올리기` : null;
    }
    case 'blog.exists':
      return '병원 블로그 없이 놓치던 검색 접점 만들기';
    default:
      return null;
  }
}

/**
 * 결과 맨 아래 전환 문구.
 *
 * ★ "닥터포스트가 대신합니다" 같은 일반 문구는 약하다. 원장이 방금 본 자기 숫자를
 *   넣는다. 근거는 화면에서 **가장 위에 보인 우리 범위 항목**으로 고른다
 *   (groupFindings 가 이미 화면 순서대로 정렬해 준다) — 원장의 눈이 마지막으로
 *   머문 것과 버튼 문구가 어긋나지 않게.
 */
export function buildConversionCta(report: DiagnosisReport): ConversionCta {
  const groups = groupFindings(arrayOf(report?.findings));
  const badScope = groups.bad.filter((f) => doctorpostLine(f) !== null);
  const improveScope = groups.improve.filter((f) => doctorpostLine(f) !== null);

  // 화면 순서 그대로 — '지금 고쳐야 할 것' 이 먼저, 없으면 '챙기면 좋을 것'.
  let headline: string | null = null;
  let basis: string | null = null;
  for (const finding of [...badScope, ...improveScope]) {
    const candidate = headlineFor(finding, report);
    if (candidate !== null) {
      headline = candidate;
      basis = finding.id;
      break;
    }
  }

  const sub =
    groups.bad.length > 0
      ? `지금 고쳐야 할 것 ${groups.bad.length}건 중 ${badScope.length}건은 닥터포스트가 대신합니다.`
      : improveScope.length > 0
        ? `챙기면 좋을 것 ${groups.improve.length}건 중 ${improveScope.length}건은 닥터포스트가 대신합니다.`
        : FALLBACK_CTA_SUB;

  return {
    headline: headline ?? FALLBACK_CTA_HEADLINE,
    sub,
    basis,
    badCount: groups.bad.length,
    badScopeCount: badScope.length,
  };
}

/* ── 영업이 쓸 진단 요약 ─────────────────────────────────── */

/**
 * 리드와 함께 저장하는 진단 요약 — **전화·메일 후속에서 그대로 읽는 값**이다.
 *
 * 지금까지 전화 영업이 실패한 이유는 상대 사정을 모른 채 걸었기 때문이다.
 * "보내드린 진단에서 208일 멈춘 부분 있으시죠"로 시작하려면 그 숫자가 리드 옆에
 * 붙어 있어야 한다. 추정하지 않고 진단이 실제로 확인한 값만 담는다(못 본 것은 null).
 */
export interface DiagnosisLeadSummary {
  readonly badCount: number;
  readonly improveCount: number;
  readonly goodCount: number;
  readonly unknownCount: number;
  /** 경고 항목 중 닥터포스트가 대신할 수 있는 건수. */
  readonly ourScopeCount: number;
  /** 지금 고쳐야 할 것 항목 이름 (최대 5개) — 통화 첫 문장 재료. */
  readonly topIssues: readonly string[];
  /** 마지막 발행 이후 경과 일수. 확인 못 했으면 null. */
  readonly daysSinceLatestPost: number | null;
  readonly postsPerWeek: number | null;
  /** 의료법이 명시적으로 금지한 유형 검출 건수. 검사 못 했으면 null. */
  readonly prohibitedCount: number | null;
  /** 문맥에 따라 갈리는 표현 검출 건수. 검사 못 했으면 null. */
  readonly cautionCount: number | null;
  /** 실측한 키워드 수 / 그중 상위권. 실측 못 했으면 null. */
  readonly keywordsChecked: number | null;
  readonly keywordsTop10: number | null;
  /** AI 추천 질문 수 / 그중 병원이 등장한 질문 수. 확인 못 했으면 null. */
  readonly aiRecommendTotal: number | null;
  readonly aiRecommendMentioned: number | null;
  readonly blogId: string | null;
  readonly siteUrl: string | null;
}

/** 상위권 판정 기준 — findings.ts 의 키워드 판정과 같은 10위. */
const TOP_RANK = 10;
/** 통화 대본 재료로 쓸 항목 이름 상한. */
const MAX_TOP_ISSUES = 5;

export function buildDiagnosisLeadSummary(report: DiagnosisReport): DiagnosisLeadSummary {
  const findings = arrayOf(report?.findings);
  const groups = groupFindings(findings);
  const compliance = report?.compliance?.checked ? complianceRiskCounts(report.compliance) : null;
  const keywords = arrayOf(report?.blog?.keywords);
  const keywordsChecked = report?.blog?.rankChecked ? keywords.length : null;
  const ai = report?.ai;

  return {
    badCount: groups.bad.length,
    improveCount: groups.improve.length,
    goodCount: groups.good.length,
    unknownCount: groups.unknown.length,
    ourScopeCount: countDoctorpostScope(findings),
    topIssues: groups.bad.slice(0, MAX_TOP_ISSUES).map((f) => f.label),
    daysSinceLatestPost: numberOf(report?.blog?.daysSinceLatest),
    postsPerWeek: numberOf(report?.blog?.postsPerWeek),
    prohibitedCount: compliance?.prohibited ?? null,
    cautionCount: compliance?.caution ?? null,
    keywordsChecked,
    keywordsTop10:
      keywordsChecked === null
        ? null
        : keywords.filter((k) => k.apiRank !== null && k.apiRank <= TOP_RANK).length,
    aiRecommendTotal: ai?.checked ? (numberOf(ai.recommendQuestionTotal) ?? 0) : null,
    aiRecommendMentioned: ai?.checked ? (numberOf(ai.recommendQuestionMentioned) ?? 0) : null,
    blogId: report?.blog?.blogId ?? null,
    siteUrl: report?.site?.url ?? null,
  };
}
