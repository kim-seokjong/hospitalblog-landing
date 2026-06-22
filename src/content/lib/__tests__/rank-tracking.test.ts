import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findRankInResults,
  extractBlogId,
  type BlogSearchResult,
} from '../rank-tracking.ts';

function r(link: string, bloggername = ''): BlogSearchResult {
  return { link, bloggername };
}

// ── extractBlogId ──
test('extractBlogId: blog.naver.com/{id}/{logNo}', () => {
  assert.equal(extractBlogId('https://blog.naver.com/happyclinic/223456789'), 'happyclinic');
});

test('extractBlogId: m.blog.naver.com 모바일도 추출', () => {
  assert.equal(extractBlogId('https://m.blog.naver.com/happyclinic/223456789'), 'happyclinic');
});

test('extractBlogId: {id}.blog.me 형태', () => {
  assert.equal(extractBlogId('https://happyclinic.blog.me/223456789'), 'happyclinic');
});

test('extractBlogId: 비블로그 URL/빈값은 빈문자열', () => {
  assert.equal(extractBlogId('https://example.com/post'), '');
  assert.equal(extractBlogId(''), '');
});

// ── findRankInResults: 우선순위 ──
test('publishedUrl 정확 일치가 1순위', () => {
  const results = [
    r('https://blog.naver.com/other/1'),
    r('https://blog.naver.com/happyclinic/223456789'),
    r('https://blog.naver.com/another/3'),
  ];
  const rank = findRankInResults(results, {
    blogId: 'happyclinic',
    publishedUrl: 'https://blog.naver.com/happyclinic/223456789',
  });
  assert.equal(rank, 2);
});

test('publishedUrl 프로토콜/모바일 차이 부분 일치', () => {
  const results = [r('https://m.blog.naver.com/happyclinic/223456789')];
  const rank = findRankInResults(results, {
    publishedUrl: 'http://blog.naver.com/happyclinic/223456789',
  });
  assert.equal(rank, 1);
});

test('publishedUrl 없으면 link 의 blogId 매칭', () => {
  const results = [
    r('https://blog.naver.com/other/1'),
    r('https://blog.naver.com/other2/2'),
    r('https://blog.naver.com/happyclinic/9'),
  ];
  assert.equal(findRankInResults(results, { blogId: 'happyclinic' }), 3);
});

test('link 매칭 실패 시 bloggername 매칭', () => {
  const results = [
    r('https://blog.naver.com/PostView.nhn?blogId=x&logNo=1', 'happyclinic'),
  ];
  assert.equal(findRankInResults(results, { blogId: 'happyclinic' }), 1);
});

test('가장 먼저 매칭되는 결과의 1-base 위치 반환', () => {
  const results = [
    r('https://blog.naver.com/happyclinic/1'),
    r('https://blog.naver.com/happyclinic/2'),
  ];
  assert.equal(findRankInResults(results, { blogId: 'happyclinic' }), 1);
});

// ── 미발견 / 방어 ──
test('매칭 없으면 null', () => {
  const results = [r('https://blog.naver.com/someoneelse/1')];
  assert.equal(findRankInResults(results, { blogId: 'happyclinic' }), null);
});

test('빈 배열/undefined/null 은 null', () => {
  assert.equal(findRankInResults([], { blogId: 'x' }), null);
  assert.equal(findRankInResults(undefined, { blogId: 'x' }), null);
  assert.equal(findRankInResults(null, { blogId: 'x' }), null);
});

test('blogId·publishedUrl 둘 다 없으면 null', () => {
  const results = [r('https://blog.naver.com/happyclinic/1')];
  assert.equal(findRankInResults(results, {}), null);
});

test('잘못된 항목(누락/빈값)은 건너뛴다', () => {
  // 타입 강제로 비정상 항목 섞기
  const results = [
    { link: '', bloggername: '' } as BlogSearchResult,
    r('https://blog.naver.com/happyclinic/1'),
  ];
  assert.equal(findRankInResults(results, { blogId: 'happyclinic' }), 2);
});

test('blogId 부분문자열 오탐 방지: /happyclinic 경계 매칭', () => {
  // happyclinic2 는 happyclinic 과 다른 블로그
  const results = [r('https://blog.naver.com/happyclinic2/1')];
  // extractBlogId 가 happyclinic2 를 뽑으므로 happyclinic 과 불일치 → null
  assert.equal(findRankInResults(results, { blogId: 'happyclinic' }), null);
});
