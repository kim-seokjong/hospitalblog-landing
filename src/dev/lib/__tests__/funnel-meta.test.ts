import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFunnelPath,
  normalizeReferrerHost,
  normalizeUtmSource,
  buildPublicFunnelMeta,
} from '../funnel-meta.ts';

// ── normalizeFunnelPath ──
test('path: 정상 경로는 그대로 통과', () => {
  assert.equal(normalizeFunnelPath('/'), '/');
  assert.equal(normalizeFunnelPath('/pricing'), '/pricing');
  assert.equal(normalizeFunnelPath('/app/blog-check'), '/app/blog-check');
  assert.equal(normalizeFunnelPath('/post/some-slug_1.2'), '/post/some-slug_1.2');
});

test('path: 쿼리스트링·해시 제거 (PII 가능 영역 미전송)', () => {
  assert.equal(normalizeFunnelPath('/?utm_source=naver'), '/');
  assert.equal(normalizeFunnelPath('/pricing?email=a@b.com&phone=0101234'), '/pricing');
  assert.equal(normalizeFunnelPath('/page#section'), '/page');
  assert.equal(normalizeFunnelPath('/page?q=1#frag'), '/page');
});

test('path: 형식 위반·비문자열은 undefined (생략)', () => {
  assert.equal(normalizeFunnelPath('pricing'), undefined); // 슬래시 미시작
  assert.equal(normalizeFunnelPath('/한글경로'), undefined); // 서버 PATH_RE 불통과
  assert.equal(normalizeFunnelPath(''), undefined);
  assert.equal(normalizeFunnelPath(null), undefined);
  assert.equal(normalizeFunnelPath(undefined), undefined);
});

test('path: 초장문 경로는 200자 절단 후 형식 검사', () => {
  const long = '/' + 'a'.repeat(500);
  const out = normalizeFunnelPath(long);
  assert.equal(out, '/' + 'a'.repeat(199));
});

// ── normalizeReferrerHost ──
test('referrer_host: 외부 리퍼러는 호스트명만 반환 (전체 URL 금지)', () => {
  assert.equal(
    normalizeReferrerHost('https://www.google.com/search?q=병원+블로그', 'hospitalblog.kr'),
    'www.google.com',
  );
  assert.equal(
    normalizeReferrerHost('https://blog.naver.com/somebody/223?param=1', 'hospitalblog.kr'),
    'blog.naver.com',
  );
});

test('referrer_host: 자기 도메인 리퍼러는 생략', () => {
  assert.equal(
    normalizeReferrerHost('https://hospitalblog.kr/pricing', 'hospitalblog.kr'),
    undefined,
  );
  // 대소문자 무관 비교
  assert.equal(
    normalizeReferrerHost('https://HospitalBlog.KR/', 'hospitalblog.kr'),
    undefined,
  );
});

test('referrer_host: 없거나 파싱 불가 값은 생략', () => {
  assert.equal(normalizeReferrerHost('', 'hospitalblog.kr'), undefined);
  assert.equal(normalizeReferrerHost(null, 'hospitalblog.kr'), undefined);
  assert.equal(normalizeReferrerHost(undefined, 'hospitalblog.kr'), undefined);
  assert.equal(normalizeReferrerHost('not a url', 'hospitalblog.kr'), undefined);
  assert.equal(normalizeReferrerHost('/relative/path', 'hospitalblog.kr'), undefined);
});

test('referrer_host: 소문자 정규화·서브도메인은 다른 호스트로 유지', () => {
  assert.equal(
    normalizeReferrerHost('https://WWW.Google.COM/', 'hospitalblog.kr'),
    'www.google.com',
  );
  // 자체 서브도메인 블로그({slug}.hospitalblog.kr) → 루트 랜딩 유입은 출처로 기록
  assert.equal(
    normalizeReferrerHost('https://adsincerity.hospitalblog.kr/post', 'hospitalblog.kr'),
    'adsincerity.hospitalblog.kr',
  );
});

// ── normalizeUtmSource ──
test('utm_source: 소문자 토큰 형식이면 첨부', () => {
  assert.equal(normalizeUtmSource('?utm_source=naver'), 'naver');
  assert.equal(normalizeUtmSource('?utm_source=meta_ads&utm_medium=cpc'), 'meta_ads');
  assert.equal(normalizeUtmSource('utm_source=cold-email'), 'cold-email'); // 선행 ? 없어도 동작
});

test('utm_source: 대문자는 소문자 정규화 후 통과', () => {
  assert.equal(normalizeUtmSource('?utm_source=Facebook'), 'facebook');
  assert.equal(normalizeUtmSource('?utm_source=%20Naver%20'), 'naver'); // 공백 trim
});

test('utm_source: 형식 위반·부재 시 생략', () => {
  assert.equal(normalizeUtmSource('?utm_medium=cpc'), undefined); // utm_source 없음
  assert.equal(normalizeUtmSource('?utm_source='), undefined); // 빈 값
  assert.equal(normalizeUtmSource('?utm_source=한글출처'), undefined); // 토큰 형식 위반
  assert.equal(normalizeUtmSource('?utm_source=has%20space'), undefined);
  assert.equal(normalizeUtmSource('?utm_source=' + 'a'.repeat(33)), undefined); // 32자 초과
  assert.equal(normalizeUtmSource(''), undefined);
  assert.equal(normalizeUtmSource(null), undefined);
  assert.equal(normalizeUtmSource(undefined), undefined);
});

// ── buildPublicFunnelMeta ──
test('landing_view: path·source·referrer_host 조립', () => {
  const meta = buildPublicFunnelMeta('landing_view', {
    pathname: '/',
    search: '?utm_source=naver&utm_medium=cpc',
    referrer: 'https://www.google.com/search?q=x',
    ownHostname: 'hospitalblog.kr',
  });
  assert.deepEqual(meta, { path: '/', source: 'naver', referrer_host: 'www.google.com' });
});

test('landing_view: 자기 도메인 리퍼러·utm 부재면 해당 키 생략', () => {
  const meta = buildPublicFunnelMeta('landing_view', {
    pathname: '/pricing',
    search: '',
    referrer: 'https://hospitalblog.kr/',
    ownHostname: 'hospitalblog.kr',
  });
  assert.deepEqual(meta, { path: '/pricing' });
});

test('signup_start: referrer_host 는 만들지 않는다 (서버 화이트리스트 밖)', () => {
  const meta = buildPublicFunnelMeta('signup_start', {
    pathname: '/',
    search: '?utm_source=cold-email',
    referrer: 'https://www.google.com/',
    ownHostname: 'hospitalblog.kr',
  });
  assert.deepEqual(meta, { path: '/', source: 'cold-email' });
});

test('유효한 값이 하나도 없으면 빈 객체', () => {
  const meta = buildPublicFunnelMeta('landing_view', {
    pathname: null,
    search: null,
    referrer: null,
    ownHostname: null,
  });
  assert.deepEqual(meta, {});
});
