import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findRankInResults,
  findPostRank,
  titleSimilarity,
  extractBlogId,
  extractNaverBlogId,
  type BlogSearchResult,
} from '../rank-tracking.ts';

function r(link: string, bloggername = '', title = ''): BlogSearchResult {
  return { link, bloggername, title };
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

test('내 글이 1건만 잡히면 그 위치 반환', () => {
  const results = [
    r('https://blog.naver.com/other/1'),
    r('https://blog.naver.com/happyclinic/2'),
  ];
  assert.equal(findRankInResults(results, { blogId: 'happyclinic' }), 2);
});

// ★ 회귀 (수정 전 동작): 같은 블로그 글 2편이 잡히면 예전 로직은 둘 다 "1위"로 기록했다.
//    이제는 제목 단서 없이 단정하지 않는다 → ambiguous.
test('★ 같은 블로그 글이 여럿인데 제목 단서가 없으면 순위를 단정하지 않는다', () => {
  const results = [
    r('https://blog.naver.com/happyclinic/1'),
    r('https://blog.naver.com/happyclinic/2'),
  ];
  const outcome = findPostRank(results, { blogId: 'happyclinic' });
  assert.equal(outcome.found, false);
  assert.equal(outcome.found === false && outcome.ambiguous, true);
  assert.equal(findRankInResults(results, { blogId: 'happyclinic' }), null);
});

test('★ 제목이 있으면 같은 블로그 글 여러 편 중 올바른 글을 고른다', () => {
  const results = [
    r('https://blog.naver.com/happyclinic/1', '', '구로동치과 신경치료 실패 줄이는 3가지 주의사항'),
    r('https://blog.naver.com/happyclinic/2', '', '구로동치과 신경치료 전 알아야 할 4가지 핵심 체크리스트'),
  ];
  const outcome = findPostRank(results, {
    blogId: 'happyclinic',
    title: '구로동치과 신경치료 전 알아야 할 4가지 핵심 체크리스트',
  });
  assert.equal(outcome.found, true);
  assert.equal(outcome.found && outcome.match.rank, 2);
  assert.equal(outcome.found && outcome.match.matchedBy, 'title');
});

test('publishedUrl 이 있으면 제목·blogId 보다 우선한다', () => {
  const results = [
    r('https://blog.naver.com/happyclinic/1', '', '완전히 똑같은 제목'),
    r('https://blog.naver.com/happyclinic/2', '', '다른 제목'),
  ];
  const outcome = findPostRank(results, {
    blogId: 'happyclinic',
    title: '완전히 똑같은 제목',
    publishedUrl: 'https://blog.naver.com/happyclinic/2',
  });
  assert.equal(outcome.found && outcome.match.rank, 2);
  assert.equal(outcome.found && outcome.match.matchedBy, 'url');
});

// ── startOffset (페이지 순회) ──
test('★ startOffset 으로 2페이지 이후 순위를 계산한다 (101위~)', () => {
  const results = [r('https://blog.naver.com/happyclinic/1')];
  const outcome = findPostRank(results, { blogId: 'happyclinic', startOffset: 100 });
  assert.equal(outcome.found && outcome.match.rank, 101);
});

test('startOffset 미지정/비정상 값은 0 취급', () => {
  const results = [r('https://blog.naver.com/happyclinic/1')];
  assert.equal(findRankInResults(results, { blogId: 'happyclinic', startOffset: -5 }), 1);
  assert.equal(findRankInResults(results, { blogId: 'happyclinic', startOffset: NaN }), 1);
});

test('matchedLink 는 원본 표기(대소문자 보존)를 돌려준다', () => {
  const results = [r('https://blog.naver.com/HappyClinic/223456')];
  const outcome = findPostRank(results, { blogId: 'happyclinic' });
  assert.equal(outcome.found && outcome.match.link, 'https://blog.naver.com/HappyClinic/223456');
});

// ── titleSimilarity ──
test('titleSimilarity: 동일 제목은 1', () => {
  assert.equal(titleSimilarity('사랑니 발치 총정리', '사랑니 발치 총정리'), 1);
});

test('titleSimilarity: 특수문자·공백 차이는 무시', () => {
  assert.equal(titleSimilarity('사랑니 발치, 총정리!', '사랑니발치총정리'), 1);
});

test('titleSimilarity: 말줄임(부분 포함)도 강한 일치', () => {
  assert.equal(titleSimilarity('구로동치과 신경치료 실패 줄이는 3가지 주의사항', '구로동치과 신경치료 실패 줄이는'), 1);
});

test('titleSimilarity: 무관한 제목은 낮다', () => {
  assert.ok(titleSimilarity('사랑니 발치 총정리', '임플란트 건강보험 적용 기준') < 0.3);
});

test('titleSimilarity: 빈값은 0', () => {
  assert.equal(titleSimilarity('', '무언가'), 0);
  assert.equal(titleSimilarity(null, undefined), 0);
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
