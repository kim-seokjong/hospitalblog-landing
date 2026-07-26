import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditSite,
  extractJsonLdTypes,
  extractTitle,
  hasMetaDescription,
  hasOpenGraph,
  hasViewport,
  isSafePublicHost,
  normalizeSiteUrl,
  parseRobotsAiBlocking,
} from '../site-audit.ts';

const FULL_HTML = `<!doctype html><html><head>
<title>브이비성형외과의원 | 대구 코성형</title>
<meta name="description" content="대구 중구 코성형 전문 브이비성형외과의원 진료 안내입니다.">
<meta property="og:title" content="브이비성형외과의원">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"MedicalClinic","name":"브이비성형외과의원"}</script>
</head><body>본문</body></html>`;

const BARE_HTML = '<!doctype html><html><head><title>병원</title></head><body>x</body></html>';

function jsonRes(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' }, ...init });
}

/* ── SSRF 가드 ──────────────────────────────────────────── */

test('isSafePublicHost 는 사설·루프백·링크로컬·내부 TLD 를 거부한다', () => {
  for (const bad of [
    'localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254',
    '100.64.0.1', 'server.internal', 'box.local', 'nodots', '', '0.0.0.0',
  ]) {
    assert.equal(isSafePublicHost(bad), false, `${bad} 는 거부돼야 한다`);
  }
});

test('isSafePublicHost 는 공인 IP 리터럴도 거부한다 (도메인만 허용)', () => {
  assert.equal(isSafePublicHost('8.8.8.8'), false);
});

test('isSafePublicHost 는 정상 도메인을 허용한다', () => {
  for (const ok of ['vb.vbeauty.co.kr', 'www.florps.com', 'hospitalblog.kr']) {
    assert.equal(isSafePublicHost(ok), true);
  }
});

test('normalizeSiteUrl 은 스킴이 없거나 http 여도 https 를 먼저 시험하도록 만든다', () => {
  assert.equal(normalizeSiteUrl('www.florps.com')?.httpsUrl, 'https://www.florps.com');
  assert.equal(normalizeSiteUrl('http://www.florps.com')?.httpsUrl, 'https://www.florps.com');
  assert.equal(normalizeSiteUrl('https://vb.vbeauty.co.kr/')?.origin, 'https://vb.vbeauty.co.kr');
});

test('normalizeSiteUrl 은 위험한 입력을 null 로 막는다', () => {
  for (const bad of ['javascript:alert(1)', 'http://127.0.0.1/admin', 'file:///etc/passwd', 'http://localhost:3000', '', 'https://example.com:8080']) {
    assert.equal(normalizeSiteUrl(bad), null, `${bad} 는 막아야 한다`);
  }
});

/* ── HTML 판정 ──────────────────────────────────────────── */

test('HTML 항목 판정 — 있는 경우', () => {
  assert.equal(extractTitle(FULL_HTML), '브이비성형외과의원 | 대구 코성형');
  assert.equal(hasMetaDescription(FULL_HTML), true);
  assert.equal(hasOpenGraph(FULL_HTML), true);
  assert.equal(hasViewport(FULL_HTML), true);
  assert.deepEqual(extractJsonLdTypes(FULL_HTML), ['MedicalClinic']);
});

test('HTML 항목 판정 — 없는 경우', () => {
  assert.equal(hasMetaDescription(BARE_HTML), false);
  assert.equal(hasOpenGraph(BARE_HTML), false);
  assert.equal(hasViewport(BARE_HTML), false);
  assert.deepEqual(extractJsonLdTypes(BARE_HTML), []);
  assert.equal(extractTitle('<html></html>'), null);
});

test('내용이 빈 meta description 은 "있음"으로 치지 않는다', () => {
  assert.equal(hasMetaDescription('<meta name="description" content="">'), false);
  assert.equal(hasMetaDescription('<meta name="description" content="짧음">'), false);
});

test('viewport 가 device-width 를 안 쓰면 모바일 대응으로 보지 않는다', () => {
  assert.equal(hasViewport('<meta name="viewport" content="width=1024">'), false);
});

test('깨진 JSON-LD 는 조용히 건너뛴다 (없음으로 처리, throw 금지)', () => {
  const html = '<script type="application/ld+json">{ broken json </script>';
  assert.deepEqual(extractJsonLdTypes(html), []);
});

test('@graph 중첩 JSON-LD 도 타입을 뽑는다', () => {
  const html = `<script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":["Dentist","LocalBusiness"]}]}
  </script>`;
  const types = extractJsonLdTypes(html);
  assert.ok(types.includes('WebSite') && types.includes('Dentist') && types.includes('LocalBusiness'));
});

/* ── robots.txt ─────────────────────────────────────────── */

test('robots.txt 에서 개별 AI 크롤러 차단을 읽는다', () => {
  const robots = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n';
  const parsed = parseRobotsAiBlocking(robots);
  assert.deepEqual(parsed.blocked, ['GPTBot']);
  assert.equal(parsed.blocksAll, false);
});

test('robots.txt 가 전체 차단이면 모든 AI 크롤러 차단으로 본다', () => {
  const parsed = parseRobotsAiBlocking('User-agent: *\nDisallow: /\n');
  assert.equal(parsed.blocksAll, true);
  assert.ok(parsed.blocked.includes('ClaudeBot'));
});

test('robots.txt 가 특정 경로만 막으면 AI 차단으로 보지 않는다', () => {
  const parsed = parseRobotsAiBlocking('User-agent: *\nDisallow: /admin/\nDisallow: /tmp/\n');
  assert.deepEqual(parsed.blocked, []);
});

test('한 그룹에 여러 User-agent 가 묶여 있어도 전부 잡는다', () => {
  const parsed = parseRobotsAiBlocking('User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n');
  assert.ok(parsed.blocked.includes('GPTBot') && parsed.blocked.includes('ClaudeBot'));
});

test('주석·빈 줄이 섞여도 파싱된다', () => {
  const parsed = parseRobotsAiBlocking('# 주석\n\nUser-agent: PerplexityBot   # 인라인 주석\nDisallow: /\n');
  assert.deepEqual(parsed.blocked, ['PerplexityBot']);
});

/* ── auditSite (주입 fetch) ─────────────────────────────── */

test('auditSite: 정상 사이트 — 항목이 pass 로 채워지고 최대 3콜만 나간다', async () => {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /\n', { status: 200 });
    if (url.endsWith('/sitemap.xml')) return new Response('<urlset></urlset>', { status: 200 });
    return jsonRes(FULL_HTML);
  }) as unknown as typeof fetch;

  const axis = await auditSite('vb.vbeauty.co.kr', { fetchImpl, source: 'naver' });
  assert.equal(axis.checked, true);
  assert.equal(axis.https, 'pass');
  assert.equal(axis.metaDescription, 'pass');
  assert.equal(axis.viewport, 'pass');
  assert.equal(axis.jsonLd, 'pass');
  assert.equal(axis.robotsTxt, 'pass');
  assert.equal(axis.sitemapXml, 'pass');
  assert.equal(axis.aiCrawler, 'allowed');
  assert.equal(urls.length, 3, `홈+robots+sitemap 3콜이어야 하는데 ${urls.length}콜`);
});

test('auditSite: TLS 실패는 https=fail 로 잡고 원인 문구를 남긴다', async () => {
  const fetchImpl = (async (url: string) => {
    if (url.startsWith('https://')) throw new Error('certificate has expired');
    return jsonRes(FULL_HTML);
  }) as unknown as typeof fetch;

  const axis = await auditSite('brokentls.example.co.kr', { fetchImpl, source: 'manual' });
  assert.equal(axis.https, 'fail');
  assert.match(axis.httpsNote ?? '', /인증서/);
  assert.match(axis.httpsNote ?? '', /http:\/\/ 로는 정상 응답/);
  // http 로 받아온 본문으로 나머지 항목은 계속 판정한다
  assert.equal(axis.viewport, 'pass');
});

test('auditSite: https·http 둘 다 실패하면 항목을 fail 이 아니라 unknown 으로 남긴다', async () => {
  const fetchImpl = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
  const axis = await auditSite('gone.example.co.kr', { fetchImpl, source: 'manual' });
  assert.equal(axis.https, 'unknown');
  assert.equal(axis.metaDescription, 'unknown');
  assert.equal(axis.jsonLd, 'unknown');
  assert.equal(axis.robotsTxt, 'unknown');
  assert.equal(axis.aiCrawler, 'unknown');
});

test('auditSite: 홈이 안 뜨면 robots·sitemap 을 추가 요청하지 않는다 (부하 금지)', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
  await auditSite('gone.example.co.kr', { fetchImpl, source: 'manual' });
  assert.equal(calls, 2, 'https 1콜 + http 폴백 1콜만');
});

test('auditSite: 위험한 주소는 요청조차 하지 않는다', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return jsonRes(FULL_HTML); }) as unknown as typeof fetch;
  const axis = await auditSite('http://169.254.169.254/latest/meta-data', { fetchImpl, source: 'manual' });
  assert.equal(calls, 0);
  assert.equal(axis.checked, false);
});

test('auditSite: 리다이렉트 종착지가 사설 대역이면 결과를 버린다', async () => {
  const fetchImpl = (async () => {
    const res = jsonRes(FULL_HTML);
    Object.defineProperty(res, 'url', { value: 'http://192.168.0.1/', configurable: true });
    return res;
  }) as unknown as typeof fetch;
  const axis = await auditSite('redirector.example.co.kr', { fetchImpl, source: 'manual' });
  assert.equal(axis.https, 'unknown');
});

test('auditSite: robots.txt 가 없으면 AI 크롤러는 허용으로 본다 (기본값)', async () => {
  const fetchImpl = (async (url: string) => {
    if (url.endsWith('/robots.txt')) return new Response('Not Found', { status: 404 });
    if (url.endsWith('/sitemap.xml')) return new Response('Not Found', { status: 404 });
    return jsonRes(FULL_HTML);
  }) as unknown as typeof fetch;
  const axis = await auditSite('nosetup.example.co.kr', { fetchImpl, source: 'naver' });
  assert.equal(axis.robotsTxt, 'fail');
  assert.equal(axis.sitemapXml, 'fail');
  assert.equal(axis.aiCrawler, 'allowed');
});

test('auditSite: 타임아웃도 throw 없이 흡수된다', async () => {
  const fetchImpl = ((_url: string, init?: RequestInit) =>
    new Promise((_r, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))); })) as unknown as typeof fetch;
  const axis = await auditSite('slow.example.co.kr', { fetchImpl, timeoutMs: 20, source: 'manual' });
  assert.equal(axis.https, 'unknown');
  assert.match(axis.httpsNote ?? '', /제한 시간/);
});
