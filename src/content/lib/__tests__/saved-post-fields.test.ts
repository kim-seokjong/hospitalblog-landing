/**
 * 산출물 저장 필드 정규화 회귀 — image_urls·tags·seo_score.
 *
 * 배경(2026-W30 실측): 이미지 546장·태그 91회 생성에도 saved_posts 15/15 의
 * image_urls·tags 가 비어 있고 seo_score 는 전부 NULL 이었다.
 * 원인은 (a) 저장 페이로드 누락, (b) tags state 가 TagResult(객체)라 `text[]` 와
 * 형태 불일치, (c) 이미지가 base64 data URL 이라 애초에 저장 불가.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPersistedImageUrl,
  sanitizeImageUrls,
  sanitizeTags,
  sanitizeSeoScore,
  MAX_IMAGE_URLS,
  MAX_TAGS,
} from '../saved-post-fields.ts';
import { isAllowedClinicAssetUrl } from '../clinic-site/theme.ts';

const SUPABASE = 'https://abcdefgh.supabase.co';
const asset = (name: string): string =>
  `${SUPABASE}/storage/v1/object/public/clinic-assets/${name}`;

/* ─── image_urls ─── */

test('isPersistedImageUrl: clinic-assets public URL 만 통과', () => {
  assert.equal(isPersistedImageUrl(asset('u1/post-images/a.png'), SUPABASE), true);
});

test('isPersistedImageUrl: base64 data URL 은 거부(행 크기 폭발 방어)', () => {
  const dataUrl = `data:image/png;base64,${'A'.repeat(200)}`;
  assert.equal(isPersistedImageUrl(dataUrl, SUPABASE), false);
});

test('isPersistedImageUrl: 만료성 외부 CDN(fal.media) URL 은 거부', () => {
  assert.equal(isPersistedImageUrl('https://v3.fal.media/files/abc.png', SUPABASE), false);
});

test('isPersistedImageUrl: 다른 버킷·경로 위조는 거부', () => {
  assert.equal(
    isPersistedImageUrl(`${SUPABASE}/storage/v1/object/public/other-bucket/x.png`, SUPABASE),
    false,
  );
  assert.equal(isPersistedImageUrl('https://evil.example.com/clinic-assets/x.png', SUPABASE), false);
});

test('isPersistedImageUrl: 접두사만 있고 파일명이 없으면 거부', () => {
  assert.equal(isPersistedImageUrl(asset(''), SUPABASE), false);
});

test('isPersistedImageUrl: 과도하게 긴 URL 은 거부', () => {
  assert.equal(isPersistedImageUrl(asset('a'.repeat(600)), SUPABASE), false);
});

test('isPersistedImageUrl: supabaseUrl 미설정이면 전부 거부(설정 누락 시 오염 방지)', () => {
  assert.equal(isPersistedImageUrl(asset('u1/a.png'), undefined), false);
  assert.equal(isPersistedImageUrl(asset('u1/a.png'), ''), false);
});

// theme.ts 화이트리스트와 규칙이 어긋나면 저장은 됐는데 블로그에 안 뜨는 상태가 된다.
test('isPersistedImageUrl: clinic-site/theme.ts 화이트리스트와 판정이 일치한다', () => {
  const samples: readonly string[] = [
    asset('u1/post-images/a.png'),
    asset(''),
    'https://v3.fal.media/files/abc.png',
    `${SUPABASE}/storage/v1/object/public/other-bucket/x.png`,
    'https://evil.example.com/x.png',
    'not-a-url',
  ];
  for (const url of samples) {
    assert.equal(
      isPersistedImageUrl(url, SUPABASE),
      isAllowedClinicAssetUrl(url, SUPABASE),
      `판정 불일치: ${url}`,
    );
  }
});

test('sanitizeImageUrls: 허용 URL만 남기고 중복을 제거한다', () => {
  const a = asset('u1/a.png');
  const b = asset('u1/b.png');
  const result = sanitizeImageUrls([a, 'data:image/png;base64,AAAA', b, a, 42], SUPABASE);
  assert.deepEqual(result, [a, b]);
});

test('sanitizeImageUrls: 통과분이 없으면 null(컬럼 미설정)', () => {
  assert.equal(sanitizeImageUrls(['data:image/png;base64,AAAA'], SUPABASE), null);
  assert.equal(sanitizeImageUrls([], SUPABASE), null);
  assert.equal(sanitizeImageUrls('not-array', SUPABASE), null);
});

test('sanitizeImageUrls: 개수 상한을 넘지 않는다', () => {
  const many = Array.from({ length: MAX_IMAGE_URLS + 5 }, (_, i) => asset(`u1/${i}.png`));
  const result = sanitizeImageUrls(many, SUPABASE);
  assert.equal(result?.length, MAX_IMAGE_URLS);
});

/* ─── tags ─── */

test('sanitizeTags: TagResult 객체에서 naverTags 를 뽑는다(유실 원인 재현 방지)', () => {
  const tagResult = {
    tags: [{ tag: '허리디스크', category: '핵심', priority: 1, searchVolume: 100 }],
    hashtags: ['#허리디스크', '#요통'],
    naverTags: ['허리디스크', '요통'],
  };
  assert.deepEqual(sanitizeTags(tagResult), ['허리디스크', '요통']);
});

test('sanitizeTags: naverTags 가 비면 hashtags 로 폴백하고 # 를 벗긴다', () => {
  const result = sanitizeTags({ naverTags: [], hashtags: ['#허리디스크', '#요통'] });
  assert.deepEqual(result, ['허리디스크', '요통']);
});

test('sanitizeTags: BlogTag 객체 배열({tag})도 처리한다', () => {
  const result = sanitizeTags({ naverTags: [], hashtags: [], tags: [{ tag: '요통' }, { tag: '재활' }] });
  assert.deepEqual(result, ['요통', '재활']);
});

test('sanitizeTags: 문자열 배열은 그대로 정규화한다', () => {
  assert.deepEqual(sanitizeTags(['  요통 ', '요통', '재활']), ['요통', '재활']);
});

test('sanitizeTags: 저장할 것이 없으면 null', () => {
  assert.equal(sanitizeTags(null), null);
  assert.equal(sanitizeTags(undefined), null);
  assert.equal(sanitizeTags([]), null);
  assert.equal(sanitizeTags({ naverTags: [], hashtags: [], tags: [] }), null);
  assert.equal(sanitizeTags(123), null);
});

test('sanitizeTags: 개수 상한을 넘지 않는다', () => {
  const many = Array.from({ length: MAX_TAGS + 10 }, (_, i) => `태그${i}`);
  assert.equal(sanitizeTags(many)?.length, MAX_TAGS);
});

/* ─── seo_score ─── */

test('sanitizeSeoScore: 유효 점수는 정수로 보존', () => {
  assert.equal(sanitizeSeoScore(87), 87);
  assert.equal(sanitizeSeoScore(87.4), 87);
  assert.equal(sanitizeSeoScore(0), 0);
  assert.equal(sanitizeSeoScore(100), 100);
});

test('sanitizeSeoScore: 범위 밖·비수치는 null(22P02 저장 실패 방어)', () => {
  assert.equal(sanitizeSeoScore(-1), null);
  assert.equal(sanitizeSeoScore(101), null);
  assert.equal(sanitizeSeoScore('87'), null);
  assert.equal(sanitizeSeoScore(NaN), null);
  assert.equal(sanitizeSeoScore(Infinity), null);
  assert.equal(sanitizeSeoScore(null), null);
  assert.equal(sanitizeSeoScore(undefined), null);
});
