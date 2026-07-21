import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedNaverPostUrl,
  isAllowedNaverFetchUrl,
  resolveSafeRedirect,
  parseNaverBlogId,
} from '../naver-blog-fetch.ts';

// ── isAllowedNaverPostUrl: RSS item.link 폴백의 고정 호스트 불변식 ──
test('isAllowedNaverPostUrl: https + 네이버 블로그 호스트만 허용', () => {
  assert.equal(isAllowedNaverPostUrl('https://blog.naver.com/myclinic/223456789'), true);
  assert.equal(isAllowedNaverPostUrl('https://m.blog.naver.com/myclinic/223456789'), true);
});

test('isAllowedNaverPostUrl: http·타 호스트·서브도메인 위장·비URL 전부 거부', () => {
  assert.equal(isAllowedNaverPostUrl('http://blog.naver.com/myclinic/1'), false); // https 아님
  assert.equal(isAllowedNaverPostUrl('https://evil.com/blog.naver.com/myclinic'), false);
  assert.equal(isAllowedNaverPostUrl('https://blog.naver.com.evil.com/myclinic'), false);
  assert.equal(isAllowedNaverPostUrl('https://rss.blog.naver.com/myclinic.xml'), false);
  assert.equal(isAllowedNaverPostUrl('not-a-url'), false);
  assert.equal(isAllowedNaverPostUrl(''), false);
  assert.equal(isAllowedNaverPostUrl(null as unknown as string), false);
});

// ── resolveSafeRedirect: 리다이렉트 수동 추적의 허용 판정 ──
test('resolveSafeRedirect: 허용 호스트로의 리다이렉트만 추적 (상대 경로 해석 포함)', () => {
  // 절대 URL — 허용 호스트
  assert.equal(
    resolveSafeRedirect('https://blog.naver.com/c/1', 'https://m.blog.naver.com/c/1'),
    'https://m.blog.naver.com/c/1',
  );
  // 상대 경로 — 현재 URL 기준 해석
  assert.equal(
    resolveSafeRedirect('https://m.blog.naver.com/c/1', '/PostView.naver?blogId=c&logNo=1'),
    'https://m.blog.naver.com/PostView.naver?blogId=c&logNo=1',
  );
});

test('resolveSafeRedirect: 허용→비허용 리다이렉트 거부 (호스트 이탈·http 강등·무Location)', () => {
  assert.equal(resolveSafeRedirect('https://blog.naver.com/c/1', 'https://evil.com/steal'), null);
  assert.equal(resolveSafeRedirect('https://blog.naver.com/c/1', 'http://blog.naver.com/c/1'), null);
  assert.equal(resolveSafeRedirect('https://blog.naver.com/c/1', null), null);
  assert.equal(resolveSafeRedirect('https://blog.naver.com/c/1', ''), null);
});

test('isAllowedNaverFetchUrl: rss·blog·m 3개 호스트 + https 만', () => {
  assert.equal(isAllowedNaverFetchUrl('https://rss.blog.naver.com/c.xml'), true);
  assert.equal(isAllowedNaverFetchUrl('https://blog.naver.com/c'), true);
  assert.equal(isAllowedNaverFetchUrl('https://m.blog.naver.com/c'), true);
  assert.equal(isAllowedNaverFetchUrl('http://blog.naver.com/c'), false);
  assert.equal(isAllowedNaverFetchUrl('https://evil.com/blog.naver.com'), false);
});

// ── parseNaverBlogId 스모크 (기존 동작 회귀 가드) ──
test('parseNaverBlogId: 기본 형태 파싱 유지', () => {
  assert.equal(parseNaverBlogId('blog.naver.com/myclinic'), 'myclinic');
  assert.equal(parseNaverBlogId('myclinic'), 'myclinic');
  assert.equal(parseNaverBlogId('https://evil.com/x'), null);
});
