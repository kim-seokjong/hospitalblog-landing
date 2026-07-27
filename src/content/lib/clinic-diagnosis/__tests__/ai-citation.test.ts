import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_HTTP_ATTEMPTS,
  MAX_RECOMMEND_QUESTIONS,
  NAMED_QUERY_ENGINES,
  buildDiagnosisQueries,
  classifyCitationPath,
  hostOf,
  isOwnedSource,
  runAiCitation,
  summarizeProbes,
  summarizeQuestions,
  isEngineSplit,
} from '../ai-citation.ts';
import type { CitationProbe } from '../types.ts';
import {
  buildComplianceAxis,
  classifyComplianceRisk,
  complianceRiskCounts,
  EMPTY_COMPLIANCE_AXIS,
  prohibitedNote,
  riskOf,
  softenRule,
  type ComplianceCheckShape,
} from '../compliance-scan.ts';

const OWNED = { blogId: 'vbps_official', siteHost: 'vb.vbeauty.co.kr' };

/* ── 인용 경로 분류 (이 진단의 핵심 논지) ───────────────── */

test('hostOf 는 www 를 떼고 호스트만 남긴다', () => {
  assert.equal(hostOf('https://www.goodoc.co.kr/clinic/1'), 'goodoc.co.kr');
  assert.equal(hostOf('보통문자열'), '');
});

test('isOwnedSource 는 병원 블로그·홈페이지(서브도메인 포함)만 자기 자산으로 본다', () => {
  assert.equal(isOwnedSource('https://blog.naver.com/vbps_official/224', OWNED), true);
  assert.equal(isOwnedSource('https://vb.vbeauty.co.kr/about', OWNED), true);
  assert.equal(isOwnedSource('https://sub.vb.vbeauty.co.kr/x', OWNED), true);
  assert.equal(isOwnedSource('https://blog.naver.com/otherclinic/1', OWNED), false);
  assert.equal(isOwnedSource('https://goodoc.co.kr/clinic/1', OWNED), false);
});

test('www 유무가 달라도 자기 홈페이지로 인식한다 (실측 오분류 회귀 방지)', () => {
  // 홈페이지는 www.florps.com 으로 확인됐는데 AI 출처는 florps.com 으로 온다.
  // 이걸 놓치면 자기 사이트 인용이 "디렉터리 경유"로 뒤집혀 결론이 정반대가 된다.
  const withWww = { blogId: null, siteHost: 'www.florps.com' };
  assert.equal(isOwnedSource('https://florps.com/intro', withWww), true);
  assert.equal(isOwnedSource('https://www.florps.com/intro', withWww), true);
  assert.equal(classifyCitationPath(true, ['https://florps.com/intro'], withWww), 'owned');

  const bare = { blogId: null, siteHost: 'florps.com' };
  assert.equal(isOwnedSource('https://www.florps.com/intro', bare), true);
  // 다른 도메인은 여전히 남의 것
  assert.equal(isOwnedSource('https://notflorps.com/intro', bare), false);
});

test('자기 자산 정보가 없으면 owned 로 잘못 분류하지 않는다', () => {
  const none = { blogId: null, siteHost: null };
  assert.equal(isOwnedSource('https://blog.naver.com/vbps_official/1', none), false);
  assert.equal(classifyCitationPath(true, ['https://blog.naver.com/vbps_official/1'], none), 'directory');
});

test('classifyCitationPath 4분류', () => {
  assert.equal(classifyCitationPath(false, [], OWNED), 'none');
  assert.equal(classifyCitationPath(false, ['https://goodoc.co.kr/1'], OWNED), 'none');
  assert.equal(classifyCitationPath(true, ['https://blog.naver.com/vbps_official/1'], OWNED), 'owned');
  assert.equal(classifyCitationPath(true, ['https://goodoc.co.kr/1'], OWNED), 'directory');
  assert.equal(classifyCitationPath(true, [], OWNED), 'name_only');
});

test('자기 자산과 디렉터리가 섞이면 owned 가 우선한다', () => {
  assert.equal(
    classifyCitationPath(true, ['https://goodoc.co.kr/1', 'https://blog.naver.com/vbps_official/1'], OWNED),
    'owned',
  );
});

/* ── 질의 생성: 두 종류 분리 + 비용 상한 ────────────────── */

test('추천 질의에는 병원 이름이 절대 들어가지 않는다 (판정의 정본)', () => {
  const { recommend, named } = buildDiagnosisQueries({
    region: '대구 수성구', specialty: '성형외과', clinicName: '하이업성형외과의원',
  });
  assert.ok(recommend.length >= 2);
  assert.ok(recommend.length <= MAX_RECOMMEND_QUESTIONS, `추천 질의 ${recommend.length}개 — 상한 초과`);
  for (const q of recommend) {
    assert.ok(!q.includes('하이업'), `추천 질의에 병원 이름이 들어갔다: ${q}`);
    assert.ok(q.includes('성형외과'), `진료과가 빠졌다: ${q}`);
  }
  assert.equal(new Set(recommend).size, recommend.length);
  assert.ok(named && named.includes('하이업'), '이름 질의는 병원 이름을 넣어야 한다');
});

test('질의 구성이 비용 상한 안에 들어간다 (엔진 2종 기준)', () => {
  const { recommend } = buildDiagnosisQueries({ region: '대구 수성구', specialty: '성형외과', clinicName: '하이업성형외과의원' });
  // 추천은 전 엔진 × N, 이름은 엔진 1곳 × 1
  const worstCase = recommend.length * 2 + NAMED_QUERY_ENGINES;
  assert.ok(worstCase <= MAX_HTTP_ATTEMPTS, `최악 ${worstCase}회 — HTTP 시도 상한 ${MAX_HTTP_ATTEMPTS} 초과`);
});

test('재료가 없으면 질의를 만들지 않는다 (빈 호출로 비용 쓰지 않음)', () => {
  const queries = buildDiagnosisQueries({ region: '', specialty: '', clinicName: '' });
  assert.deepEqual(queries.recommend, []);
  assert.equal(queries.named, null);
});

/* ── 집계: 추천/이름을 섞어 세지 않는다 ─────────────────── */

function probe(kind: CitationProbe['kind'], mentioned: boolean): CitationProbe {
  return { question: 'q', kind, engine: 'openai', mentioned, path: mentioned ? 'directory' : 'none', evidence: null, ownedSources: [], thirdPartyHosts: [] };
}

test('summarizeProbes 는 추천 질의와 이름 질의를 따로 센다 (실측 오판 회귀 방지)', () => {
  // 실측 사고 재현: 이름 질의 2건만 등장, 추천 질의 4건은 전부 미등장.
  // 이걸 합쳐서 "6개 중 2개 = 33% 잘하고 있어요"로 내보냈던 것이 정반대 결론이었다.
  const summary = summarizeProbes([
    probe('recommend', false), probe('recommend', false), probe('recommend', false), probe('recommend', false),
    probe('named', true), probe('named', true),
  ]);
  assert.equal(summary.recommendTotal, 4);
  assert.equal(summary.recommendMentioned, 0, '추천 질의는 한 번도 안 나왔다');
  assert.equal(summary.namedTotal, 2);
  assert.equal(summary.namedMentioned, 2);
  assert.equal(summary.mentionedCount, 2);
});

/* ── 질문 단위 집계 (브이성형외과 오판 회귀 방지) ────────── */

function enginedProbe(question: string, engine: string, mentioned: boolean): CitationProbe {
  return {
    question,
    kind: 'recommend',
    engine,
    mentioned,
    path: mentioned ? 'directory' : 'none',
    evidence: mentioned ? '…' : null,
    ownedSources: [],
    thirdPartyHosts: mentioned ? ['goodoc.co.kr'] : [],
  };
}

const RQ1 = '대구 중구 성형외과 추천해줘';
const RQ2 = '대구 중구 성형외과 중에 잘하는 곳 세 군데만 알려줘';
const RQ3 = '대구 중구에서 성형외과 어디로 가는 게 좋을까?';

test('summarizeQuestions 는 엔진 호출을 질문 하나로 묶는다 (분모는 질문 수)', () => {
  // 실측 재현: 질의 3개 × 엔진 2곳 = 6건. 6을 분모로 쓰면 실제보다 좋아 보인다.
  const questions = summarizeQuestions([
    enginedProbe(RQ1, 'openai', true),
    enginedProbe(RQ1, 'perplexity', false),
    enginedProbe(RQ2, 'openai', true),
    enginedProbe(RQ2, 'perplexity', true),
    enginedProbe(RQ3, 'openai', false),
    enginedProbe(RQ3, 'perplexity', false),
  ]);

  assert.equal(questions.length, 3, '질문 단위로 묶여야 한다');
  assert.deepEqual(questions.map((q) => q.question), [RQ1, RQ2, RQ3], '입력 순서를 보존한다');
  // 환자는 엔진을 가려 쓰지 않는다 — 어느 엔진에서든 나오면 등장
  assert.deepEqual(questions.map((q) => q.mentioned), [true, true, false]);
  assert.deepEqual(questions.map((q) => q.engineMentioned), [1, 2, 0]);

  const summary = summarizeProbes([
    enginedProbe(RQ1, 'openai', true),
    enginedProbe(RQ1, 'perplexity', false),
    enginedProbe(RQ2, 'openai', true),
    enginedProbe(RQ2, 'perplexity', true),
    enginedProbe(RQ3, 'openai', false),
    enginedProbe(RQ3, 'perplexity', false),
  ]);
  assert.equal(summary.recommendQuestionTotal, 3);
  assert.equal(summary.recommendQuestionMentioned, 2);
  assert.equal(summary.recommendQuestionSplit, 1);
  // 원자료(엔진 호출 수)는 남기되 판정에는 쓰지 않는다
  assert.equal(summary.recommendTotal, 6);
  assert.equal(summary.recommendMentioned, 3);
});

test('isEngineSplit: 한쪽 엔진에서만 나오는 질문만 불안정으로 본다', () => {
  const [split, both, none, single] = summarizeQuestions([
    enginedProbe('a', 'openai', true),
    enginedProbe('a', 'perplexity', false),
    enginedProbe('b', 'openai', true),
    enginedProbe('b', 'perplexity', true),
    enginedProbe('c', 'openai', false),
    enginedProbe('c', 'perplexity', false),
    enginedProbe('d', 'openai', true),
  ]);
  assert.equal(isEngineSplit(split), true);
  assert.equal(isEngineSplit(both), false);
  assert.equal(isEngineSplit(none), false);
  assert.equal(isEngineSplit(single), false, '엔진이 하나면 편차를 말할 수 없다');
});

test('질문 단위 인용 경로: 한 엔진에서라도 자기 글이 근거면 owned 로 본다', () => {
  const probes: CitationProbe[] = [
    { question: RQ1, kind: 'recommend', engine: 'openai', mentioned: true, path: 'directory', evidence: 'e', ownedSources: [], thirdPartyHosts: ['goodoc.co.kr'] },
    { question: RQ1, kind: 'recommend', engine: 'perplexity', mentioned: true, path: 'owned', evidence: 'e', ownedSources: ['https://blog.naver.com/vbps_official/1'], thirdPartyHosts: [] },
  ];
  const [q] = summarizeQuestions(probes);
  assert.equal(q.path, 'owned');
  assert.deepEqual(q.thirdPartyHosts, ['goodoc.co.kr']);
});

test('같은 문장이라도 이름을 넣은 질의와 안 넣은 질의는 다른 질문이다', () => {
  const questions = summarizeQuestions([
    { question: '같은 문장', kind: 'recommend', engine: 'openai', mentioned: false, path: 'none', evidence: null, ownedSources: [], thirdPartyHosts: [] },
    { question: '같은 문장', kind: 'named', engine: 'openai', mentioned: true, path: 'directory', evidence: 'e', ownedSources: [], thirdPartyHosts: [] },
  ]);
  assert.equal(questions.length, 2);
  assert.deepEqual(questions.map((q) => q.kind), ['recommend', 'named']);
});

/* ── 실행 계층 ──────────────────────────────────────────── */

test('runAiCitation: 엔진 키가 없으면 호출 없이 조용히 건너뛴다', async () => {
  let called = 0;
  const axis = await runAiCitation(
    { clinicName: '브이비성형외과의원', region: '중구', specialty: '성형외과', owned: OWNED },
    { env: {}, fetchImpl: (async () => { called += 1; return new Response('{}'); }) as unknown as typeof fetch },
  );
  assert.equal(axis.checked, false);
  assert.equal(axis.skippedReason, 'not_configured');
  assert.equal(called, 0);
});

test('runAiCitation: 엔진이 전부 실패해도 throw 하지 않고 미측정으로 남는다', async () => {
  const axis = await runAiCitation(
    { clinicName: '브이비성형외과의원', region: '중구', specialty: '성형외과', owned: OWNED },
    {
      env: { OPENAI_API_KEY: 'sk-test' },
      fetchImpl: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
      deadlineMs: 500,
    },
  );
  assert.equal(axis.checked, false);
  assert.equal(axis.mentionedCount, 0);
});

test('runAiCitation: GEO_LIVE_QUERY=off 면 아예 돌지 않는다 (킬스위치)', async () => {
  let called = 0;
  const axis = await runAiCitation(
    { clinicName: '브이비성형외과의원', region: '중구', specialty: '성형외과', owned: OWNED },
    {
      env: { OPENAI_API_KEY: 'sk-test', GEO_LIVE_QUERY: 'off' },
      fetchImpl: (async () => { called += 1; return new Response('{}'); }) as unknown as typeof fetch,
    },
  );
  assert.equal(axis.skippedReason, 'not_configured');
  assert.equal(called, 0);
});

/* ── 의료광고법 표현 완화 ───────────────────────────────── */

test('softenRule 은 법조문 인용을 빼고 단정하지 않는 문장으로 바꾼다', () => {
  const soft = softenRule('최상급 표현 금지 (의료법 제56조 제2항)');
  assert.ok(!soft.includes('제56조'));
  assert.match(soft, /자주 지적돼요/);
  assert.match(soft, /확인이 필요합니다/);
});

test('buildComplianceAxis 는 검출 결과를 그대로 옮기되 게이트를 낮추지 않는다', () => {
  const checkFn = (text: string): ComplianceCheckShape =>
    text.includes('최고')
      ? { violations: [{ word: '최고', rule: '최상급 표현 금지 (의료법 제56조 제2항)', severity: 'HIGH' }], warnings: [] }
      : { violations: [], warnings: [] };

  const axis = buildComplianceAxis(
    [
      { title: '최고의 코성형', link: 'https://blog.naver.com/a/1', text: '최고의 코성형', hasBody: false },
      { title: '평범한 안내', link: 'https://blog.naver.com/a/2', text: '평범한 안내', hasBody: true },
    ],
    checkFn,
  );
  assert.equal(axis.checked, true);
  assert.equal(axis.postsScanned, 2);
  assert.equal(axis.bodiesScanned, 1);
  assert.equal(axis.hits.length, 1);
  assert.equal(axis.hits[0].level, 'review');
  assert.equal(axis.postsWithHits, 1);
});

test('buildComplianceAxis 는 경고 패턴도 빠뜨리지 않는다', () => {
  const axis = buildComplianceAxis(
    [{ title: 't', link: 'l', text: 'x', hasBody: true }],
    () => ({ violations: [], warnings: ['즉각적 효과 표현은 과장 광고로 해석될 수 있습니다.'] }),
  );
  assert.equal(axis.hits.length, 1);
  assert.equal(axis.hits[0].level, 'caution');
  assert.equal(axis.hits[0].risk, 'caution');
  assert.match(axis.hits[0].note, /확인이 필요합니다/);
});

/* ── 위험 / 주의 2단 구분 ───────────────────────────────── */

test('의료법이 명시적으로 금지한 유형은 위험(prohibited)으로 분류된다', () => {
  const cases: readonly [string, string][] = [
    ['후기 환자 후기·경험담 광고 금지', '환자 후기·치료경험담'],
    ['(문장 패턴) 치료 전후 비교 광고 금지', '치료 전후 비교'],
    ['무조건 치료 결과 보장 금지', '치료효과 보장·부작용 없음 단정'],
    ['부작용 없음 허위 부작용 표현 금지', '치료효과 보장·부작용 없음 단정'],
    ['타 병원 대비 비교 광고 금지', '다른 병원과의 비교·비방'],
  ];
  for (const [signal, label] of cases) {
    const result = classifyComplianceRisk(signal);
    assert.equal(result.risk, 'prohibited', `${signal} 는 위험이어야 한다`);
    assert.equal(result.label, label);
  }
});

test('문맥에 따라 갈리는 표현은 주의(caution)로 남는다 — 빨간색을 흔하게 만들지 않는다', () => {
  for (const signal of [
    '최신 검증되지 않은 최신 주장 금지',
    '제일 최상급 표현 금지 (의료법 제56조 제2항)',
    '유명인·인플루언서 언급 광고는 별도 심의가 필요합니다.',
    '이벤트 환자 유인·알선 금지 (의료법 제27조 제3항)',
    '안전한 시술 허위 안전성 주장 금지',
    '구체적인 수치 표현은 근거 자료가 필요합니다.',
  ]) {
    assert.equal(classifyComplianceRisk(signal).risk, 'caution', `${signal} 가 위험으로 올라가면 안 된다`);
  }
});

test('위험 문구도 "위반"이라고 단정하지 않는다', () => {
  const note = prohibitedNote('환자 후기·치료경험담');
  assert.match(note, /명시적으로 금지한 유형/);
  for (const forbidden of ['위반입니다', '처분', '불법', '고발']) {
    assert.ok(!note.includes(forbidden), `단정 표현 "${forbidden}" 이 들어갔다`);
  }
});

test('위험 검출은 목록 맨 앞으로 오고 건수가 따로 집계된다 (표시 상한에 잘려도 수는 남는다)', () => {
  const axis = buildComplianceAxis(
    [{ title: 't', link: 'https://blog.naver.com/a/1', text: 'x', hasBody: true }],
    () => ({
      violations: [
        { word: '최신', rule: '검증되지 않은 최신 주장 금지', severity: 'MEDIUM' },
        { word: '후기', rule: '환자 후기·경험담 광고 금지', severity: 'MEDIUM' },
      ],
      warnings: [],
    }),
  );
  assert.equal(axis.hits[0].phrase, '후기', '위험이 먼저 나와야 한다');
  assert.equal(axis.hits[0].risk, 'prohibited');
  assert.equal(axis.hits[1].risk, 'caution');
  assert.equal(axis.prohibitedCount, 1);
  assert.equal(axis.cautionCount, 1);
  assert.equal(axis.postsWithProhibited, 1);
});

test('risk 가 없던 시절 리포트는 전부 주의로 읽는다 (없는 것을 위험으로 올리지 않는다)', () => {
  const legacy = {
    ...EMPTY_COMPLIANCE_AXIS,
    checked: true,
    postsScanned: 3,
    hits: [{ postTitle: 't', postLink: 'l', phrase: '후기', note: 'n', level: 'caution' as const }],
    postsWithHits: 1,
    prohibitedCount: undefined,
    cautionCount: undefined,
    postsWithProhibited: undefined,
  };
  assert.equal(riskOf(legacy.hits[0]), 'caution');
  assert.deepEqual(complianceRiskCounts(legacy), { prohibited: 0, caution: 1, postsWithProhibited: 0 });
});

test('검사할 글이 없으면 checked=false — "문제 없음"으로 오독되지 않는다', () => {
  const axis = buildComplianceAxis([], () => ({ violations: [], warnings: [] }));
  assert.equal(axis.checked, false);
});
