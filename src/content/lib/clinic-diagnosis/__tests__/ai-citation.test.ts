import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_QUESTIONS,
  buildDiagnosisQuestions,
  classifyCitationPath,
  hostOf,
  isOwnedSource,
  runAiCitation,
} from '../ai-citation.ts';
import { buildComplianceAxis, softenRule, type ComplianceCheckShape } from '../compliance-scan.ts';

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

/* ── 질의 생성: 비용 상한 ───────────────────────────────── */

test('질의는 상한을 넘지 않고 중복되지 않는다', () => {
  const questions = buildDiagnosisQuestions({ region: '수성구', specialty: '성형외과', clinicName: '플로르 성형외과 의원' });
  assert.ok(questions.length <= MAX_QUESTIONS, `질의 ${questions.length}개 — 상한 초과`);
  assert.equal(new Set(questions).size, questions.length);
  assert.ok(questions.some((q) => q.includes('플로르')), '지명 질의가 있어야 인지 여부를 직접 확인할 수 있다');
});

test('재료가 없으면 질의를 만들지 않는다 (빈 호출로 비용 쓰지 않음)', () => {
  assert.deepEqual(buildDiagnosisQuestions({ region: '', specialty: '', clinicName: '' }), []);
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
    () => ({ violations: [], warnings: ['환자 후기·체험담 형식은 의료법 제56조 심의 대상입니다.'] }),
  );
  assert.equal(axis.hits.length, 1);
  assert.equal(axis.hits[0].level, 'caution');
  assert.match(axis.hits[0].note, /확인이 필요합니다/);
});

test('검사할 글이 없으면 checked=false — "문제 없음"으로 오독되지 않는다', () => {
  const axis = buildComplianceAxis([], () => ({ violations: [], warnings: [] }));
  assert.equal(axis.checked, false);
});
