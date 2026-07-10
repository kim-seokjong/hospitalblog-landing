import test from 'node:test';
import assert from 'node:assert/strict';
import { computePublishFrequency, parsePostDate } from '../scoreboard/publish-frequency.ts';
import { parseCount } from '../scoreboard/fetch-utils.ts';

// ── parsePostDate ──
test('parsePostDate: YYYYMMDD 정상 파싱', () => {
  const d = parsePostDate('20260701');
  assert.ok(d);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6);
  assert.equal(d.getDate(), 1);
});

test('parsePostDate: 비정상 입력은 null', () => {
  assert.equal(parsePostDate(''), null);
  assert.equal(parsePostDate('2026-07-01'), null);
  assert.equal(parsePostDate('20261301'), null); // 13월
  assert.equal(parsePostDate('abcd1234'), null);
});

// ── computePublishFrequency ──
function makePost(bloggername: string, postdate: string) {
  return { title: 't', description: 'd', link: 'l', postdate, bloggername };
}

test('computePublishFrequency: 30일 이내 글만 블로거별 집계·내림차순', () => {
  const now = new Date(2026, 6, 10); // 2026-07-10
  const posts = [
    makePost('A블로그', '20260709'),
    makePost('A블로그', '20260701'),
    makePost('A블로그', '20260620'),
    makePost('B블로그', '20260705'),
    makePost('B블로그', '20260401'), // 30일 밖 — 제외
    makePost('', '20260709'),        // 이름 없음 — 제외
  ];
  const result = computePublishFrequency(posts, now);

  assert.equal(result.windowDays, 30);
  assert.equal(result.sampleSize, 4);
  assert.equal(result.bloggers.length, 2);
  assert.equal(result.bloggers[0].bloggerName, 'A블로그');
  assert.equal(result.bloggers[0].postsIn30Days, 3);
  assert.equal(result.bloggers[0].perWeek, 0.7); // 3/30*7 = 0.7
  assert.equal(result.bloggers[1].postsIn30Days, 1);
});

test('computePublishFrequency: 빈 입력은 빈 결과', () => {
  const result = computePublishFrequency([]);
  assert.equal(result.bloggers.length, 0);
  assert.equal(result.sampleSize, 0);
});

test('computePublishFrequency: 잘못된 postdate 는 제외 (에러 없이)', () => {
  const result = computePublishFrequency([makePost('A', 'invalid')], new Date(2026, 6, 10));
  assert.equal(result.bloggers.length, 0);
});

// ── parseCount (소셜/플레이스 수치 표기 파싱) ──
test('parseCount: 콤마·접미사 표기 파싱', () => {
  assert.equal(parseCount('1,234'), 1234);
  assert.equal(parseCount('12.5K'), 12500);
  assert.equal(parseCount('1.2M'), 1200000);
  assert.equal(parseCount('1.2만'), 12000);
  assert.equal(parseCount('3천'), 3000);
  assert.equal(parseCount(120), 120);
});

test('parseCount: 비정상 입력은 null', () => {
  assert.equal(parseCount(null), null);
  assert.equal(parseCount(undefined), null);
  assert.equal(parseCount(''), null);
  assert.equal(parseCount('abc'), null);
  assert.equal(parseCount(Number.NaN), null);
});
