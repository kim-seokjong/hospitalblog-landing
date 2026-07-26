import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SLUG_RE,
  RESERVED_SLUGS,
  validateSlug,
  clinicSiteUrl,
  clinicSiteHost,
  extractClinicSlugFromHost,
  buildClinicSitePath,
  resolveClinicSiteRewrite,
  isClinicSitePathname,
  CLINIC_SITE_PATH_PREFIX,
  CLINIC_SITE_REQUEST_HEADER,
} from '../slug.ts';

// ---------------------------------------------------------------------------
// validateSlug — 형식
// ---------------------------------------------------------------------------

test('validateSlug: 정상 슬러그는 통과하고 정규화된 값을 돌려준다', () => {
  const cases = ['abc', 'my-clinic', 'clinic123', 'a1b', 'seoul-skin-1'];
  for (const raw of cases) {
    const result = validateSlug(raw);
    assert.equal(result.ok, true, raw);
    if (result.ok) assert.equal(result.slug, raw);
  }
});

test('validateSlug: 대문자·공백 입력은 소문자로 정규화되어 통과한다', () => {
  const result = validateSlug('  MyClinic  ');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.slug, 'myclinic');
});

test('validateSlug: 빈 값은 차단된다', () => {
  const result = validateSlug('   ');
  assert.equal(result.ok, false);
});

test('validateSlug: 3자 미만·30자 초과는 차단된다', () => {
  assert.equal(validateSlug('ab').ok, false);
  assert.equal(validateSlug('a'.repeat(31)).ok, false);
  assert.equal(validateSlug('a'.repeat(30)).ok, true);
  assert.equal(validateSlug('abc').ok, true);
});

test('validateSlug: 하이픈으로 시작·끝나면 차단된다', () => {
  assert.equal(validateSlug('-abc').ok, false);
  assert.equal(validateSlug('abc-').ok, false);
  assert.equal(validateSlug('a-c').ok, true);
});

test('validateSlug: 허용 외 문자(한글·언더스코어·점)는 차단된다', () => {
  for (const raw of ['한글주소', 'my_clinic', 'my.clinic', 'my clinic', 'clinic!']) {
    assert.equal(validateSlug(raw).ok, false, raw);
  }
});

test('validateSlug: 예약어는 차단된다', () => {
  for (const reserved of ['www', 'app', 'api', 'admin', 'mail', 'blog', 'test', 'status']) {
    assert.equal(RESERVED_SLUGS.has(reserved), true, reserved);
    const result = validateSlug(reserved);
    assert.equal(result.ok, false, reserved);
    if (!result.ok) assert.match(result.reason, /예약/);
  }
});

test('SLUG_RE: 정규식 단독으로도 3~30자 규칙을 강제한다', () => {
  assert.equal(SLUG_RE.test('ab'), false);
  assert.equal(SLUG_RE.test('abc'), true);
  assert.equal(SLUG_RE.test('a'.repeat(30)), true);
  assert.equal(SLUG_RE.test('a'.repeat(31)), false);
});

// ---------------------------------------------------------------------------
// clinicSiteUrl
// ---------------------------------------------------------------------------

test('clinicSiteUrl: 루트·경로 URL 을 올바르게 조립한다', () => {
  assert.equal(clinicSiteUrl('myclinic'), 'https://myclinic.hospitalblog.kr');
  assert.equal(clinicSiteUrl('myclinic', '/'), 'https://myclinic.hospitalblog.kr');
  assert.equal(
    clinicSiteUrl('myclinic', '/posts/abc-123'),
    'https://myclinic.hospitalblog.kr/posts/abc-123',
  );
  assert.equal(
    clinicSiteUrl('myclinic', 'sitemap.xml'),
    'https://myclinic.hospitalblog.kr/sitemap.xml',
  );
});

// ---------------------------------------------------------------------------
// extractClinicSlugFromHost — 미들웨어 호스트 파싱
// ---------------------------------------------------------------------------

test('extractClinicSlugFromHost: 운영 서브도메인에서 슬러그를 추출한다', () => {
  assert.equal(extractClinicSlugFromHost('myclinic.hospitalblog.kr'), 'myclinic');
  assert.equal(extractClinicSlugFromHost('MyClinic.HospitalBlog.KR'), 'myclinic');
  assert.equal(extractClinicSlugFromHost('my-clinic.hospitalblog.kr:443'), 'my-clinic');
});

test('extractClinicSlugFromHost: 로컬 테스트 호스트({slug}.localhost)를 지원한다', () => {
  assert.equal(extractClinicSlugFromHost('testclinic.localhost'), 'testclinic');
  assert.equal(extractClinicSlugFromHost('testclinic.localhost:3000'), 'testclinic');
});

test('extractClinicSlugFromHost: www·예약어 서브도메인은 null (메인 동작 유지)', () => {
  assert.equal(extractClinicSlugFromHost('www.hospitalblog.kr'), null);
  assert.equal(extractClinicSlugFromHost('api.hospitalblog.kr'), null);
  assert.equal(extractClinicSlugFromHost('admin.hospitalblog.kr'), null);
});

test('extractClinicSlugFromHost: 메인 도메인·기타 호스트는 null', () => {
  assert.equal(extractClinicSlugFromHost('hospitalblog.kr'), null);
  assert.equal(extractClinicSlugFromHost('localhost:3000'), null);
  assert.equal(extractClinicSlugFromHost('my-app.vercel.app'), null);
  assert.equal(extractClinicSlugFromHost('example.com'), null);
  assert.equal(extractClinicSlugFromHost(null), null);
  assert.equal(extractClinicSlugFromHost(''), null);
});

test('extractClinicSlugFromHost: 중첩 서브도메인·형식 불일치는 null', () => {
  assert.equal(extractClinicSlugFromHost('a.b.hospitalblog.kr'), null);
  assert.equal(extractClinicSlugFromHost('ab.hospitalblog.kr'), null); // 2자
  assert.equal(extractClinicSlugFromHost('-bad.hospitalblog.kr'), null);
});

// ---------------------------------------------------------------------------
// buildClinicSitePath / resolveClinicSiteRewrite — rewrite 경로 판정
// ---------------------------------------------------------------------------

test('buildClinicSitePath: 루트·글 경로를 /clinic-site/{slug} 로 변환한다', () => {
  assert.equal(buildClinicSitePath('myclinic', '/'), '/clinic-site/myclinic');
  assert.equal(
    buildClinicSitePath('myclinic', '/posts/1f2e3d4c'),
    '/clinic-site/myclinic/posts/1f2e3d4c',
  );
});

test('buildClinicSitePath: sitemap.xml·robots.txt 는 색인 라우트로 rewrite 한다', () => {
  assert.equal(buildClinicSitePath('myclinic', '/sitemap.xml'), '/clinic-site/myclinic/sitemap.xml');
  assert.equal(buildClinicSitePath('myclinic', '/robots.txt'), '/clinic-site/myclinic/robots.txt');
});

test('buildClinicSitePath: _next·api·정적 파일·자기 자신은 rewrite 제외', () => {
  assert.equal(buildClinicSitePath('myclinic', '/_next/static/chunk.js'), null);
  assert.equal(buildClinicSitePath('myclinic', '/api/profile'), null);
  assert.equal(buildClinicSitePath('myclinic', '/favicon.ico'), null);
  assert.equal(buildClinicSitePath('myclinic', '/images/logo.png'), null);
  assert.equal(buildClinicSitePath('myclinic', '/clinic-site/other'), null);
});

test('resolveClinicSiteRewrite: 호스트+경로 통합 판정', () => {
  assert.equal(
    resolveClinicSiteRewrite('myclinic.hospitalblog.kr', '/'),
    '/clinic-site/myclinic',
  );
  assert.equal(
    resolveClinicSiteRewrite('test-clinic.localhost:3000', '/sitemap.xml'),
    '/clinic-site/test-clinic/sitemap.xml',
  );
  // 메인 도메인 — DNS 미설정/기존 트래픽에 부작용 없음
  assert.equal(resolveClinicSiteRewrite('www.hospitalblog.kr', '/'), null);
  assert.equal(resolveClinicSiteRewrite('hospitalblog.kr', '/pricing'), null);
  // 서브도메인이라도 내부 경로는 그대로
  assert.equal(resolveClinicSiteRewrite('myclinic.hospitalblog.kr', '/_next/data/x.json'), null);
});

// ---------------------------------------------------------------------------
// IndexNow 키 파일 라우팅 (서브도메인은 각각 별개 호스트 → 자기 루트에 키 파일 필요)
// ---------------------------------------------------------------------------

test('buildClinicSitePath: /{key}.txt 는 IndexNow 키 파일 라우트로 rewrite 한다', () => {
  assert.equal(
    buildClinicSitePath('myclinic', '/fa8c0a469da44e9b8f6a769f291829f5.txt'),
    '/clinic-site/myclinic/indexnow/fa8c0a469da44e9b8f6a769f291829f5',
  );
  // 하이픈·대문자 포함 키도 스펙상 유효
  assert.equal(
    buildClinicSitePath('myclinic', '/I-love-IndexNow-3000.txt'),
    '/clinic-site/myclinic/indexnow/I-love-IndexNow-3000',
  );
});

test('buildClinicSitePath: robots.txt 는 기존대로 robots 라우트로 간다 (키 파일과 충돌 없음)', () => {
  assert.equal(buildClinicSitePath('myclinic', '/robots.txt'), '/clinic-site/myclinic/robots.txt');
});

test('buildClinicSitePath: 키 형식이 아닌 .txt 는 rewrite 하지 않는다', () => {
  assert.equal(buildClinicSitePath('myclinic', '/short.txt'), null);       // 8자 미만
  assert.equal(buildClinicSitePath('myclinic', '/has_underscore.txt'), null);
  assert.equal(buildClinicSitePath('myclinic', '/sub/dir/keyfile12345.txt'), null); // 루트만 허용
});

test('resolveClinicSiteRewrite: 서브도메인의 키 파일 요청도 통합 판정된다', () => {
  assert.equal(
    resolveClinicSiteRewrite('myclinic.hospitalblog.kr', '/fa8c0a469da44e9b8f6a769f291829f5.txt'),
    '/clinic-site/myclinic/indexnow/fa8c0a469da44e9b8f6a769f291829f5',
  );
});

// ---------------------------------------------------------------------------
// 병원 블로그 경로 판정 (루트 레이아웃 JSON-LD 분기)
// ---------------------------------------------------------------------------

test('clinicSiteHost: 스킴 없는 호스트명 (IndexNow host 필드용)', () => {
  assert.equal(clinicSiteHost('myclinic'), 'myclinic.hospitalblog.kr');
  assert.equal(clinicSiteUrl('myclinic'), 'https://myclinic.hospitalblog.kr');
});

test('isClinicSitePathname: /clinic-site 경로만 true (SaaS JSON-LD 제외 대상)', () => {
  assert.equal(isClinicSitePathname('/clinic-site'), true);
  assert.equal(isClinicSitePathname('/clinic-site/myclinic'), true);
  assert.equal(isClinicSitePathname('/clinic-site/myclinic/posts/abc'), true);
  assert.equal(isClinicSitePathname('/clinic-site/myclinic/sitemap.xml'), true);

  // 메인 사이트 경로는 기존 동작 유지 (JSON-LD 그대로 출력)
  assert.equal(isClinicSitePathname('/'), false);
  assert.equal(isClinicSitePathname('/pricing'), false);
  assert.equal(isClinicSitePathname('/app'), false);
  // 접두사만 같은 다른 경로에 오탐하지 않는다
  assert.equal(isClinicSitePathname('/clinic-sites'), false);
  assert.equal(isClinicSitePathname('/clinic-site-demo'), false);
});

test('JSON-LD 분기용 상수가 고정되어 있다 (미들웨어 ↔ 루트 레이아웃 계약)', () => {
  assert.equal(CLINIC_SITE_PATH_PREFIX, '/clinic-site');
  assert.equal(CLINIC_SITE_REQUEST_HEADER, 'x-clinic-site');
});
