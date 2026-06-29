import test from 'node:test';
import assert from 'node:assert/strict';
import { GEO_ANSWER_FIRST_RULES } from '../geo-answer-first.ts';

// google-prompts.ts 는 @/ alias 값 import(medical-compliance)를 정적으로 끌어와
// node 테스트 러너에서 직접 로드할 수 없으므로, GEO 모드에 주입되는 직답/중복금지
// 지시문을 의존성 없는 모듈로 분리해 내용을 검증한다(빌더는 이 상수를 GEO 블록에 합성).

test('GEO 직답 규칙: answer-first 직답 지시 포함', () => {
  assert.match(GEO_ANSWER_FIRST_RULES, /직답/);
  assert.match(GEO_ANSWER_FIRST_RULES, /answer-first/);
  assert.match(GEO_ANSWER_FIRST_RULES, /자족/);
  assert.match(GEO_ANSWER_FIRST_RULES, /100~200자/);
  // 추천 스니펫/answer box 발췌 최적화 의도 명시
  assert.match(GEO_ANSWER_FIRST_RULES, /추천 스니펫|answer box/);
});

test('GEO 직답 규칙: 세 역할 중복 금지 명시', () => {
  assert.match(GEO_ANSWER_FIRST_RULES, /중복 금지/);
  assert.match(GEO_ANSWER_FIRST_RULES, /\[핵심 요약\]/);
  assert.match(GEO_ANSWER_FIRST_RULES, /\[자주 묻는 질문\]/);
  assert.match(GEO_ANSWER_FIRST_RULES, /복붙|반복/);
});

test('GEO 직답 규칙: 의료광고법 한도(효과·수치 단정·비교·과장 금지) 명시', () => {
  assert.match(GEO_ANSWER_FIRST_RULES, /의료광고법/);
  assert.match(GEO_ANSWER_FIRST_RULES, /단정|비교|과장/);
});

test('GEO 직답 규칙: 분량을 늘리라는 지시가 아님(직답은 첫 1~2문장 한정)', () => {
  // "첫 1~2문장"으로 직답을 한정해 본문 분량 목표를 키우지 않음
  assert.match(GEO_ANSWER_FIRST_RULES, /첫 1~2문장/);
  // 출력 서식 깨짐 방지: 마크다운 헤더/볼드 기호를 포함하지 않음
  assert.doesNotMatch(GEO_ANSWER_FIRST_RULES, /^#{1,6}\s|\*\*/m);
});
