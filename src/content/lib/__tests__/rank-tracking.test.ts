import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findRankInResults,
  extractBlogId,
  extractNaverBlogId,
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

// ── extractNaverBlogId (프로필 입력 → 추적 대상 ID) ──
test('extractNaverBlogId: 맨몸 ID', () => {
  assert.equal(extractNaverBlogId('myclinic'), 'myclinic');
});

test('extractNaverBlogId: 도메인 경로 (프로토콜 없음)', () => {
  assert.equal(extractNaverBlogId('blog.naver.com/myclinic'), 'myclinic');
});

test('extractNaverBlogId: https 프로토콜 포함', () => {
  assert.equal(extractNaverBlogId('https://blog.naver.com/myclinic'), 'myclinic');
});

test('extractNaverBlogId: http/모바일(m.) 도메인', () => {
  assert.equal(extractNaverBlogId('http://m.blog.naver.com/myclinic'), 'myclinic');
  assert.equal(extractNaverBlogId('https://m.blog.naver.com/myclinic'), 'myclinic');
});

test('extractNaverBlogId: 포스트 경로/끝슬래시', () => {
  assert.equal(extractNaverBlogId('blog.naver.com/myclinic/223456'), 'myclinic');
  assert.equal(extractNaverBlogId('https://blog.naver.com/myclinic/'), 'myclinic');
});

test('extractNaverBlogId: 쿼리형 PostList.naver?blogId=', () => {
  assert.equal(extractNaverBlogId('blog.naver.com/PostList.naver?blogId=myclinic'), 'myclinic');
  assert.equal(extractNaverBlogId('https://blog.naver.com/PostView.nhn?blogId=myclinic&logNo=1'), 'myclinic');
});

test('extractNaverBlogId: {id}.blog.me 형태', () => {
  assert.equal(extractNaverBlogId('https://myclinic.blog.me'), 'myclinic');
  assert.equal(extractNaverBlogId('myclinic.blog.me/223'), 'myclinic');
});

test('extractNaverBlogId: 앞뒤 공백·대문자 정규화', () => {
  assert.equal(extractNaverBlogId('  MyClinic  '), 'myclinic');
  assert.equal(extractNaverBlogId(' https://blog.naver.com/MyClinic '), 'myclinic');
});

test('extractNaverBlogId: 허용 문자셋(영문·숫자·_·-)', () => {
  assert.equal(extractNaverBlogId('happy_clinic-2'), 'happy_clinic-2');
});

test('extractNaverBlogId: 빈값/비문자열은 null', () => {
  assert.equal(extractNaverBlogId(''), null);
  assert.equal(extractNaverBlogId('   '), null);
  assert.equal(extractNaverBlogId(undefined), null);
  assert.equal(extractNaverBlogId(null), null);
  assert.equal(extractNaverBlogId(123), null);
});

test('extractNaverBlogId: 타 도메인은 null', () => {
  assert.equal(extractNaverBlogId('https://example.com/myclinic'), null);
  assert.equal(extractNaverBlogId('tistory.com/myclinic'), null);
  assert.equal(extractNaverBlogId('https://blog.daum.net/myclinic'), null);
});

test('extractNaverBlogId: 길이/문자셋 위반은 null', () => {
  assert.equal(extractNaverBlogId('ab'), null);                 // 2자 (3자 미만)
  assert.equal(extractNaverBlogId('a'.repeat(21)), null);       // 21자 (20자 초과)
  assert.equal(extractNaverBlogId('my clinic'), null);          // 공백 포함 → /·. 없지만 패턴 불일치
  assert.equal(extractNaverBlogId('한글블로그'), null);          // 비허용 문자
});

test('extractNaverBlogId: 도메인은 맞지만 ID 형식 위반은 null', () => {
  assert.equal(extractNaverBlogId('blog.naver.com/ab'), null);  // 경로 ID 2자
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
