import { detectCitation, sanitizeExcerpt } from '../geo-tracking.ts';
import { executeGeoQueries, getEnabledEngines } from '../geo-engines/index.ts';
import type { GeoEngineEnv } from '../geo-engines/types.ts';
import type { AiAxis, CitationPath, CitationProbe } from './types.ts';

/**
 * 2단계 ③ — AI 검색 인용 진단.
 *
 * 이 축의 핵심은 "인용됐다/안 됐다"가 아니라 **인용 경로**다.
 * 우리 실측에서 AI 인용 2건은 전부 디렉터리 경유였고 병원 블로그는 0건이었다.
 * 즉 "AI가 우리 병원을 알긴 아는데, 그 근거가 우리 글이 아니라 남의 목록"이라는
 * 사실이 원장에게 가장 설득력 있는 지점이다. 그래서 owned / directory /
 * name_only / none 네 갈래로 반드시 나눈다.
 *
 * 비용 방어 (무료 진단이므로 필수):
 *   · 질의 수 상한 MAX_QUESTIONS(3) — 프로필 재료가 있어도 그 이상 만들지 않는다
 *   · 엔진당 호출 상한 + 실행당 HTTP 시도 상한(MAX_HTTP_ATTEMPTS)
 *   · 결과는 호출부(run.ts)에서 병원 단위로 캐시(TTL 7일)
 *   · 데드라인 초과 시 진행 중 요청까지 취소
 *
 * ⚠️ Gemini 는 구글 약관 위반이라 절대 쓰지 않는다. geo-engines 가 옵트인
 *    가드를 갖고 있으므로 여기서 별도 활성화 코드를 두지 않는다.
 */

/** 무료 진단 1회에 허용하는 질의 수 상한. */
export const MAX_QUESTIONS = 3;
/** 무료 진단 1회 HTTP 시도 상한 (재시도 포함 — 비용 정본). */
export const MAX_HTTP_ATTEMPTS = 8;
/** 엔진당 논리 호출 상한. */
export const MAX_CALLS_PER_ENGINE = MAX_QUESTIONS;
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

/**
 * 진단용 질의 생성 (규칙 기반, LLM 호출 없음).
 * 환자가 실제로 물어볼 법한 형태 3개로 고정한다 — 지역·진료과가 없으면 줄어든다.
 */
export function buildDiagnosisQuestions(input: {
  readonly region: string;
  readonly specialty: string;
  readonly clinicName: string;
}): readonly string[] {
  const region = (input.region ?? '').trim();
  const specialty = (input.specialty ?? '').trim();
  const name = (input.clinicName ?? '').trim();
  const questions: string[] = [];

  if (region && specialty) {
    questions.push(`${region} ${specialty} 추천해줘`);
    questions.push(`${region} ${specialty} 중에 잘하는 곳 세 군데만 알려줘`);
  } else if (specialty) {
    questions.push(`${specialty} 잘하는 병원 추천해줘`);
  }
  // 지명 질의 — "AI가 이 병원을 알고 있는가"를 직접 확인한다.
  if (name) {
    questions.push(region ? `${region} ${name} 어떤 병원이야?` : `${name} 어떤 병원이야?`);
  }

  return Array.from(new Set(questions)).slice(0, MAX_QUESTIONS);
}

export const EMPTY_AI_AXIS: AiAxis = {
  checked: false,
  skippedReason: null,
  probes: [],
  mentionedCount: 0,
  ownedCount: 0,
  directoryCount: 0,
  httpAttempts: 0,
};

export interface AiCitationOptions {
  readonly env?: GeoEngineEnv;
  readonly fetchImpl?: typeof fetch;
  readonly deadlineMs?: number;
  readonly now?: () => number;
}

/**
 * AI 인용 진단 실행. 엔진 키가 없으면 조용히 skip(checked:false) — 진단 전체는 계속된다.
 * 절대 throw 하지 않는다.
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

  const questions = buildDiagnosisQuestions(input);
  if (questions.length === 0) return { ...EMPTY_AI_AXIS, skippedReason: 'not_configured' };

  const now = options.now ?? Date.now;
  let result: Awaited<ReturnType<typeof executeGeoQueries>>;
  try {
    result = await executeGeoQueries({
      questions,
      engines,
      env,
      fetchImpl: options.fetchImpl,
      deadlineAt: now() + (options.deadlineMs ?? AI_DEADLINE_MS),
      maxCallsPerEngine: MAX_CALLS_PER_ENGINE,
      maxHttpAttempts: MAX_HTTP_ATTEMPTS,
      now: options.now,
    });
  } catch (error) {
    console.error(
      '[clinic-diagnosis] AI 인용 조회 실패 — 이 축은 미측정으로 표시:',
      error instanceof Error ? error.message : error,
    );
    return { ...EMPTY_AI_AXIS, skippedReason: 'budget' };
  }

  const probes: CitationProbe[] = [];
  for (const engine of engines) {
    for (const question of questions) {
      const outcome = result.cache.peek(engine.id, question);
      // 실패한 질의는 프로브로 만들지 않는다 — "미언급"으로 오독되면 없는 사실이 된다.
      if (!outcome || !outcome.ok) continue;
      const answer = outcome.answer;
      const sourceUrls = answer.sources.map((s) => s.url).filter((u) => u.length > 0);
      const citation = detectCitation(
        { text: answer.text, sourceUrls },
        { hospitalName: input.clinicName, naverBlogId: input.owned.blogId },
      );
      const path = classifyCitationPath(citation.cited, sourceUrls, input.owned);
      probes.push({
        question,
        engine: engine.id,
        mentioned: citation.cited,
        path,
        evidence: citation.evidence ? sanitizeExcerpt(citation.evidence, 200) : null,
        ownedSources: sourceUrls.filter((u) => isOwnedSource(u, input.owned)).slice(0, 3),
        thirdPartyHosts: Array.from(
          new Set(sourceUrls.filter((u) => !isOwnedSource(u, input.owned)).map(hostOf).filter((h) => h)),
        ).slice(0, 5),
      });
    }
  }

  if (probes.length === 0) {
    return { ...EMPTY_AI_AXIS, skippedReason: 'budget', httpAttempts: result.httpAttempts };
  }

  return {
    checked: true,
    skippedReason: null,
    probes,
    mentionedCount: probes.filter((p) => p.mentioned).length,
    ownedCount: probes.filter((p) => p.path === 'owned').length,
    directoryCount: probes.filter((p) => p.path === 'directory').length,
    httpAttempts: result.httpAttempts,
  };
}
