import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClinicTheme,
  CLINIC_DESC_MAX_LENGTH,
  CLINIC_GALLERY_LIMIT,
  EMPTY_CLINIC_THEME,
  filterPublicPhotos,
  isAccentTextReadableOnWhite,
  isAllowedClinicAssetUrl,
  NEUTRAL_ACCENT_COLOR,
  pickHeroUrl,
  relativeLuminance,
  sanitizeBrandColor,
  sanitizeClinicDescription,
  type ClinicThemeSource,
  type PublicClinicPhoto,
} from '../theme.ts';

const SUPABASE_URL = 'https://example.supabase.co';
const ASSET_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/clinic-assets`;

function asset(path: string): string {
  return `${ASSET_PREFIX}/${path}`;
}

function photo(overrides: Partial<PublicClinicPhoto> & { url: string }): PublicClinicPhoto {
  return { category: 'interior', consent: false, ...overrides };
}

function source(overrides: Partial<ClinicThemeSource>): ClinicThemeSource {
  return {
    brandColor: null,
    logoUrl: null,
    doctorPhotoUrl: null,
    doctorConsent: false,
    description: null,
    photos: [],
    supabaseUrl: SUPABASE_URL,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 브랜드 컬러 hex 검증
// ---------------------------------------------------------------------------

test('sanitizeBrandColor: #RRGGBB 통과분만, 소문자 정규화', () => {
  assert.equal(sanitizeBrandColor('#1A2b3C'), '#1a2b3c');
  assert.equal(sanitizeBrandColor('  #ff4628  '), '#ff4628');
});

test('sanitizeBrandColor: CSS 인젝션·형식 불일치 전부 거부', () => {
  const bad = [
    null,
    undefined,
    '',
    '#fff', // 3자리 불허
    '#12345', // 5자리
    '#1234567', // 7자리
    'red',
    'rgb(0,0,0)',
    '#ff4628; background:url(evil)', // 인젝션 시도
    'ff4628',
    '#ff46zz',
  ];
  for (const value of bad) {
    assert.equal(sanitizeBrandColor(value as string | null | undefined), null, String(value));
  }
});

// ---------------------------------------------------------------------------
// 휘도·명도 대비 분기
// ---------------------------------------------------------------------------

test('relativeLuminance: 검정 0 · 흰색 1 · 형식 불일치 null', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  const white = relativeLuminance('#ffffff');
  assert.ok(white !== null && Math.abs(white - 1) < 1e-9);
  assert.equal(relativeLuminance('not-a-hex'), null);
});

test('isAccentTextReadableOnWhite: 어두운 색은 텍스트 허용, 밝은 색은 포인트 전용', () => {
  assert.equal(isAccentTextReadableOnWhite('#000000'), true);
  assert.equal(isAccentTextReadableOnWhite(NEUTRAL_ACCENT_COLOR), true); // 중립 파랑
  assert.equal(isAccentTextReadableOnWhite('#ffff00'), false); // 노랑 — 흰 배경 가독 불가
  assert.equal(isAccentTextReadableOnWhite('#ffffff'), false);
  assert.equal(isAccentTextReadableOnWhite('bad'), false);
});

// ---------------------------------------------------------------------------
// 에셋 URL 허용 도메인
// ---------------------------------------------------------------------------

test('isAllowedClinicAssetUrl: 자체 clinic-assets public 경로만 허용', () => {
  assert.equal(isAllowedClinicAssetUrl(asset('uid/logo/a.png'), SUPABASE_URL), true);
  // 뒤 슬래시 붙은 SUPABASE_URL 도 정규화
  assert.equal(isAllowedClinicAssetUrl(asset('uid/logo/a.png'), `${SUPABASE_URL}/`), true);
});

test('isAllowedClinicAssetUrl: 외부 URL·타 버킷·프리픽스 위장 전부 거부', () => {
  const bad = [
    'https://evil.example.com/a.png',
    `https://example.supabase.co.evil.com/storage/v1/object/public/clinic-assets/a.png`,
    `${SUPABASE_URL}/storage/v1/object/public/other-bucket/a.png`,
    `${SUPABASE_URL}/storage/v1/object/sign/clinic-assets/a.png`, // 서명 경로 아님
    ASSET_PREFIX + '/', // 경로 없는 프리픽스만
    '',
  ];
  for (const url of bad) {
    assert.equal(isAllowedClinicAssetUrl(url, SUPABASE_URL), false, url);
  }
  assert.equal(isAllowedClinicAssetUrl(null, SUPABASE_URL), false);
  assert.equal(isAllowedClinicAssetUrl(asset('a.png'), null), false, 'env 미설정 시 전부 거부');
  assert.equal(
    isAllowedClinicAssetUrl('http://example.supabase.co/storage/v1/object/public/clinic-assets/a.png', 'http://example.supabase.co'),
    false,
    'https 아니면 거부',
  );
});

// ---------------------------------------------------------------------------
// 병원 소개
// ---------------------------------------------------------------------------

test('sanitizeClinicDescription: 공백 정규화·빈값 null·길이 상한', () => {
  assert.equal(sanitizeClinicDescription('  안녕하세요.\n\n환자  중심  진료.  '), '안녕하세요. 환자 중심 진료.');
  assert.equal(sanitizeClinicDescription('   '), null);
  assert.equal(sanitizeClinicDescription(null), null);
  const long = '가'.repeat(CLINIC_DESC_MAX_LENGTH + 50);
  const clamped = sanitizeClinicDescription(long);
  assert.ok(clamped !== null && clamped.length === CLINIC_DESC_MAX_LENGTH + 1); // + '…'
  assert.ok(clamped.endsWith('…'));
});

// ---------------------------------------------------------------------------
// 사진 필터링 — 컴플라이언스 게이트
// ---------------------------------------------------------------------------

test('filterPublicPhotos: staff 는 consent=true 만, 시설 사진은 동의 불요', () => {
  const photos = [
    photo({ category: 'staff', url: asset('p/1.jpg'), consent: false }),
    photo({ category: 'staff', url: asset('p/2.jpg'), consent: true }),
    photo({ category: 'interior', url: asset('p/3.jpg'), consent: false }),
  ];
  const result = filterPublicPhotos(photos, SUPABASE_URL);
  assert.deepEqual(
    result.map((p) => p.url),
    [asset('p/2.jpg'), asset('p/3.jpg')],
  );
});

test('filterPublicPhotos: 화이트리스트 외 카테고리(전후사진류)는 동의 여부와 무관하게 제외', () => {
  const photos = [
    photo({ category: 'before_after', url: asset('p/ba.jpg'), consent: true }),
    photo({ category: 'beforeafter', url: asset('p/ba2.jpg'), consent: true }),
    photo({ category: '', url: asset('p/none.jpg'), consent: true }),
    photo({ category: 'exterior', url: asset('p/ok.jpg') }),
  ];
  const result = filterPublicPhotos(photos, SUPABASE_URL);
  assert.deepEqual(result.map((p) => p.url), [asset('p/ok.jpg')]);
});

test('filterPublicPhotos: 외부 URL·중복 URL 제거', () => {
  const photos = [
    photo({ category: 'interior', url: 'https://evil.example.com/x.jpg' }),
    photo({ category: 'interior', url: asset('p/dup.jpg') }),
    photo({ category: 'exterior', url: asset('p/dup.jpg') }),
  ];
  const result = filterPublicPhotos(photos, SUPABASE_URL);
  assert.equal(result.length, 1);
  assert.equal(result[0].category, 'interior');
});

test('pickHeroUrl: 시설 우선순위(exterior > interior > equipment > etc), staff 는 히어로 금지', () => {
  const interior = photo({ category: 'interior', url: asset('p/in.jpg') });
  const exterior = photo({ category: 'exterior', url: asset('p/ex.jpg') });
  const staff = photo({ category: 'staff', url: asset('p/st.jpg'), consent: true });
  assert.equal(pickHeroUrl([interior, exterior]), asset('p/ex.jpg'));
  assert.equal(pickHeroUrl([interior]), asset('p/in.jpg'));
  assert.equal(pickHeroUrl([staff]), null);
  assert.equal(pickHeroUrl([]), null);
});

// ---------------------------------------------------------------------------
// 테마 조립
// ---------------------------------------------------------------------------

test('buildClinicTheme: 아무것도 등록 안 된 병원 → EMPTY 와 동등 (기본 디자인 유지)', () => {
  const theme = buildClinicTheme(source({}));
  assert.deepEqual(theme, EMPTY_CLINIC_THEME);
});

test('buildClinicTheme: 브랜드 컬러 검증 실패 시 중립 색 폴백 + 액센트 미적용 플래그', () => {
  const theme = buildClinicTheme(source({ brandColor: 'red; injection' }));
  assert.equal(theme.hasBrandColor, false);
  assert.equal(theme.accentColor, NEUTRAL_ACCENT_COLOR);
});

test('buildClinicTheme: 검증 통과 브랜드 컬러 + 밝은 색은 accentTextSafe=false', () => {
  const dark = buildClinicTheme(source({ brandColor: '#1a5276' }));
  assert.equal(dark.hasBrandColor, true);
  assert.equal(dark.accentColor, '#1a5276');
  assert.equal(dark.accentTextSafe, true);

  const light = buildClinicTheme(source({ brandColor: '#F9E79F' }));
  assert.equal(light.hasBrandColor, true);
  assert.equal(light.accentTextSafe, false);
});

test('buildClinicTheme: 로고는 자체 스토리지 URL 만 통과', () => {
  assert.equal(
    buildClinicTheme(source({ logoUrl: asset('uid/logo/l.png') })).logoUrl,
    asset('uid/logo/l.png'),
  );
  assert.equal(
    buildClinicTheme(source({ logoUrl: 'https://evil.example.com/l.png' })).logoUrl,
    null,
  );
});

test('buildClinicTheme: 히어로는 갤러리에서 제외, 갤러리 최대 6장(초과 무시)', () => {
  const photos = [
    photo({ category: 'exterior', url: asset('p/hero.jpg') }),
    ...Array.from({ length: 8 }, (_, i) =>
      photo({ category: 'interior', url: asset(`p/g${i}.jpg`) }),
    ),
  ];
  const theme = buildClinicTheme(source({ photos }));
  assert.equal(theme.heroUrl, asset('p/hero.jpg'));
  assert.equal(theme.galleryUrls.length, CLINIC_GALLERY_LIMIT);
  assert.ok(!theme.galleryUrls.includes(asset('p/hero.jpg')));
});

test('buildClinicTheme: 원장 사진은 clinic_doctor_consent=true 일 때만 갤러리 포함', () => {
  const doctorUrl = asset('uid/doctor/d.jpg');
  const withConsent = buildClinicTheme(
    source({ doctorPhotoUrl: doctorUrl, doctorConsent: true }),
  );
  assert.deepEqual(withConsent.galleryUrls, [doctorUrl]);

  const withoutConsent = buildClinicTheme(
    source({ doctorPhotoUrl: doctorUrl, doctorConsent: false }),
  );
  assert.deepEqual(withoutConsent.galleryUrls, []);

  const externalDoctor = buildClinicTheme(
    source({ doctorPhotoUrl: 'https://evil.example.com/d.jpg', doctorConsent: true }),
  );
  assert.deepEqual(externalDoctor.galleryUrls, []);
});

test('buildClinicTheme: supabaseUrl 미설정이면 에셋 전부 거부하되 컬러·소개는 유지', () => {
  const theme = buildClinicTheme(
    source({
      supabaseUrl: null,
      brandColor: '#1a5276',
      description: '소개',
      logoUrl: asset('uid/logo/l.png'),
      photos: [photo({ category: 'interior', url: asset('p/1.jpg') })],
    }),
  );
  assert.equal(theme.logoUrl, null);
  assert.equal(theme.heroUrl, null);
  assert.deepEqual(theme.galleryUrls, []);
  assert.equal(theme.hasBrandColor, true);
  assert.equal(theme.description, '소개');
});
