import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAlertText,
  buildReport,
  judgeDeps,
  summarizeGeneration,
  type DepResult,
} from '../deps-health.ts';

const OK: DepResult = { name: '글 생성(Anthropic)', status: 'ok', note: 'claude-sonnet-4-6 응답' };
const FAIL: DepResult = { name: '결제(PortOne)', status: 'fail', note: '토큰 발급 HTTP 401' };
const SKIP: DepResult = { name: '메일(Resend)', status: 'skipped', note: '키 미설정' };

test('fail 이 없으면 healthy', () => {
  assert.equal(judgeDeps([OK, OK]), true);
});

test('skipped 는 healthy 를 깨지 않는다 — 미설정과 고장은 다르다', () => {
  assert.equal(judgeDeps([OK, SKIP]), true);
});

test('fail 이 하나라도 있으면 healthy 가 아니다', () => {
  assert.equal(judgeDeps([OK, FAIL, SKIP]), false);
});

test('정상이면 알림 문구가 비어 있다 — 조용히 넘어간다', () => {
  const report = buildReport([OK, SKIP], summarizeGeneration(null, null, 0), 0);
  assert.equal(buildAlertText(report), '');
});

test('실패 항목만 문구에 담기고, 미설정은 괄호로 따로 적는다', () => {
  const report = buildReport([OK, FAIL, SKIP], summarizeGeneration(null, null, 0), 0);
  const text = buildAlertText(report);
  assert.match(text, /결제\(PortOne\)/);
  assert.match(text, /HTTP 401/);
  assert.match(text, /\(미설정: 메일\(Resend\)\)/);
  assert.doesNotMatch(text, /Anthropic\) — 정상/, '정상 항목을 나열하지 않는다');
});

test('경과일은 usage_logs·saved_posts 중 최신 기준이다', () => {
  const now = Date.parse('2026-08-22T00:00:00Z');
  // 실제 값: usage_logs 마지막 7/31, saved_posts 마지막 8/6 → 8/6 기준 16일
  const g = summarizeGeneration('2026-07-31T02:23:09Z', '2026-08-06T10:01:28Z', now);
  assert.equal(g.daysSince, 15);
});

test('한쪽만 있어도 계산된다', () => {
  const now = Date.parse('2026-08-22T00:00:00Z');
  assert.equal(summarizeGeneration('2026-08-20T00:00:00Z', null, now).daysSince, 2);
  assert.equal(summarizeGeneration(null, '2026-08-21T12:00:00Z', now).daysSince, 0);
});

test('기록이 없으면 null — 0일로 속이지 않는다', () => {
  assert.equal(summarizeGeneration(null, null, Date.now()).daysSince, null);
});

test('깨진 시각 문자열은 무시한다', () => {
  const now = Date.parse('2026-08-22T00:00:00Z');
  const g = summarizeGeneration('알 수 없음', '2026-08-20T00:00:00Z', now);
  assert.equal(g.daysSince, 2);
});

test('미래 시각이 와도 음수가 나오지 않는다', () => {
  const now = Date.parse('2026-08-22T00:00:00Z');
  assert.equal(summarizeGeneration('2026-09-01T00:00:00Z', null, now).daysSince, 0);
});

test('checkedAt 은 넘긴 시각을 그대로 쓴다', () => {
  const now = Date.parse('2026-08-22T05:00:00Z');
  assert.equal(buildReport([OK], summarizeGeneration(null, null, now), now).checkedAt,
    '2026-08-22T05:00:00.000Z');
});
