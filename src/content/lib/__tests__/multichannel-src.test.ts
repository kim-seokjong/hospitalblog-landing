import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MULTICHANNEL_SRC_KEY,
  encodeMultichannelSrc,
  decodeMultichannelSrc,
} from '../multichannel-src.ts';

test('키 상수: 기존 sessionStorage 키와 동일 (하위 호환)', () => {
  assert.equal(MULTICHANNEL_SRC_KEY, 'dp_multichannel_src');
});

// ── encode ──

test('encode: postId 없으면 평문 그대로 (구 포맷 유지)', () => {
  assert.equal(encodeMultichannelSrc({ text: '제목\n\n본문', postId: null }), '제목\n\n본문');
  assert.equal(encodeMultichannelSrc({ text: '본문', postId: '  ' }), '본문');
});

test('encode: postId 있으면 v2 JSON 포맷', () => {
  const raw = encodeMultichannelSrc({ text: '제목\n\n본문', postId: 'post-1' });
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(parsed.dp, 'mc-src');
  assert.equal(parsed.v, 2);
  assert.equal(parsed.postId, 'post-1');
  assert.equal(parsed.text, '제목\n\n본문');
});

// ── decode ──

test('decode: 평문(구 포맷) → text 만, postId 는 null', () => {
  assert.deepEqual(decodeMultichannelSrc('  임플란트 관리법 본문  '), {
    text: '임플란트 관리법 본문',
    postId: null,
  });
});

test('decode: null/빈 문자열 → 빈 소스', () => {
  assert.deepEqual(decodeMultichannelSrc(null), { text: '', postId: null });
  assert.deepEqual(decodeMultichannelSrc(undefined), { text: '', postId: null });
  assert.deepEqual(decodeMultichannelSrc('   '), { text: '', postId: null });
});

test('decode: encode 라운드트립 (postId 유/무)', () => {
  const withId = { text: '제목\n\n본문', postId: 'abc-123' };
  assert.deepEqual(decodeMultichannelSrc(encodeMultichannelSrc(withId)), withId);
  const withoutId = { text: '제목\n\n본문', postId: null };
  assert.deepEqual(decodeMultichannelSrc(encodeMultichannelSrc(withoutId)), withoutId);
});

test("decode: '{'로 시작하는 붙여넣기 본문(JSON 아님/마커 없음)은 평문으로", () => {
  assert.deepEqual(decodeMultichannelSrc('{이런 식으로 시작하는 본문}'), {
    text: '{이런 식으로 시작하는 본문}',
    postId: null,
  });
  // 유효한 JSON 이지만 우리 포맷 마커가 없으면 평문 취급
  const alien = JSON.stringify({ text: '남의 포맷', postId: 'x' });
  assert.deepEqual(decodeMultichannelSrc(alien), { text: alien, postId: null });
});

test('decode: v2 포맷의 비정상 postId(비문자열/공백)는 null 로', () => {
  const raw = JSON.stringify({ dp: 'mc-src', v: 2, postId: 123, text: '본문' });
  assert.deepEqual(decodeMultichannelSrc(raw), { text: '본문', postId: null });
  const blank = JSON.stringify({ dp: 'mc-src', v: 2, postId: '  ', text: '본문' });
  assert.deepEqual(decodeMultichannelSrc(blank), { text: '본문', postId: null });
});
