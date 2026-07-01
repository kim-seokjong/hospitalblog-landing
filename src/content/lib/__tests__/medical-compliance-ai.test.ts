import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAiReviewResponse } from '../medical-compliance-ai.ts';

// ── 정상 JSON 배열 파싱 ──
test('parseAiReviewResponse: 정상 JSON 배열 파싱', () => {
  const text = JSON.stringify([
    { category: '환자유인·알선', snippet: '반값 이벤트', severity: 'HIGH', reason: '유인 소지', needsReview: true },
  ]);
  const findings = parseAiReviewResponse(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, '환자유인·알선');
  assert.equal(findings[0].severity, 'HIGH');
  assert.equal(findings[0].needsReview, true);
});

// ── 코드펜스·머리말이 섞여도 배열만 추출 ──
test('parseAiReviewResponse: 코드펜스/머리말 섞여도 파싱', () => {
  const text = '다음은 심의 결과입니다:\n```json\n[{"category":"과장·최상급","snippet":"최고","severity":"MEDIUM","reason":"최상급","needsReview":true}]\n```';
  const findings = parseAiReviewResponse(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'MEDIUM');
});

// ── 빈 배열 응답 ──
test('parseAiReviewResponse: 빈 배열은 빈 결과', () => {
  assert.deepEqual(parseAiReviewResponse('[]'), []);
});

// ── 잘못된 JSON → 빈 배열(throw 금지) ──
test('parseAiReviewResponse: 깨진 JSON 은 빈 배열', () => {
  assert.deepEqual(parseAiReviewResponse('[{ broken'), []);
  assert.deepEqual(parseAiReviewResponse('설명만 있고 배열 없음'), []);
  assert.deepEqual(parseAiReviewResponse(''), []);
});

// ── 불명 severity 는 LOW 로 강제(recall 우선) ──
test('parseAiReviewResponse: 불명 severity 는 LOW 로 정규화', () => {
  const text = '[{"category":"심의미필","snippet":"x","severity":"위험","reason":"애매","needsReview":true}]';
  const findings = parseAiReviewResponse(text);
  assert.equal(findings[0].severity, 'LOW');
});

// ── needsReview: 명시적 false 만 false, 나머지는 true(recall 우선) ──
test('parseAiReviewResponse: needsReview 는 명시적 false 만 false', () => {
  const t1 = '[{"category":"과장·최상급","snippet":"x","severity":"LOW","reason":"r","needsReview":false}]';
  assert.equal(parseAiReviewResponse(t1)[0].needsReview, false);
  const t2 = '[{"category":"과장·최상급","snippet":"x","severity":"LOW","reason":"r"}]';
  assert.equal(parseAiReviewResponse(t2)[0].needsReview, true);
});

// ── 완전 빈 원소는 스킵 ──
test('parseAiReviewResponse: 완전 빈 원소는 스킵', () => {
  const text = '[{}, {"category":"비교·비방","snippet":"타 병원","severity":"HIGH","reason":"비교","needsReview":true}]';
  const findings = parseAiReviewResponse(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, '비교·비방');
});
