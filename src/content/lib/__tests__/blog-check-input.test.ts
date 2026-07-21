import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlogCheckInput, BLOG_CHECK_ALLOWED_HOSTS } from '../blog-check-input.ts';

// ── 맨몸 ID ──
test('parseBlogCheckInput: 맨몸 ID 허용 (소문자 정규화)', () => {
  assert.equal(parseBlogCheckInput('florps1'), 'florps1');
  assert.equal(parseBlogCheckInput('  FloRps1  '), 'florps1');
  assert.equal(parseBlogCheckInput('my_clinic-01'), 'my_clinic-01');
});

test('parseBlogCheckInput: 패턴 미달 ID 거부 (3~30자)', () => {
  assert.equal(parseBlogCheckInput('ab'), null);
  assert.equal(parseBlogCheckInput('a'.repeat(31)), null);
  assert.equal(parseBlogCheckInput('한글아이디'), null);
  assert.equal(parseBlogCheckInput(''), null);
  assert.equal(parseBlogCheckInput(undefined), null);
  assert.equal(parseBlogCheckInput(123 as unknown as string), null);
});

// ── URL 형태 ──
test('parseBlogCheckInput: blog.naver.com URL 허용', () => {
  assert.equal(parseBlogCheckInput('blog.naver.com/florps1'), 'florps1');
  assert.equal(parseBlogCheckInput('https://blog.naver.com/florps1'), 'florps1');
  assert.equal(parseBlogCheckInput('https://blog.naver.com/florps1/223456789'), 'florps1');
  assert.equal(parseBlogCheckInput('http://m.blog.naver.com/florps1'), 'florps1');
});

test('parseBlogCheckInput: 쿼리형 blogId 허용', () => {
  assert.equal(
    parseBlogCheckInput('https://blog.naver.com/PostList.naver?blogId=florps1'),
    'florps1',
  );
});

test('parseBlogCheckInput: 허용 외 호스트 거부 (rss·blog.me·타 도메인)', () => {
  assert.equal(parseBlogCheckInput('rss.blog.naver.com/florps1.xml'), null);
  assert.equal(parseBlogCheckInput('florps1.blog.me'), null);
  assert.equal(parseBlogCheckInput('https://evil.com/florps1'), null);
  assert.equal(parseBlogCheckInput('https://blog.naver.com.evil.com/florps1'), null);
  assert.equal(parseBlogCheckInput('https://www.blog.naver.com/florps1'), null);
});

test('parseBlogCheckInput: 시스템 경로·과대입력 거부', () => {
  assert.equal(parseBlogCheckInput('https://blog.naver.com/PostView.naver'), null);
  assert.equal(parseBlogCheckInput(`blog.naver.com/${'a'.repeat(400)}`), null);
});

test('BLOG_CHECK_ALLOWED_HOSTS: 외부 fetch 호스트는 4개 고정', () => {
  assert.deepEqual(
    [...BLOG_CHECK_ALLOWED_HOSTS].sort(),
    ['api.searchad.naver.com', 'm.blog.naver.com', 'openapi.naver.com', 'rss.blog.naver.com'],
  );
});
