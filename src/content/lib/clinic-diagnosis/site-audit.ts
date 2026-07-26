import type { SiteAxis, SiteCheckState } from './types.ts';

/**
 * 2단계 ② — 홈페이지 진단.
 *
 * 규칙(강제):
 *   · 크롤링·스크래핑 금지. **대상 1건당 최대 3회 GET**(홈 1 + robots.txt 1 + sitemap.xml 1).
 *     링크를 타고 들어가지 않는다.
 *   · 모든 요청에 타임아웃. 본문은 상한(BODY_MAX_BYTES)까지만 읽는다.
 *   · SSRF 방어 — 사설/루프백/링크로컬 대역과 비 http(s) 스킴은 요청 자체를 거부한다.
 *   · 판정은 pass/fail/unknown 3값. 확인 못 한 항목을 fail 로 뭉뚱그리지 않는다.
 *
 * HTTPS 를 최우선 항목으로 둔 이유: 우리 회사 홈페이지가 실제로 TLS 핸드셰이크
 * 실패 상태였다. 원장이 브라우저에서 경고를 보는 순간 유입은 그 자리에서 끊긴다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

/** 요청 1건 타임아웃(ms). */
export const SITE_FETCH_TIMEOUT_MS = 8_000;
/** HTML 본문 수신 상한(바이트). 초과분은 버린다. */
export const BODY_MAX_BYTES = 512 * 1024;
/** robots.txt 수신 상한(바이트). */
export const ROBOTS_MAX_BYTES = 64 * 1024;

const USER_AGENT =
  'Mozilla/5.0 (compatible; DoctorPostSiteCheck/1.0; +https://hospitalblog.kr) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * robots.txt 에서 확인하는 AI 크롤러 UA.
 * 차단 여부는 "우리 판단"이 아니라 사실 보고용이다 — 차단이 항상 나쁜 것은 아니고
 * (콘텐츠 보호 목적일 수 있다) AI 검색 노출을 원하면 문제라는 맥락으로만 쓴다.
 */
export const AI_CRAWLER_AGENTS: readonly string[] = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'CCBot',
  'Applebot-Extended',
  'Bytespider',
];

/* ── URL 정규화 · SSRF 가드 ───────────────────────────────── */

/** 사설·루프백·링크로컬 IPv4 대역인가. */
function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, Number(m[2]), Number(m[3]), Number(m[4])].some((n) => n > 255)) return true;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // 링크로컬(클라우드 메타데이터)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * 외부로 요청해도 되는 호스트인가.
 * IP 리터럴·사설 대역·내부 TLD·점 없는 호스트는 전부 거부한다.
 */
export function isSafePublicHost(hostname: string): boolean {
  const host = (hostname ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) return false;
  if (host.startsWith('[') || host.includes(':')) return false; // IPv6 리터럴 거부
  if (isPrivateIpv4(host)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // 공인 IP 리터럴도 거부(도메인만 허용)
  if (!host.includes('.')) return false;
  const blocked = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'test', 'example', 'invalid'];
  const tld = host.split('.').pop() ?? '';
  if (blocked.includes(host) || blocked.includes(tld)) return false;
  return /^[a-z0-9.-]+$/.test(host);
}

export interface NormalizedSiteUrl {
  /** https 로 강제한 진단 대상 URL. */
  readonly httpsUrl: string;
  /** http 폴백 URL (HTTPS 실패 시 사이트 존재 여부 확인용). */
  readonly httpUrl: string;
  readonly origin: string;
  readonly hostname: string;
}

/**
 * 사용자·네이버가 준 주소를 진단 가능한 형태로 정규화한다.
 * 스킴이 없으면 https 를 붙이고, http 로 왔더라도 **https 를 먼저** 시험한다.
 * 안전하지 않은 호스트면 null.
 */
export function normalizeSiteUrl(input: string): NormalizedSiteUrl | null {
  const raw = (input ?? '').trim();
  if (!raw || raw.length > 500) return null;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!isSafePublicHost(url.hostname)) return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;

  const host = url.hostname.toLowerCase();
  const path = url.pathname === '/' ? '' : url.pathname;
  return {
    httpsUrl: `https://${host}${path}`,
    httpUrl: `http://${host}${path}`,
    origin: `https://${host}`,
    hostname: host,
  };
}

/* ── HTML 판정 (순수 함수) ───────────────────────────────── */

export function extractTitle(html: string): string | null {
  const m = (html ?? '').match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  if (!m) return null;
  const text = m[1].replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, 120) : null;
}

export function hasMetaDescription(html: string): boolean {
  const m = (html ?? '').match(
    /<meta[^>]+name\s*=\s*["']description["'][^>]*>/i,
  );
  if (!m) return false;
  const content = m[0].match(/content\s*=\s*["']([\s\S]*?)["']/i);
  return Boolean(content && content[1].trim().length >= 10);
}

export function hasOpenGraph(html: string): boolean {
  return /<meta[^>]+property\s*=\s*["']og:(title|description|image)["']/i.test(html ?? '');
}

export function hasViewport(html: string): boolean {
  const m = (html ?? '').match(/<meta[^>]+name\s*=\s*["']viewport["'][^>]*>/i);
  if (!m) return false;
  return /width\s*=\s*device-width/i.test(m[0]);
}

/**
 * JSON-LD 블록에서 @type 목록을 뽑는다. 파싱 실패한 블록은 조용히 건너뛴다.
 * 중첩(@graph)도 한 단계 펼친다.
 */
export function extractJsonLdTypes(html: string): readonly string[] {
  const blocks = (html ?? '').match(
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  if (!blocks) return [];
  const types = new Set<string>();

  const collect = (node: unknown, depth: number): void => {
    if (depth > 4 || !node) return;
    if (Array.isArray(node)) {
      for (const child of node.slice(0, 50)) collect(child, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const raw = record['@type'];
    if (typeof raw === 'string') types.add(raw);
    else if (Array.isArray(raw)) for (const t of raw) if (typeof t === 'string') types.add(t);
    if ('@graph' in record) collect(record['@graph'], depth + 1);
  };

  for (const block of blocks.slice(0, 10)) {
    const inner = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    try {
      collect(JSON.parse(inner) as unknown, 0);
    } catch {
      // 깨진 JSON-LD 는 "없음"으로 취급 — 추정으로 메우지 않는다.
    }
  }
  return [...types].slice(0, 12);
}

/**
 * robots.txt 를 파싱해 AI 크롤러 차단 여부를 본다 (순수 함수).
 *
 * 판정 규칙:
 *   · `User-agent: <AI봇>` 그룹에 `Disallow: /` 가 있으면 그 봇은 차단
 *   · `User-agent: *` 그룹의 `Disallow: /` 는 전체 차단이므로 모든 AI 봇 차단으로 본다
 *   · Allow 가 더 구체적인 경우까지 해석하지는 않는다(정밀 해석은 과잉) —
 *     따라서 결과는 "차단 신호"로만 쓰고 단정 표현을 쓰지 않는다.
 */
export function parseRobotsAiBlocking(robots: string): {
  readonly blocked: readonly string[];
  readonly blocksAll: boolean;
} {
  const lines = (robots ?? '').split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
  const blocked = new Set<string>();
  let blocksAll = false;

  let current: string[] = [];
  let expectingAgents = true;
  for (const line of lines) {
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!expectingAgents) {
        current = [];
        expectingAgents = true;
      }
      current.push(value.toLowerCase());
      continue;
    }
    if (key === 'disallow') {
      expectingAgents = false;
      if (value !== '/') continue;
      for (const agent of current) {
        if (agent === '*') {
          blocksAll = true;
          continue;
        }
        const matched = AI_CRAWLER_AGENTS.find((bot) => bot.toLowerCase() === agent);
        if (matched) blocked.add(matched);
      }
      continue;
    }
    if (key === 'allow' || key === 'crawl-delay') expectingAgents = false;
  }

  if (blocksAll) return { blocked: AI_CRAWLER_AGENTS, blocksAll: true };
  return { blocked: [...blocked], blocksAll: false };
}

/* ── HTTP 계층 ───────────────────────────────────────────── */

interface TextFetch {
  readonly ok: boolean;
  readonly status: number | null;
  readonly finalUrl: string | null;
  readonly body: string;
  /** 네트워크·TLS 단계에서 실패했을 때의 원인 문자열. */
  readonly errorKind: 'tls' | 'dns' | 'timeout' | 'network' | null;
}

const FAILED: TextFetch = { ok: false, status: null, finalUrl: null, body: '', errorKind: 'network' };

/** 실패 원인을 대략 분류한다 (undici 에러 코드 기반, 표시용). */
function classifyError(error: unknown): 'tls' | 'dns' | 'timeout' | 'network' {
  const text = `${error instanceof Error ? `${error.name} ${error.message}` : String(error)} ${
    error instanceof Error && 'cause' in error ? String((error as { cause?: unknown }).cause) : ''
  }`.toLowerCase();
  if (text.includes('abort') || text.includes('timeout') || text.includes('etimedout')) return 'timeout';
  if (
    text.includes('certificate') || text.includes('ssl') || text.includes('tls') ||
    text.includes('handshake') || text.includes('eproto') || text.includes('self-signed') ||
    text.includes('altnames') || text.includes('cert_') || text.includes('err_cert')
  ) {
    return 'tls';
  }
  if (text.includes('enotfound') || text.includes('eai_again') || text.includes('dns')) return 'dns';
  return 'network';
}

/** 본문을 상한까지만 읽는다 — 거대 응답으로 메모리를 잠식하지 않도록. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, maxBytes);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let out = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (received >= maxBytes) break;
    }
  } catch {
    // 중도 실패해도 여기까지 받은 만큼으로 판정한다.
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return out;
}

/** 외부 사이트 1회 GET. 절대 throw 하지 않는다. */
async function fetchSiteText(
  url: string,
  options: { fetchImpl: typeof fetch; timeoutMs: number; maxBytes: number },
): Promise<TextFetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await options.fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain,*/*' },
    });
    // 리다이렉트 종착지도 공개 호스트여야 한다 (SSRF 재검증).
    let finalUrl: string | null = null;
    try {
      const parsed = new URL(res.url || url);
      if (!isSafePublicHost(parsed.hostname)) {
        return { ...FAILED, errorKind: 'network' };
      }
      finalUrl = parsed.toString();
    } catch {
      finalUrl = url;
    }
    const body = res.ok ? await readCapped(res, options.maxBytes) : '';
    return { ok: res.ok, status: res.status, finalUrl, body, errorKind: null };
  } catch (error) {
    return { ...FAILED, errorKind: classifyError(error) };
  } finally {
    clearTimeout(timer);
  }
}

const TLS_NOTE: Readonly<Record<'tls' | 'dns' | 'timeout' | 'network', string>> = {
  tls: 'HTTPS(보안 연결) 자체가 맺어지지 않았어요 — 인증서 만료·미설치 가능성이 커요.',
  dns: '도메인 주소를 찾지 못했어요 — 도메인 만료·DNS 설정을 확인해 주세요.',
  timeout: '응답이 제한 시간 안에 오지 않았어요 — 서버 응답이 느리거나 멈춰 있어요.',
  network: '연결에 실패했어요 — 서버가 응답하지 않아요.',
};

export const EMPTY_SITE_AXIS: SiteAxis = {
  checked: false,
  source: null,
  url: null,
  finalUrl: null,
  https: 'unknown',
  httpsNote: null,
  httpStatus: null,
  title: null,
  metaDescription: 'unknown',
  openGraph: 'unknown',
  viewport: 'unknown',
  jsonLd: 'unknown',
  jsonLdTypes: [],
  robotsTxt: 'unknown',
  sitemapXml: 'unknown',
  aiCrawler: 'unknown',
  blockedAiBots: [],
};

export interface AuditSiteOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly source: 'naver' | 'manual';
}

/**
 * 홈페이지 1건 진단. 최대 3회 GET(홈·robots.txt·sitemap.xml).
 * 어떤 단계가 실패해도 나머지는 계속하고, 실패한 항목은 'unknown' 으로 남긴다.
 */
export async function auditSite(rawUrl: string, options: AuditSiteOptions): Promise<SiteAxis> {
  const normalized = normalizeSiteUrl(rawUrl);
  if (!normalized) return { ...EMPTY_SITE_AXIS, source: options.source };

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? SITE_FETCH_TIMEOUT_MS;

  // ① HTTPS 로 홈 1회 GET
  const secure = await fetchSiteText(normalized.httpsUrl, { fetchImpl, timeoutMs, maxBytes: BODY_MAX_BYTES });

  let https: SiteCheckState = secure.ok ? 'pass' : 'fail';
  let httpsNote: string | null = null;
  let page = secure;
  /**
   * robots.txt·sitemap.xml 을 요청할 오리진.
   * HTTPS 가 안 되고 HTTP 로만 응답하는 사이트(실측: raonsmile.co.kr)에서
   * https 오리진으로 물으면 둘 다 실패해 "확인 못 함"이 된다 — 실제로는 있는데도.
   * 홈 페이지가 실제로 응답한 스킴을 그대로 따라간다.
   */
  let probeOrigin = normalized.origin;

  if (!secure.ok) {
    httpsNote = secure.errorKind
      ? TLS_NOTE[secure.errorKind]
      : `HTTPS 요청이 ${secure.status ?? '알 수 없는'} 상태로 응답했어요.`;
    // HTTP 로도 한 번만 확인 — 사이트 자체가 없는 건지, HTTPS 만 안 되는 건지 구분한다.
    const plain = await fetchSiteText(normalized.httpUrl, { fetchImpl, timeoutMs, maxBytes: BODY_MAX_BYTES });
    if (plain.ok) {
      page = plain;
      probeOrigin = `http://${normalized.hostname}`;
      httpsNote = `${httpsNote} (http:// 로는 정상 응답했어요 — HTTPS 설정만 손보면 됩니다.)`;
    } else {
      https = 'unknown';
      httpsNote = `${httpsNote} (http:// 로도 확인하지 못했어요.)`;
    }
  }

  const reachable = page.ok && page.body.length > 0;
  const state = (value: boolean): SiteCheckState => (reachable ? (value ? 'pass' : 'fail') : 'unknown');
  const jsonLdTypes = reachable ? extractJsonLdTypes(page.body) : [];

  // ② robots.txt ③ sitemap.xml — 홈이 응답했을 때만 (없는 사이트에 추가 요청하지 않는다)
  let robotsTxt: SiteCheckState = 'unknown';
  let sitemapXml: SiteCheckState = 'unknown';
  let aiCrawler: SiteAxis['aiCrawler'] = 'unknown';
  let blockedAiBots: readonly string[] = [];

  if (reachable) {
    const [robots, sitemap] = await Promise.all([
      fetchSiteText(`${probeOrigin}/robots.txt`, { fetchImpl, timeoutMs, maxBytes: ROBOTS_MAX_BYTES }),
      fetchSiteText(`${probeOrigin}/sitemap.xml`, { fetchImpl, timeoutMs, maxBytes: ROBOTS_MAX_BYTES }),
    ]);

    if (robots.status !== null) {
      const hasRobots = robots.ok && /user-agent/i.test(robots.body);
      robotsTxt = hasRobots ? 'pass' : 'fail';
      if (hasRobots) {
        const parsed = parseRobotsAiBlocking(robots.body);
        blockedAiBots = parsed.blocked;
        aiCrawler = parsed.blocked.length > 0 ? 'blocked' : 'allowed';
      } else {
        // robots.txt 가 없으면 기본은 전체 허용이다.
        aiCrawler = 'allowed';
      }
    }
    if (sitemap.status !== null) {
      sitemapXml = sitemap.ok && /<(urlset|sitemapindex)\b/i.test(sitemap.body) ? 'pass' : 'fail';
    }
  }

  return {
    checked: true,
    source: options.source,
    url: normalized.httpsUrl,
    finalUrl: page.finalUrl,
    https,
    httpsNote,
    httpStatus: page.status ?? secure.status,
    title: reachable ? extractTitle(page.body) : null,
    metaDescription: state(hasMetaDescription(page.body)),
    openGraph: state(hasOpenGraph(page.body)),
    viewport: state(hasViewport(page.body)),
    jsonLd: state(jsonLdTypes.length > 0),
    jsonLdTypes,
    robotsTxt,
    sitemapXml,
    aiCrawler,
    blockedAiBots,
  };
}
