import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTargetKeywords,
  findRegionToken,
  findProcedureTerms,
  parseLlmKeywords,
  extractKeywordsWithLlmFallback,
  BLOG_CHECK_KEYWORD_LIMIT,
} from '../blog-check-keywords.ts';
import type { RelevanceGateCreate } from '../relevance-gate.ts';

// ── findRegionToken ──
test('findRegionToken: 사전 지명·행정단위 접미어 인식', () => {
  assert.equal(findRegionToken('수성구 도수치료 후기'), '수성구');
  assert.equal(findRegionToken('강남 보톡스 가격'), '강남');
  assert.equal(findRegionToken('범어동 피부과 안내'), '범어동');
  assert.equal(findRegionToken('도수치료가 필요한 이유'), '');
});

// ── findProcedureTerms ──
test('findProcedureTerms: 긴 용어 우선 매칭 (부분문자열 중복 없음)', () => {
  assert.deepEqual(findProcedureTerms('레이저토닝 5회 프로그램'), ['레이저토닝']);
  assert.ok(findProcedureTerms('허리디스크와 도수치료 이야기').includes('허리디스크'));
  assert.ok(findProcedureTerms('허리디스크와 도수치료 이야기').includes('도수치료'));
  assert.deepEqual(findProcedureTerms('일상 이야기'), []);
});

// ── extractTargetKeywords ──
test('extractTargetKeywords: 지역+시술 결합·빈도 정렬', () => {
  const titles = [
    '수성구 도수치료 잘하는 곳',
    '수성구 도수치료 비용 안내',
    '허리디스크 비수술 치료',
    '수성구 체외충격파 치료 후기',
  ];
  const out = extractTargetKeywords(titles);
  assert.equal(out[0].keyword, '수성구 도수치료');
  assert.equal(out[0].count, 2);
  assert.equal(out[0].base, '도수치료');
  assert.equal(out[0].region, '수성구');
  // 지역 없는 시술어는 대표 지역(수성구)과 결합
  assert.ok(out.some((c) => c.keyword === '수성구 허리디스크'));
});

test('extractTargetKeywords: 지역이 전혀 없으면 시술어 단독 후보', () => {
  const out = extractTargetKeywords(['보톡스 시술 안내', '필러 상담 후기']);
  assert.deepEqual(out.map((c) => c.keyword).sort(), ['보톡스', '필러']);
  assert.equal(out[0].region, '');
});

test('extractTargetKeywords: limit 준수·비정상 입력 방어', () => {
  const titles = Array.from({ length: 40 }, (_, i) => `수성구 도수치료 ${i} 임플란트 보톡스 필러 라식`);
  const out = extractTargetKeywords(titles);
  assert.ok(out.length <= BLOG_CHECK_KEYWORD_LIMIT);
  assert.deepEqual(extractTargetKeywords([]), []);
  assert.deepEqual(extractTargetKeywords([null as unknown as string, '']), []);
});

// ── parseLlmKeywords ──
test('parseLlmKeywords: 코드펜스 섞여도 배열 추출, 중복·비정상 원소 제거', () => {
  const text = '결과입니다:\n```json\n["수성구 도수치료", "수성구  도수치료", 42, "강남 보톡스"]\n```';
  assert.deepEqual(parseLlmKeywords(text, 10), ['수성구 도수치료', '강남 보톡스']);
});

test('parseLlmKeywords: 파싱 불가·빈 배열 → null', () => {
  assert.equal(parseLlmKeywords('배열 없음', 10), null);
  assert.equal(parseLlmKeywords('[]', 10), null);
  assert.equal(parseLlmKeywords('', 10), null);
});

// ── extractKeywordsWithLlmFallback ──
const ruleCands = [
  { keyword: '수성구 도수치료', base: '도수치료', region: '수성구', count: 3 },
];

test('LLM 폴백: 규칙 결과가 충분하면(4개 이상) LLM 호출 안 함', async () => {
  const enough = Array.from({ length: 4 }, (_, i) => ({
    keyword: `키워드${i}`, base: `키워드${i}`, region: '', count: 1,
  }));
  let called = false;
  const createMessage: RelevanceGateCreate = async () => {
    called = true;
    return { content: [] };
  };
  const out = await extractKeywordsWithLlmFallback([], enough, {
    env: { ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv,
    createMessage,
  });
  assert.equal(called, false);
  assert.equal(out.length, 4);
});

test('LLM 폴백: 키 없으면 스킵, 실패 시 규칙 결과 유지 (never throws)', async () => {
  const noKey = await extractKeywordsWithLlmFallback(['제목'], ruleCands, {
    env: {} as NodeJS.ProcessEnv,
  });
  assert.deepEqual(noKey.map((c) => c.keyword), ['수성구 도수치료']);

  const failed = await extractKeywordsWithLlmFallback(['제목'], ruleCands, {
    env: { ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv,
    createMessage: async () => {
      throw new Error('api down');
    },
  });
  assert.deepEqual(failed.map((c) => c.keyword), ['수성구 도수치료']);
});

test('LLM 폴백: 응답 키워드를 규칙 결과 뒤에 병합 (중복 제거)', async () => {
  const createMessage: RelevanceGateCreate = async () => ({
    content: [{ type: 'text', text: '["수성구 도수치료", "수성구 체외충격파", "대구 재활치료"]' }],
  });
  const out = await extractKeywordsWithLlmFallback(['제목'], ruleCands, {
    env: { ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv,
    createMessage,
  });
  assert.equal(out[0].keyword, '수성구 도수치료'); // 규칙 우선
  assert.ok(out.some((c) => c.keyword === '수성구 체외충격파'));
  assert.equal(out.filter((c) => c.keyword === '수성구 도수치료').length, 1);
});
