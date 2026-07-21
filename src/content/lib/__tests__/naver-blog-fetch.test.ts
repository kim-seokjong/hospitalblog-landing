import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedNaverPostUrl, parseNaverBlogId } from '../naver-blog-fetch.ts';

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

// ── parseNaverBlogId 스모크 (기존 동작 회귀 가드) ──
test('parseNaverBlogId: 기본 형태 파싱 유지', () => {
  assert.equal(parseNaverBlogId('blog.naver.com/myclinic'), 'myclinic');
  assert.equal(parseNaverBlogId('myclinic'), 'myclinic');
  assert.equal(parseNaverBlogId('https://evil.com/x'), null);
});
