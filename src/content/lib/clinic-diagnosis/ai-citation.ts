import { detectCitation, sanitizeExcerpt } from '../geo-tracking.ts';
import { createAttemptBudget } from '../geo-engines/attempts.ts';
import { createGeoQueryCache } from '../geo-engines/cache.ts';
import { executeGeoQueries, getEnabledEngines } from '../geo-engines/index.ts';
import type { GeoEngineEnv } from '../geo-engines/types.ts';
import type { AiAxis, CitationPath, CitationProbe, CitationQueryKind } from './types.ts';

/**
 * 2단계 ③ — AI 검색 인용 진단.
 *
 * ★ 판정의 정본은 **추천 질의(recommend)** 다.
 *   병원 이름을 넣고 물으면("하이업성형외과의원 어떤 병원이야?") AI 는 당연히 답한다.
 *   그건 성과가 아니라 기본값이다. 환자가 실제로 하는 검색은 이름 없는
 *   "대구 수성구 성형외과 추천해줘" 쪽이고, 거기 나와야 성과다.
 *   실측에서 이 구분이 없어 "6개 중 2개 등장 → 잘하고 있어요"가 나갔는데
 *   그 2개는 전부 이름을 넣은 질의였다. 정반대의 결론이 나간 셈이다.
 *
 * 그래서 질의를 두 종류로 나누고 예산도 다르게 쓴다:
 *   · recommend — 전 엔진에 돌린다. 종합 판정은 오직 이것으로만 한다.
 *   · named     — **엔진 1곳에만** 돌린다. "AI 가 병원 존재를 아는가"라는
 *                 배경 사실 하나를 확인하는 용도라 중복 호출할 이유가 없다.
 *
 * 이 축의 두 번째 논지는 **인용 경로**다.
 * 우리 실측에서 AI 인용 2건은 전부 디렉터리 경유였고 병원 블로그는 0건이었다.
 * "AI가 우리 병원을 알긴 아는데, 그 근거가 우리 글이 아니라 남의 목록"이라는
 * 사실이 원장에게 가장 설득력 있다. 그래서 owned / directory / name_only / none
 * 네 갈래로 반드시 나눈다.
 *
 * 비용 방어 (무료 진단이므로 필수):
 *   · 추천 질의 상한 MAX_RECOMMEND_QUESTIONS(3) + 이름 질의 1개
 *   · 두 패스가 **하나의 시도 예산(MAX_HTTP_ATTEMPTS)** 을 공유한다 —
 *     엔진이 몇 개든 실제 HTTP 시도는 8회를 넘지 않는다.
 *     운영 엔진 2종 기준: 추천 3×2 + 이름 1×1 = 7회 (상한 8 이내, 재시도 여유 1)
 *   · 결과는 호출부(run.ts)에서 병원 단위로 캐시(TTL 7일)
 *   · 데드라인 초과 시 진행 중 요청까지 취소
 *
 * ⚠️ Gemini 는 구글 약관 위반이라 절대 쓰지 않는다. geo-engines 가 옵트인
 *    가드를 갖고 있으므로 여기서 별도 활성화 코드를 두지 않는다.
 */

/** 추천 질의(이름 없이 지역+진료과) 상한 — 판정의 분모. */
export const MAX_RECOMMEND_QUESTIONS = 3;
/** 이름 확인 질의를 돌릴 엔진 수 — 배경 사실이라 1곳이면 충분하다. */
export const NAMED_QUERY_ENGINES = 1;
/** 무료 진단 1회 HTTP 시도 상한 (재시도 포함 — 비용 정본, 두 패스 공유). */
export const MAX_HTTP_ATTEMPTS = 8;
/** 엔진당 논리 호출 상한. */
export const MAX_CALLS_PER_ENGINE = MAX_RECOMMEND_QUESTIONS;
/** AI 축 전체 데드라인(ms). */
export const AI_DEADLINE_MS = 45_000;

/**
 * 제3자 디렉터리·포털 호스트 — "남의 목록을 통한 인용"으로 분류할 근거.
 * 목록에 없는 외부 호스트도 자기 자산이 아니면 directory 로 본다(보수적).
 */
export const DIRECTORY_HOSTS: readonly string[] = [
  'naver.com', 'map.naver.com', 'place.naver.com', 'blog.naver.com', 'cafe.naver.com',
  'daum.net', 'kakao.com', 'google.com', 'mapcarta.com',
  'hira.or.kr', 'nhis.or.kr', 'mohw.go.kr', 'e-gen.or.kr',
  'goodoc.co.kr', 'mediyou.co.kr', 'ddocdoc.com', 'modoodoc.com', 'healthcaren.com',
  'wikipedia.org', 'youtube.com', 'instagram.com', 'facebook.com', 'tistory.com',
];

/** URL 에서 호스트만 뽑는다. 실패 시 ''. */
export function hostOf(url: string): string {
  try {
    return new URL((url ?? '').trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export interface OwnedAssets {
  /** 병원 네이버 블로그 ID (확정된 경우만). */
  readonly blogId: string | null;
  /** 병원 홈페이지 호스트 (확정된 경우만). */
  readonly siteHost: string | null;
}

/**
 * 이 출처가 병원 자기 자산인가.
 *
 * ⚠️ 양쪽 모두 `www.` 를 떼고 비교해야 한다. 실측에서 병원 홈페이지가
 * `https://www.florps.com` 으로 확인됐는데 AI 출처는 `florps.com` 으로 와서,
 * 자기 홈페이지가 인용됐는데도 "디렉터리 경유"로 잘못 분류됐다. 이 진단의
 * 핵심 논지가 인용 경로이므로 여기서 틀리면 결과 전체의 신뢰가 무너진다.
 */
export function isOwnedSource(url: string, owned: OwnedAssets): boolean {
  const lower = (url ?? '').toLowerCase();
  if (owned.blogId && lower.includes(`blog.naver.com/${owned.blogId.toLowerCase()}`)) return true;
  if (owned.siteHost) {
    const site = owned.siteHost.toLowerCase().replace(/^www\./, '');
    const host = hostOf(url); // hostOf 가 이미 www. 를 뗀다
    if (site && (host === site || host.endsWith(`.${site}`))) return true;
  }
  return false;
}

/**
 * 언급 여부 + 출처 목록 → 인용 경로 판정 (순수 함수).
 *
 * owned      : 자기 블로그·홈페이지가 출처에 잡혔다
 * directory  : 언급은 됐고 출처는 전부 제3자 문서다
 * name_only  : 언급은 됐는데 출처를 특정하지 못했다(출처 미제공 응답)
 * none       : 언급 자체가 없다
 */
export function classifyCitationPath(
  mentioned: boolean,
  sourceUrls: readonly string[],
  owned: OwnedAssets,
): CitationPath {
  if (!mentioned) return 'none';
  if (sourceUrls.some((u) => isOwnedSource(u, owned))) return 'owned';
  if (sourceUrls.length === 0) return 'name_only';
  return 'directory';
}

export interface DiagnosisQueries {
  /** 이름 없이 지역+진료과로만 묻는 질의 — 환자가 실제로 하는 검색. */
  readonly recommend: readonly string[];
  /** 병원 이름을 넣고 묻는 질의 — 배경 사실 확인용. 재료가 없으면 null. */
  readonly named: string | null;
}

/**
 * 진단용 질의 생성 (규칙 기반, LLM 호출 없음).
 *
 * 추천 질의를 3개로 잡은 이유: 한 문장 형태에만 걸리는 우연을 걸러내야
 * "안 나온다"를 근거로 말할 수 있다. 표현을 바꿔가며 물어도 전부 안 나오면
 * 그건 문장 문제가 아니라 노출 문제다.
 */
export function buildDiagnosisQueries(input: {
  readonly region: string;
  readonly specialty: string;
  readonly clinicName: string;
}): DiagnosisQueries {
  const region = (input.region ?? '').trim();
  const specialty = (input.specialty ?? '').trim();
  const name = (input.clinicName ?? '').trim();
  const recommend: string[] = [];

  if (region && specialty) {
    recommend.push(`${region} ${specialty} 추천해줘`);
    recommend.push(`${region} ${specialty} 중에 잘하는 곳 세 군데만 알려줘`);
    recommend.push(`${region}에서 ${specialty} 어디로 가는 게 좋을까?`);
  } else if (specialty) {
    recommend.push(`${specialty} 잘하는 병원 추천해줘`);
    recommend.push(`${specialty} 어디로 가는 게 좋을까?`);
  }

  const named = name ? (region ? `${region} ${name} 어떤 병원이야?` : `${name} 어떤 병원이야?`) : null;

  return {
    recommend: Array.from(new Set(recommend)).slice(0, MAX_RECOMMEND_QUESTIONS),
    named,
  };
}

export const EMPTY_AI_AXIS: AiAxis = {
  checked: false,
  skippedReason: null,
  probes: [],
  mentionedCount: 0,
  ownedCount: 0,
  directoryCount: 0,
  recommendTotal: 0,
  recommendMentioned: 0,
  namedTotal: 0,
  namedMentioned: 0,
  httpAttempts: 0,
};

/** 프로브 목록 → AiAxis 집계 (순수 함수). 판정 분모/분자를 한 곳에서 만든다. */
export function summarizeProbes(probes: readonly CitationProbe[]): Omit<AiAxis, 'checked' | 'skippedReason' | 'probes' | 'httpAttempts'> {
  const recommend = probes.filter((p) => p.kind === 'recommend');
  const named = probes.filter((p) => p.kind === 'named');
  return {
    mentionedCount: probes.filter((p) => p.mentioned).length,
    ownedCount: probes.filter((p) => p.path === 'owned').length,
    directoryCount: probes.filter((p) => p.path === 'directory').length,
    recommendTotal: recommend.length,
    recommendMentioned: recommend.filter((p) => p.mentioned).length,
    namedTotal: named.length,
    namedMentioned: named.filter((p) => p.mentioned).length,
  };
}

export interface AiCitationOptions {
  readonly env?: GeoEngineEnv;
  readonly fetchImpl?: typeof fetch;
  readonly deadlineMs?: number;
  readonly now?: () => number;
}

/**
 * AI 인용 진단 실행. 엔진 키가 없으면 조용히 skip(checked:false) — 진단 전체는 계속된다.
 * 절대 throw 하지 않는다.
 *
 * 두 패스로 나눠 돈다(추천=전 엔진 / 이름=엔진 1곳). 두 패스는 **같은 시도 예산과
 * 같은 데드라인**을 공유하므로 엔진 수가 늘어도 비용 상한은 그대로다.
 */
export async function runAiCitation(
  input: {
    readonly clinicName: string;
    readonly region: string;
    readonly specialty: string;
    readonly owned: OwnedAssets;
  },
  options: AiCitationOptions = {},
): Promise<AiAxis> {
  const env = options.env ?? (process.env as GeoEngineEnv);
  const engines = getEnabledEngines(env);
  if (engines.length === 0) return { ...EMPTY_AI_AXIS, skippedReason: 'not_configured' };

  const queries = buildDiagnosisQueries(input);
  if (queries.recommend.length === 0 && !queries.named) {
    return { ...EMPTY_AI_AXIS, skippedReason: 'not_configured' };
  }

  const now = options.now ?? Date.now;
  const deadlineAt = now() + (options.deadlineMs ?? AI_DEADLINE_MS);
  // 두 패스가 공유하는 단일 예산 — 이것이 이 진단의 실제 비용 상한이다.
  const attemptBudget = createAttemptBudget(MAX_HTTP_ATTEMPTS);
  const cache = createGeoQueryCache();

  /** 이름 질의를 돌릴 엔진 — 배경 사실이라 첫 엔진 하나로 고정한다. */
  const namedEngines = engines.slice(0, NAMED_QUERY_ENGINES);

  const pass = async (questions: readonly string[], targets: typeof engines): Promise<boolean> => {
    if (questions.length === 0 || targets.length === 0) return true;
    try {
      await executeGeoQueries({
        questions,
        engines: targets,
        env,
        fetchImpl: options.fetchImpl,
        deadlineAt,
        maxCallsPerEngine: Math.max(questions.length, MAX_CALLS_PER_ENGINE),
        attemptBudget,
        cache,
        now: options.now,
      });
      return true;
    } catch (error) {
      console.error(
        '[clinic-diagnosis] AI 인용 조회 실패 — 해당 패스는 미측정으로 표시:',
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  };

  // 추천 질의를 먼저 돌린다 — 예산이 모자라면 배경 사실보다 판정 지표를 살린다.
  await pass(queries.recommend, engines);
  await pass(queries.named ? [queries.named] : [], namedEngines);

  const probes: CitationProbe[] = [];
  const collect = (question: string, kind: CitationQueryKind, targets: typeof engines): void => {
    for (const engine of targets) {
      const outcome = cache.peek(engine.id, question);
      // 실패한 질의는 프로브로 만들지 않는다 — "미언급"으로 오독되면 없는 사실이 된다.
      if (!outcome || !outcome.ok) continue;
      const answer = outcome.answer;
      const sourceUrls = answer.sources.map((s) => s.url).filter((u) => u.length > 0);
      const citation = detectCitation(
        { text: answer.text, sourceUrls },
        { hospitalName: input.clinicName, naverBlogId: input.owned.blogId },
      );
      probes.push({
        question,
        kind,
        engine: engine.id,
        mentioned: citation.cited,
        path: classifyCitationPath(citation.cited, sourceUrls, input.owned),
        evidence: citation.evidence ? sanitizeExcerpt(citation.evidence, 200) : null,
        ownedSources: sourceUrls.filter((u) => isOwnedSource(u, input.owned)).slice(0, 3),
        thirdPartyHosts: Array.from(
          new Set(sourceUrls.filter((u) => !isOwnedSource(u, input.owned)).map(hostOf).filter((h) => h)),
        ).slice(0, 5),
      });
    }
  };

  for (const question of queries.recommend) collect(question, 'recommend', engines);
  if (queries.named) collect(queries.named, 'named', namedEngines);

  const httpAttempts = attemptBudget.used();
  if (probes.length === 0) {
    return { ...EMPTY_AI_AXIS, skippedReason: 'budget', httpAttempts };
  }

  return {
    checked: true,
    skippedReason: null,
    probes,
    ...summarizeProbes(probes),
    httpAttempts,
  };
}
