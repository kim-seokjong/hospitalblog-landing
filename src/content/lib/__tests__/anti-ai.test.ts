import test from 'node:test';
import assert from 'node:assert/strict';
import { stripAiCliches } from '../anti-ai.ts';

// ── 빈 입력 ──
test('stripAiCliches: 빈 문자열은 그대로 반환', () => {
  const r = stripAiCliches('');
  assert.equal(r.cleaned, '');
  assert.deepEqual(r.detected, []);
});

// ── 문단 첫머리 접속 상투어 제거 ──
test('stripAiCliches: 줄 첫머리 "또한," 제거', () => {
  const r = stripAiCliches('또한, 시술 후 관리가 중요합니다.');
  assert.equal(r.cleaned, '시술 후 관리가 중요합니다.');
  assert.deepEqual(r.detected, ['또한']);
});

test('stripAiCliches: 여러 줄의 첫머리 상투어 각각 제거', () => {
  const input = '따라서, 충분한 휴식이 필요합니다.\n\n먼저, 진료를 받으세요.';
  const r = stripAiCliches(input);
  assert.equal(r.cleaned, '충분한 휴식이 필요합니다.\n\n진료를 받으세요.');
  assert.deepEqual(r.detected.sort(), ['따라서', '먼저']);
});

// ── 문맥 보호: 문장 중간의 같은 단어는 건드리지 않음 ──
test('stripAiCliches: 문장 중간 "또한"은 보존(문맥 보호)', () => {
  const input = '환자분도 또한, 같은 증상을 호소했습니다.';
  const r = stripAiCliches(input);
  assert.equal(r.cleaned, input);
  assert.deepEqual(r.detected, []);
});

test('stripAiCliches: 쉼표 없는 줄 첫머리 단어는 보존', () => {
  const input = '또한 이것은 제거 대상이 아닙니다.';
  const r = stripAiCliches(input);
  assert.equal(r.cleaned, input);
  assert.deepEqual(r.detected, []);
});

// ── 마무리 인사 상투어: 검출만, 삭제 금지 ──
test('stripAiCliches: 문단 첫머리 "마지막으로"는 검출만 하고 보존', () => {
  const input = '본문입니다.\n\n마지막으로 정리하겠습니다.';
  const r = stripAiCliches(input);
  assert.equal(r.cleaned, input);
  assert.deepEqual(r.detected, ['마지막으로']);
});

test('stripAiCliches: 문장 중간 "마지막으로"는 검출하지 않음', () => {
  const input = '이번이 마지막으로 받는 시술입니다.';
  const r = stripAiCliches(input);
  assert.equal(r.cleaned, input);
  assert.deepEqual(r.detected, []);
});

// ── 구조 토큰 보존 ──
test('stripAiCliches: 구조 토큰은 손상되지 않음', () => {
  const input =
    '[이미지 1: 진료 장면]\n▶ 세부 소제목\n[핵심 요약]\n요약 내용\n[/핵심 요약]\nQ1. 질문\nA1. 답변';
  const r = stripAiCliches(input);
  assert.equal(r.cleaned, input);
  assert.deepEqual(r.detected, []);
});

// ── 빈 줄 정돈 ──
test('stripAiCliches: 빈 줄 3개 이상은 2개로 정돈', () => {
  const r = stripAiCliches('첫 문단.\n\n\n\n둘째 문단.');
  assert.equal(r.cleaned, '첫 문단.\n\n둘째 문단.');
});

// ── 중복 제거 ──
test('stripAiCliches: detected는 중복 제거', () => {
  const input = '또한, 첫째.\n\n또한, 둘째.';
  const r = stripAiCliches(input);
  assert.deepEqual(r.detected, ['또한']);
});

// ── 들여쓰기 보존 ──
test('stripAiCliches: 줄 첫머리 들여쓰기는 보존하고 상투어만 제거', () => {
  const input = '  따라서, 결과가 좋습니다.';
  const r = stripAiCliches(input);
  assert.equal(r.cleaned, '  결과가 좋습니다.');
  assert.deepEqual(r.detected, ['따라서']);
});
