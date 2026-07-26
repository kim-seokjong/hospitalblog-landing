/**
 * 서브블로그 본문 이미지 배치 — 회귀 테스트.
 *
 * 고정하는 계약:
 *  1) 마커 위치에 이미지가 들어간다 (N ↔ image_urls[N-1]).
 *  2) 이미지가 없는 글은 마커가 사라진 기존 렌더와 **완전히 동일**하다(회귀 금지).
 *  3) 허용되지 않은 URL(외부·data·http)은 절대 렌더되지 않는다.
 *  4) URL 화이트리스트 판정이 theme.ts `isAllowedClinicAssetUrl` 과 동치다.
 *  5) 대표 이미지(OG·JSON-LD)는 첫 렌더 이미지다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClinicPostImages,
  buildImageAlt,
  extractImageDescriptions,
  MAX_ALT_LENGTH,
  MAX_BODY_IMAGES,
  pickLeadImageUrl,
  sanitizeClinicImageUrls,
} from '../post-images.ts';
import { isAllowedClinicAssetUrl } from '../theme.ts';
import { renderBodyHtml } from '../../geo-export.ts';
import {
  buildArticleSchema,
  stripStructureBlocks,
  stripSummaryAndFaqBlocks,
} from '../../geo-schema.ts';

const SUPABASE = 'https://proj.supabase.co';
const asset = (name: string) => `${SUPABASE}/storage/v1/object/public/clinic-assets/u1/post-images/${name}`;

const IMG1 = asset('a.png');
const IMG2 = asset('b.png');
const IMG3 = asset('c.png');

const BODY_WITH_MARKERS = [
  '보톡스 상담을 앞두고 무엇을 먼저 확인해야 할까요.',
  '',
  '상담 전 확인할 것',
  '',
  '[이미지 1: 의료진이 근육 구조도를 가리키며 설명하는 미디엄샷]',
  '',
  '근육 상태를 먼저 확인하는 과정이 필요합니다.',
  '',
  '[이미지 2: 상담 테이블 위 차트와 펜 클로즈업]',
  '',
  '기록을 남겨두면 다음 상담이 수월합니다.',
].join('\n');

const BODY_NO_MARKERS = [
  '첫 번째 단락입니다. 도입부에 해당합니다.',
  '',
  '두 번째 단락입니다. 본론이 시작됩니다.',
  '',
  '세 번째 단락입니다. 설명이 이어집니다.',
  '',
  '네 번째 단락입니다. 마무리에 가깝습니다.',
].join('\n');

// ---------------------------------------------------------------------------
// URL 화이트리스트
// ---------------------------------------------------------------------------

describe('sanitizeClinicImageUrls', () => {
  it('clinic-assets public 경로만 통과시킨다', () => {
    const out = sanitizeClinicImageUrls(
      [
        IMG1,
        'https://evil.example.com/x.png',
        'data:image/png;base64,AAAA',
        `${SUPABASE}/storage/v1/object/public/other-bucket/x.png`,
        'http://proj.supabase.co/storage/v1/object/public/clinic-assets/x.png',
        IMG2,
      ],
      SUPABASE,
    );
    assert.deepEqual(out, [IMG1, IMG2]);
  });

  it('중복을 제거하고 순서를 보존한다', () => {
    assert.deepEqual(sanitizeClinicImageUrls([IMG2, IMG1, IMG2], SUPABASE), [IMG2, IMG1]);
  });

  it('배열이 아니거나 supabaseUrl 이 없으면 빈 배열', () => {
    assert.deepEqual(sanitizeClinicImageUrls(null, SUPABASE), []);
    assert.deepEqual(sanitizeClinicImageUrls('nope', SUPABASE), []);
    assert.deepEqual(sanitizeClinicImageUrls([IMG1], null), []);
    assert.deepEqual(sanitizeClinicImageUrls([IMG1], ''), []);
  });

  it('버킷 루트(파일명 없음)는 거부한다', () => {
    assert.deepEqual(
      sanitizeClinicImageUrls([`${SUPABASE}/storage/v1/object/public/clinic-assets/`], SUPABASE),
      [],
    );
  });

  it('개수 상한을 넘지 않는다', () => {
    const many = Array.from({ length: MAX_BODY_IMAGES + 5 }, (_, i) => asset(`m${i}.png`));
    assert.equal(sanitizeClinicImageUrls(many, SUPABASE).length, MAX_BODY_IMAGES);
  });

  it('theme.ts isAllowedClinicAssetUrl 과 판정이 동치다', () => {
    const candidates: readonly string[] = [
      IMG1,
      `${SUPABASE}/storage/v1/object/public/clinic-assets/`,
      `${SUPABASE}/storage/v1/object/public/clinic-assetsX/a.png`,
      `${SUPABASE}/storage/v1/object/sign/clinic-assets/a.png`,
      'https://other.supabase.co/storage/v1/object/public/clinic-assets/a.png',
      'http://proj.supabase.co/storage/v1/object/public/clinic-assets/a.png',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      '',
    ];
    for (const url of candidates) {
      const allowed = isAllowedClinicAssetUrl(url, SUPABASE);
      const rendered = sanitizeClinicImageUrls([url], SUPABASE).length > 0;
      assert.equal(rendered, allowed, `동치 위반: ${url}`);
    }
    // supabaseUrl 이 비었을 때도 동일하게 전부 거부
    for (const base of [null, '', 'ftp://x']) {
      assert.equal(isAllowedClinicAssetUrl(IMG1, base), false);
      assert.equal(sanitizeClinicImageUrls([IMG1], base).length, 0);
    }
  });
});

// ---------------------------------------------------------------------------
// alt
// ---------------------------------------------------------------------------

describe('buildImageAlt', () => {
  it('마커 설명이 있으면 그대로 쓴다', () => {
    assert.equal(buildImageAlt('  의료진이  차트를 보는 장면 ', '제목', 0, 3), '의료진이 차트를 보는 장면');
  });

  it('설명이 없으면 제목 기반이되 여러 장일 때만 번호를 붙인다', () => {
    assert.equal(buildImageAlt(null, '보톡스 상담 체크리스트', 0, 1), '보톡스 상담 체크리스트 설명 이미지');
    assert.equal(buildImageAlt('', '보톡스 상담 체크리스트', 1, 3), '보톡스 상담 체크리스트 설명 이미지 2');
  });

  it('제목도 없으면 최소 대체 텍스트로 폴백한다', () => {
    assert.equal(buildImageAlt(null, '   ', 0, 1), '본문 이미지');
    assert.equal(buildImageAlt(null, '', 2, 4), '본문 이미지 3');
  });

  it('길이 상한을 넘지 않는다', () => {
    const long = '가'.repeat(500);
    assert.ok(buildImageAlt(long, '제목', 0, 1).length <= MAX_ALT_LENGTH);
    assert.ok(buildImageAlt(null, long, 0, 2).length <= MAX_ALT_LENGTH);
  });
});

describe('extractImageDescriptions', () => {
  it('번호별 설명을 뽑는다', () => {
    const map = extractImageDescriptions(BODY_WITH_MARKERS);
    assert.equal(map.get(1), '의료진이 근육 구조도를 가리키며 설명하는 미디엄샷');
    assert.equal(map.get(2), '상담 테이블 위 차트와 펜 클로즈업');
    assert.equal(map.get(3), undefined);
  });

  it('같은 번호가 중복되면 첫 설명을 유지한다', () => {
    const map = extractImageDescriptions('[이미지 1: 앞]\n\n[이미지 1: 뒤]');
    assert.equal(map.get(1), '앞');
  });
});

// ---------------------------------------------------------------------------
// 배치 렌더
// ---------------------------------------------------------------------------

describe('renderBodyHtml + 이미지', () => {
  it('마커 위치에 figure/img 를 넣고 N ↔ images[N-1] 로 매핑한다', () => {
    const images = buildClinicPostImages(BODY_WITH_MARKERS, [IMG1, IMG2], SUPABASE, '보톡스 상담');
    const html = renderBodyHtml(stripSummaryAndFaqBlocks(BODY_WITH_MARKERS), images);

    assert.ok(html.includes(`<img src="${IMG1}"`));
    assert.ok(html.includes(`<img src="${IMG2}"`));
    assert.ok(html.includes('loading="lazy"'));
    assert.ok(html.includes('decoding="async"'));
    // 마커 텍스트가 화면에 새지 않는다
    assert.ok(!html.includes('[이미지'));
    // 순서: 소제목 → 이미지1 → 단락 → 이미지2
    assert.ok(html.indexOf(IMG1) < html.indexOf(IMG2));
    assert.ok(html.indexOf('<h2>상담 전 확인할 것</h2>') < html.indexOf(IMG1));
    assert.ok(html.indexOf(IMG1) < html.indexOf('근육 상태를'));
  });

  it('alt 에 마커 설명이 들어간다', () => {
    const images = buildClinicPostImages(BODY_WITH_MARKERS, [IMG1, IMG2], SUPABASE, '보톡스 상담');
    const html = renderBodyHtml(stripSummaryAndFaqBlocks(BODY_WITH_MARKERS), images);
    assert.ok(html.includes('alt="의료진이 근육 구조도를 가리키며 설명하는 미디엄샷"'));
  });

  it('이미지가 없는 글은 기존 렌더(마커 제거본)와 완전히 동일하다', () => {
    const before = renderBodyHtml(stripStructureBlocks(BODY_WITH_MARKERS));
    const after = renderBodyHtml(stripSummaryAndFaqBlocks(BODY_WITH_MARKERS), []);
    assert.equal(after, before);
    assert.ok(!after.includes('<img'));
    assert.ok(!after.includes('[이미지'));
  });

  it('허용되지 않은 URL 만 있으면 이미지가 하나도 렌더되지 않는다', () => {
    const images = buildClinicPostImages(
      BODY_WITH_MARKERS,
      ['https://fal.media/files/x.png', 'data:image/png;base64,AAAA'],
      SUPABASE,
      '보톡스 상담',
    );
    assert.deepEqual(images, []);
    const html = renderBodyHtml(stripSummaryAndFaqBlocks(BODY_WITH_MARKERS), images);
    assert.ok(!html.includes('<img'));
    assert.equal(html, renderBodyHtml(stripStructureBlocks(BODY_WITH_MARKERS)));
  });

  it('마커가 하나도 없으면 블록 사이에 균등 배치한다', () => {
    const images = buildClinicPostImages(BODY_NO_MARKERS, [IMG1, IMG2], SUPABASE, '제목입니다');
    const html = renderBodyHtml(BODY_NO_MARKERS, images);
    const parts = html.split('\n');

    assert.equal(parts.filter((p) => p.startsWith('<figure')).length, 2);
    // 첫 단락 앞에는 절대 오지 않는다 (도입부 보호)
    assert.ok(parts[0].startsWith('<p>'));
    // 마지막 단락 뒤에 몰리지 않고 본문 중간에 흩어진다
    const figureIdx = parts.map((p, i) => (p.startsWith('<figure') ? i : -1)).filter((i) => i >= 0);
    assert.ok(figureIdx[0] < figureIdx[1]);
    assert.ok(figureIdx[1] < parts.length - 1);
  });

  it('마커보다 이미지가 많으면 남은 이미지를 본문 끝에 붙인다', () => {
    const images = buildClinicPostImages(BODY_WITH_MARKERS, [IMG1, IMG2, IMG3], SUPABASE, '제목');
    const html = renderBodyHtml(stripSummaryAndFaqBlocks(BODY_WITH_MARKERS), images);
    const parts = html.split('\n');
    assert.equal(parts.filter((p) => p.startsWith('<figure')).length, 3);
    assert.ok(parts[parts.length - 1].includes(IMG3));
  });

  it('마커보다 이미지가 적으면 짝 없는 마커는 아무것도 렌더하지 않는다', () => {
    const images = buildClinicPostImages(BODY_WITH_MARKERS, [IMG1], SUPABASE, '제목');
    const html = renderBodyHtml(stripSummaryAndFaqBlocks(BODY_WITH_MARKERS), images);
    assert.equal(html.split('<figure').length - 1, 1);
    assert.ok(!html.includes('[이미지'));
  });

  it('본문 문장 중간에 남은 마커 조각도 텍스트로 새지 않는다', () => {
    const body = '앞 문장입니다 [이미지 9: 남은 조각] 뒤 문장입니다.';
    const html = renderBodyHtml(body, []);
    assert.ok(!html.includes('[이미지'));
    assert.ok(html.includes('앞 문장입니다 뒤 문장입니다.'));
  });

  it('URL·alt 는 HTML 이스케이프된다', () => {
    const html = renderBodyHtml('본문 단락입니다.', [
      { url: `${IMG1}?a=1&b=2`, alt: '따옴표 " 와 <태그>' },
    ]);
    assert.ok(html.includes('&amp;b=2'));
    assert.ok(html.includes('&quot;'));
    assert.ok(!html.includes('<태그>'));
  });
});

describe('pickLeadImageUrl', () => {
  it('첫 렌더 이미지를 대표 이미지로 준다', () => {
    const images = buildClinicPostImages(BODY_WITH_MARKERS, [IMG1, IMG2], SUPABASE, '제목');
    assert.equal(pickLeadImageUrl(images), IMG1);
  });

  it('이미지가 없으면 null (OG 이미지 미설정)', () => {
    assert.equal(pickLeadImageUrl([]), null);
  });

  it('허용되지 않은 URL 이 앞에 있어도 대표 이미지는 허용된 첫 장이다', () => {
    const images = buildClinicPostImages(
      BODY_WITH_MARKERS,
      ['https://evil.example.com/x.png', IMG2],
      SUPABASE,
      '제목',
    );
    assert.equal(pickLeadImageUrl(images), IMG2);
  });
});

describe('Article JSON-LD image', () => {
  const profile = {
    hospitalName: '광고진정성의원',
    specialty: '피부과',
    region: '수성구',
  };

  it('이미지가 있으면 Article.image 로 나간다', () => {
    const images = buildClinicPostImages(BODY_WITH_MARKERS, [IMG1, IMG2], SUPABASE, '제목');
    const schema = buildArticleSchema(
      {
        title: '제목',
        content: BODY_WITH_MARKERS,
        publishedAt: '2026-07-25T00:00:00.000Z',
        imageUrls: images.map((i) => i.url),
      },
      profile,
    );
    assert.deepEqual(schema.image, [IMG1, IMG2]);
  });

  it('이미지가 없으면 image 필드 자체를 생략한다 (회귀 금지)', () => {
    const schema = buildArticleSchema(
      { title: '제목', content: BODY_WITH_MARKERS, publishedAt: null },
      profile,
    );
    assert.ok(!('image' in schema));
  });
});
