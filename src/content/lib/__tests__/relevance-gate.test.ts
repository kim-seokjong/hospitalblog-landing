import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRelevancePrompt,
  parseRelevantKeywords,
  filterCandidatesByRelevance,
  RELEVANCE_GATE_MODEL,
  type RelevanceGateCreate,
} from '../relevance-gate.ts';

const GATE_ENV = { ANTHROPIC_API_KEY: 'sk-test' } as NodeJS.ProcessEnv;

/** 지정 텍스트를 반환하는 목 LLM */
const mockCreate = (text: string): RelevanceGateCreate =>
  async () => ({ content: [{ type: 'text', text }] });

// ── buildRelevancePrompt ──
test('buildRelevancePrompt: 씨앗·진료과·후보 포함', () => {
  const prompt = buildRelevancePrompt({
    seed: '보톡스',
    specialty: '피부과',
    candidates: ['사각턱보톡스', '보톡스가격'],
  });
  assert.ok(prompt.includes('보톡스'));
  assert.ok(prompt.includes('피부과'));
  assert.ok(prompt.includes('"사각턱보톡스"'));
});

test('buildRelevancePrompt: 진료과 없으면 미설정 안내', () => {
  const prompt = buildRelevancePrompt({ seed: '보톡스', candidates: ['a'] });
  assert.ok(prompt.includes('미설정'));
});

// ── parseRelevantKeywords ──
test('parseRelevantKeywords: JSON 배열 파싱 + 후보 순서 보존', () => {
  const out = parseRelevantKeywords('["보톡스가격","사각턱보톡스"]', [
    '사각턱보톡스',
    '보톡스가격',
    '무관키워드',
  ]);
  assert.deepEqual(out, ['사각턱보톡스', '보톡스가격']);
});

test('parseRelevantKeywords: 코드펜스·머리말 섞여도 파싱', () => {
  const text = '관련 키워드는 다음과 같습니다.\n```json\n["황금"]\n```';
  assert.deepEqual(parseRelevantKeywords(text, ['황금', '무관']), ['황금']);
});

test('parseRelevantKeywords: 후보에 없는 환각 키워드는 버림', () => {
  const out = parseRelevantKeywords('["황금","환각키워드"]', ['황금']);
  assert.deepEqual(out, ['황금']);
});

test('parseRelevantKeywords: JSON 아님·빈 텍스트·깨진 배열은 null', () => {
  assert.equal(parseRelevantKeywords('관련 없음', ['a']), null);
  assert.equal(parseRelevantKeywords('', ['a']), null);
  assert.equal(parseRelevantKeywords('[깨진 json', ['a']), null);
});

test('parseRelevantKeywords: 객체로 감싼 응답도 내부 배열을 구제 파싱 (recall 우선)', () => {
  assert.deepEqual(parseRelevantKeywords('{"keywords":["a"]}', ['a', 'b']), ['a']);
});

// ── filterCandidatesByRelevance: 판정 적용 ──
test('filterCandidatesByRelevance: 무관 키워드 제외·관련 키워드 유지', async () => {
  const out = await filterCandidatesByRelevance(
    {
      seed: '보톡스',
      specialty: '피부과',
      candidates: ['사각턱보톡스', '다이어트도시락', '보톡스가격'],
    },
    { env: GATE_ENV, createMessage: mockCreate('["사각턱보톡스","보톡스가격"]') }
  );
  assert.equal(out.applied, true);
  assert.deepEqual(out.keywords, ['사각턱보톡스', '보톡스가격']);
});

test('filterCandidatesByRelevance: 게이트 전용 모델·배치 1콜 사용', async () => {
  const calls: Array<{ model: string }> = [];
  const spy: RelevanceGateCreate = async (params) => {
    calls.push({ model: params.model });
    return { content: [{ type: 'text', text: '["황금"]' }] };
  };
  await filterCandidatesByRelevance(
    { seed: '주제', candidates: ['황금', '무관'] },
    { env: GATE_ENV, createMessage: spy }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, RELEVANCE_GATE_MODEL);
});

// ── filterCandidatesByRelevance: 폴백 ──
test('filterCandidatesByRelevance: LLM 실패(throw) 시 입력 그대로 폴백', async () => {
  const boom: RelevanceGateCreate = async () => {
    throw new Error('api down');
  };
  const out = await filterCandidatesByRelevance(
    { seed: '보톡스', candidates: ['a', 'b'] },
    { env: GATE_ENV, createMessage: boom }
  );
  assert.equal(out.applied, false);
  assert.deepEqual(out.keywords, ['a', 'b']);
});

test('filterCandidatesByRelevance: 타임아웃 시 입력 그대로 폴백', async () => {
  const never: RelevanceGateCreate = () => new Promise(() => {});
  const out = await filterCandidatesByRelevance(
    { seed: '보톡스', candidates: ['a', 'b'] },
    { env: GATE_ENV, createMessage: never, timeoutMs: 20 }
  );
  assert.equal(out.applied, false);
  assert.deepEqual(out.keywords, ['a', 'b']);
});

test('filterCandidatesByRelevance: JSON 아님 응답은 폴백', async () => {
  const out = await filterCandidatesByRelevance(
    { seed: '보톡스', candidates: ['a', 'b'] },
    { env: GATE_ENV, createMessage: mockCreate('판정할 수 없습니다') }
  );
  assert.equal(out.applied, false);
  assert.deepEqual(out.keywords, ['a', 'b']);
});

test('filterCandidatesByRelevance: 빈 배열(전멸 판정)은 오판정으로 보고 폴백', async () => {
  const out = await filterCandidatesByRelevance(
    { seed: '보톡스', candidates: ['a', 'b'] },
    { env: GATE_ENV, createMessage: mockCreate('[]') }
  );
  assert.equal(out.applied, false);
  assert.deepEqual(out.keywords, ['a', 'b']);
});

test('filterCandidatesByRelevance: API 키 없으면 호출 없이 스킵', async () => {
  let called = false;
  const spy: RelevanceGateCreate = async () => {
    called = true;
    return { content: [{ type: 'text', text: '[]' }] };
  };
  const out = await filterCandidatesByRelevance(
    { seed: '보톡스', candidates: ['a'] },
    { env: {} as NodeJS.ProcessEnv, createMessage: spy }
  );
  assert.equal(called, false);
  assert.equal(out.applied, false);
  assert.deepEqual(out.keywords, ['a']);
});

test('filterCandidatesByRelevance: 후보 비면 호출 없이 빈 결과', async () => {
  let called = false;
  const spy: RelevanceGateCreate = async () => {
    called = true;
    return { content: [] };
  };
  const out = await filterCandidatesByRelevance(
    { seed: '보톡스', candidates: [] },
    { env: GATE_ENV, createMessage: spy }
  );
  assert.equal(called, false);
  assert.deepEqual(out.keywords, []);
});

test('filterCandidatesByRelevance: 입력 배열 변형 없음 (불변)', async () => {
  const candidates = ['a', 'b'];
  await filterCandidatesByRelevance(
    { seed: '보톡스', candidates },
    { env: GATE_ENV, createMessage: mockCreate('["a"]') }
  );
  assert.deepEqual(candidates, ['a', 'b']);
});
