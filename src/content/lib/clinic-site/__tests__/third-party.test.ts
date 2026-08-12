import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  allRootLayoutTags,
  clinicSiteBlockedTags,
  isAllowedOnClinicSite,
  isAllowedOnTokenBearingPath,
  isTokenBearingPath,
  shouldRenderTag,
  tagPolicyReason,
  type RootLayoutTag,
} from '../third-party.ts';

// ---------------------------------------------------------------------------
// 정책 자체
// ---------------------------------------------------------------------------

test('★ 병원 블로그에서는 메타 픽셀이 로드되지 않는다 (환자 리타게팅 수집 차단)', () => {
  assert.equal(shouldRenderTag('meta-pixel', true), false);
  assert.equal(isAllowedOnClinicSite('meta-pixel'), false);
});

test('★ 병원 블로그에서는 PortOne 결제 SDK 가 로드되지 않는다', () => {
  assert.equal(shouldRenderTag('portone-browser-sdk', true), false);
  assert.equal(isAllowedOnClinicSite('portone-browser-sdk'), false);
});

test('★ 병원 블로그에서는 SaaS JSON-LD·알림벨도 나가지 않는다', () => {
  assert.equal(shouldRenderTag('saas-json-ld', true), false);
  assert.equal(shouldRenderTag('notification-bell', true), false);
});

test('★ 메인 사이트에서는 전부 그대로 로드된다 (기존 동작 100% 유지)', () => {
  for (const tag of allRootLayoutTags()) {
    assert.equal(shouldRenderTag(tag, false), true, `${tag} 는 메인 사이트에서 렌더돼야 한다`);
  }
});

test('Vercel Analytics 는 병원 블로그에서도 유지한다 (쿠키·개인식별 없는 트래픽 측정)', () => {
  assert.equal(shouldRenderTag('vercel-analytics', true), true);
});

test('차단 목록이 명세와 정확히 일치한다 (새 태그가 조용히 새어나가지 않도록)', () => {
  assert.deepEqual(clinicSiteBlockedTags().sort(), [
    'meta-pixel',
    'notification-bell',
    'portone-browser-sdk',
    'saas-json-ld',
  ]);
});

test('모든 태그에 판단 근거가 적혀 있다', () => {
  for (const tag of allRootLayoutTags()) {
    assert.ok(tagPolicyReason(tag).length > 20, `${tag} 근거가 비어 있다`);
  }
});

// ---------------------------------------------------------------------------
// 서드파티 태그 묶음 회귀 가드 — 정책을 실제로 "쓰고 있는지" 소스로 검증한다.
// (정책 함수만 맞고 컴포넌트가 조건 없이 렌더하면 유출은 그대로 일어난다.)
//
// 판정 위치가 루트 레이아웃(서버·요청 헤더) → RootThirdPartyTags(클라이언트·
// 브라우저 문맥)로 옮겨졌다. 이유는 ISR — 아래 "루트 레이아웃 정적성" 블록 참조.
// ---------------------------------------------------------------------------

const LAYOUT_PATH = new URL('../../../../app/layout.tsx', import.meta.url);
const layoutSource = readFileSync(LAYOUT_PATH, 'utf8');

const TAGS_PATH = new URL('../../../../dev/components/RootThirdPartyTags.tsx', import.meta.url);
const tagsSource = readFileSync(TAGS_PATH, 'utf8');

test('서드파티 묶음: MetaPixel 은 정책 게이트 뒤에서만 렌더된다', () => {
  const occurrences = tagsSource.match(/<MetaPixel\b/g) ?? [];
  assert.equal(occurrences.length, 1, 'MetaPixel 렌더 지점은 정확히 1곳이어야 한다');
  assert.match(tagsSource, /showTag\('meta-pixel'\)\s*&&\s*<MetaPixel\b/);
});

test('서드파티 묶음: PortOne SDK 스크립트는 정책 게이트 뒤에서만 렌더된다', () => {
  const occurrences = tagsSource.match(/cdn\.portone\.io/g) ?? [];
  assert.equal(occurrences.length, 1, 'PortOne SDK 로드 지점은 정확히 1곳이어야 한다');
  assert.match(
    tagsSource,
    /showTag\('portone-browser-sdk'\)\s*&&\s*<Script\s+src="https:\/\/cdn\.portone\.io/,
  );
});

test('서드파티 묶음: 알림벨도 정책 게이트를 통과한다', () => {
  assert.match(tagsSource, /showTag\('notification-bell'\)\s*&&/);
});

test('서드파티 묶음: 차단 대상 태그가 전부 게이트에 등장한다 (누락 감지)', () => {
  for (const tag of clinicSiteBlockedTags()) {
    // saas-json-ld 는 게이트가 아니라 구조로 지킨다(홈에만 출력) — 아래 별도 검사.
    if (tag === 'saas-json-ld') continue;
    assert.ok(
      tagsSource.includes(`showTag('${tag}')`),
      `RootThirdPartyTags 에 showTag('${tag}') 게이트가 없다 — 병원 블로그로 유출된다`,
    );
  }
});

test('★ 서드파티 묶음: 판정 전(마운트 이전)에는 아무 태그도 렌더하지 않는다', () => {
  // 서버 렌더 시점에는 호스트명을 알 수 없다. 미리 그리면 "판정 전 1회"에
  // 메타 픽셀이 병원 블로그 HTML 로 새어나간다.
  assert.match(tagsSource, /if\s*\(!mounted\)\s*return null;/);
  // 판정 입력은 브라우저 문맥(호스트명 + 경로)이다.
  assert.match(tagsSource, /isClinicSiteBrowserContext\(\s*window\.location\.hostname,\s*pathname\s*\)/);
  assert.match(tagsSource, /shouldRenderTag/);
});

// ---------------------------------------------------------------------------
// ★ 루트 레이아웃 정적성 가드 — /clinic-site/* ISR(revalidate=3600)의 생명줄.
//   레이아웃이 동적 API 를 쓰면 하위 세그먼트 전체가 동적으로 내려가 ISR 이 죽는다.
//   (2026-07 실측으로 규명된 회귀 — 다시 들어오면 여기서 잡힌다.)
// ---------------------------------------------------------------------------

/** 주석을 걷어낸 실행 코드만 남긴다 — 설명 문장이 가드에 걸리지 않도록. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const layoutCode = stripComments(layoutSource);

test('★ 루트 레이아웃: 동적 API(headers/cookies)를 쓰지 않는다 — ISR 유지', () => {
  assert.ok(!/from\s+'next\/headers'/.test(layoutCode), "layout.tsx 가 next/headers 를 다시 쓴다 — /clinic-site/* ISR 이 죽는다");
  assert.ok(!/\bheaders\s*\(\)/.test(layoutCode), 'layout.tsx 에 headers() 호출이 생겼다 — ISR 이 죽는다');
  assert.ok(!/\bcookies\s*\(\)/.test(layoutCode), 'layout.tsx 에 cookies() 호출이 생겼다 — ISR 이 죽는다');
  assert.ok(
    !/createServerSupabaseClient/.test(layoutCode),
    'layout.tsx 가 쿠키 기반 Supabase 클라이언트를 쓴다 — 내부적으로 cookies() 라 ISR 이 죽는다',
  );
});

test('★ 루트 레이아웃: dynamic/revalidate 강제 선언을 넣지 않는다', () => {
  assert.ok(
    !/export\s+const\s+(dynamic|revalidate|fetchCache|runtime)\b/.test(layoutCode),
    'layout.tsx 의 렌더 모드는 강제하지 않는다 — 동적 API 를 안 쓰면 자동으로 정적이다',
  );
});

test('★ 루트 레이아웃: 회사 JSON-LD 를 전 페이지에 뿌리지 않는다 (홈으로 이전)', () => {
  assert.ok(
    !/buildOrganizationJsonLd|buildSoftwareApplicationJsonLd/.test(layoutSource),
    'layout.tsx 가 회사 스키마를 다시 렌더한다 — 고객 병원 블로그로 샌다',
  );
  const homeSource = readFileSync(new URL('../../../../app/page.tsx', import.meta.url), 'utf8');
  assert.match(homeSource, /<JsonLd data=\{buildOrganizationJsonLd\(\)\}/);
  assert.match(homeSource, /<JsonLd data=\{buildSoftwareApplicationJsonLd\(\)\}/);
});

test('★ 병원 블로그 페이지에는 회사 스키마가 없다 (구조로 보장)', () => {
  const clinicPages: readonly string[] = [
    '../../../../app/clinic-site/[slug]/page.tsx',
    '../../../../app/clinic-site/[slug]/about/page.tsx',
    '../../../../app/clinic-site/[slug]/posts/[postId]/page.tsx',
  ];
  for (const relative of clinicPages) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.ok(
      !/buildOrganizationJsonLd|buildSoftwareApplicationJsonLd/.test(source),
      `${relative} 에 닥터포스트 회사 스키마가 들어갔다`,
    );
  }
});

test('★ 병원 블로그 페이지는 ISR(revalidate + generateStaticParams) 을 선언한다', () => {
  const isrPages: readonly string[] = [
    '../../../../app/clinic-site/[slug]/page.tsx',
    '../../../../app/clinic-site/[slug]/about/page.tsx',
    '../../../../app/clinic-site/[slug]/posts/[postId]/page.tsx',
  ];
  for (const relative of isrPages) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.match(source, /export const revalidate = \d+/, `${relative} 에 revalidate 선언이 없다`);
    // ★ 동적 세그먼트는 generateStaticParams 가 있어야 prerender-manifest 에 들어간다.
    //   없으면 revalidate 가 조용히 무시되고 매 요청 서버 렌더가 된다(2026-07 실측).
    assert.match(
      stripComments(source),
      /export async function generateStaticParams\(/,
      `${relative} 에 generateStaticParams 가 없다 — revalidate 가 무시되고 ISR 이 죽는다`,
    );
    assert.ok(
      !/export\s+const\s+dynamic\s*=\s*'force-dynamic'/.test(source),
      `${relative} 가 force-dynamic 을 선언했다 — ISR 이 무의미해진다`,
    );
  }
});

test('병원 블로그 페이지에는 클라이언트 컴포넌트·window 접근이 없다 (SDK 제거해도 기능 손실 0)', () => {
  const pages: readonly string[] = [
    '../../../../app/clinic-site/[slug]/page.tsx',
    '../../../../app/clinic-site/[slug]/posts/[postId]/page.tsx',
    '../../../../app/clinic-site/[slug]/site-chrome.tsx',
  ];
  for (const relative of pages) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.ok(!source.includes("'use client'"), `${relative} 에 use client 가 생겼다`);
    assert.ok(!/\bwindow\./.test(source), `${relative} 에 window 접근이 생겼다`);
    assert.ok(!/\bfbq\b/.test(source), `${relative} 에 픽셀 호출이 생겼다`);
    assert.ok(!/PortOne/.test(source), `${relative} 에 결제 SDK 의존이 생겼다`);
  }
});

test('shouldRenderTag: 타입 안전하게 전 태그를 커버한다', () => {
  const tags: RootLayoutTag[] = allRootLayoutTags();
  assert.ok(tags.length >= 5);
  for (const tag of tags) {
    assert.equal(typeof shouldRenderTag(tag, true), 'boolean');
  }
});

// ---------------------------------------------------------------------------
// 토큰이 실린 주소 (2026-08-12)
//   /clinic-check/r/{token} 은 토큰만 있으면 리포트가 열리는 주소다.
//   메타 픽셀은 이벤트와 별개로 문서 주소를 함께 보내므로, 여기서 픽셀이 돌면
//   우리가 광고 플랫폼에 리포트 열쇠를 넘기게 된다.
// ---------------------------------------------------------------------------

test('★ 공유 리포트 주소에서는 메타 픽셀을 렌더하지 않는다 (토큰 유출 차단)', () => {
  assert.equal(isTokenBearingPath('/clinic-check/r/abc123'), true);
  assert.equal(isAllowedOnTokenBearingPath('meta-pixel'), false);
});

test('토큰 경로 판정 — 진단 입력 화면·홈은 해당 없음', () => {
  assert.equal(isTokenBearingPath('/clinic-check'), false);
  assert.equal(isTokenBearingPath('/clinic-check?name=OO의원'), false);
  assert.equal(isTokenBearingPath('/'), false);
  assert.equal(isTokenBearingPath(null), false);
  assert.equal(isTokenBearingPath(undefined), false);
});

test('★ 공유 리포트 주소에서는 Vercel Analytics 도 렌더하지 않는다', () => {
  // 처음엔 "동적 라우트를 패턴으로만 보고한다"고 봤는데 틀렸다.
  // @vercel/analytics 2.0.1 은 pageview({ route, path }) 로 실제 경로도 함께 보낸다.
  assert.equal(isAllowedOnTokenBearingPath('vercel-analytics'), false);
});

test('raw URL 을 안 보내는 태그는 토큰 경로에서도 유지된다', () => {
  assert.equal(isAllowedOnTokenBearingPath('notification-bell'), true);
  assert.equal(isAllowedOnTokenBearingPath('portone-browser-sdk'), true);
});

test('★ raw URL 을 보내는 태그 목록에 빠진 것이 없는지 — 새 태그 추가 시 함께 검토', () => {
  // 이 테스트는 "검토했다"는 기록이다. 새 외부 태그가 늘면 여기서 걸려
  // raw URL 전송 여부를 판단하게 만든다.
  const known: RootLayoutTag[] = [
    'saas-json-ld', 'meta-pixel', 'portone-browser-sdk',
    'vercel-analytics', 'notification-bell',
  ];
  assert.deepEqual(allRootLayoutTags().sort(), known.sort());
});
