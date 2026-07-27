import type { CitationPath, CitationProbe, CitationQuestionResult } from './types.ts';

/**
 * 프로브(= AI 엔진 호출 1건)를 **질문 단위**로 묶는 순수 모듈.
 *
 * ★ 왜 별도 파일인가.
 *   이 로직은 서버(진단 실행)와 화면(리포트 렌더) 양쪽에서 똑같이 쓰인다.
 *   ai-citation.ts 안에 두면 화면이 geo-engines(HTTP·API 키) 전체를 끌고 오게 되고,
 *   화면에서 다시 구현하면 판정과 표시가 조용히 어긋난다. 그래서 의존성 0인
 *   순수 모듈로 떼어 둔다.
 *
 * ★ 왜 질문 단위인가.
 *   질의 3개를 엔진 2곳에 돌리면 프로브는 6건이다. 그 6을 분모로 쓰면
 *   "6번 중 4번(67%) → 잘하고 있어요"가 나오는데, 질문별로 보면 한 표현에서는
 *   두 엔진 모두 미등장이었다. 원장에게 의미 있는 단위는 환자가 하는 "질문"이다.
 *   환자는 엔진을 가려 쓰지 않으므로 어느 엔진에서든 나오면 그 질문은 "등장"이고,
 *   한쪽에서만 나오는 불안정한 상태는 mentionedEngines / missingEngines 로 드러낸다.
 */

/**
 * 한 질문의 여러 엔진 결과 → 대표 인용 경로.
 * 자기 자산이 한 번이라도 근거로 잡혔으면 owned 로 본다(가장 유리한 사실을 살린다).
 */
export function pickQuestionPath(group: readonly CitationProbe[]): CitationPath {
  if (group.some((p) => p.path === 'owned')) return 'owned';
  if (group.some((p) => p.path === 'directory')) return 'directory';
  if (group.some((p) => p.path === 'name_only')) return 'name_only';
  return 'none';
}

/**
 * 프로브 목록 → 질문 단위 결과.
 * 입력 순서(질문 → 엔진)를 그대로 보존한다 — 화면 순서가 곧 질문 순서다.
 */
export function summarizeQuestions(probes: readonly CitationProbe[]): readonly CitationQuestionResult[] {
  const order: string[] = [];
  const groups = new Map<string, CitationProbe[]>();
  for (const probe of probes) {
    // 종류가 다르면 문장이 같아도 다른 질문이다(이름 넣은 질의 vs 이름 없는 질의).
    const key = `${probe.kind}::${probe.question}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(probe);
    } else {
      groups.set(key, [probe]);
      order.push(key);
    }
  }

  const out: CitationQuestionResult[] = [];
  for (const key of order) {
    const group = groups.get(key);
    if (!group || group.length === 0) continue;
    const mentioned = group.filter((p) => p.mentioned);
    out.push({
      question: group[0].question,
      kind: group[0].kind,
      engineTotal: group.length,
      engineMentioned: mentioned.length,
      mentioned: mentioned.length > 0,
      path: pickQuestionPath(group),
      mentionedEngines: mentioned.map((p) => p.engine),
      missingEngines: group.filter((p) => !p.mentioned).map((p) => p.engine),
      thirdPartyHosts: Array.from(new Set(group.flatMap((p) => p.thirdPartyHosts))).slice(0, 5),
      evidence: group.find((p) => p.evidence)?.evidence ?? null,
    });
  }
  return out;
}

/**
 * 이 질문의 결과가 엔진에 따라 갈리는가 — 한쪽에서만 나오는 불안정한 상태.
 * "나오긴 나온다"로 넘기지 않고 화면에 사실로 적기 위한 판정.
 */
export function isEngineSplit(question: CitationQuestionResult): boolean {
  return (
    question.engineTotal > 1 && question.engineMentioned > 0 && question.engineMentioned < question.engineTotal
  );
}
