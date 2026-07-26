import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  allRootLayoutTags,
  clinicSiteBlockedTags,
  isAllowedOnClinicSite,
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
// 루트 레이아웃 회귀 가드 — 정책을 실제로 "쓰고 있는지" 소스로 검증한다.
// (정책 함수만 맞고 레이아웃이 조건 없이 렌더하면 유출은 그대로 일어난다.)
// ---------------------------------------------------------------------------

const LAYOUT_PATH = new URL('../../../../app/layout.tsx', import.meta.url);
const layoutSource = readFileSync(LAYOUT_PATH, 'utf8');

test('루트 레이아웃: MetaPixel 은 정책 게이트 뒤에서만 렌더된다', () => {
  const occurrences = layoutSource.match(/<MetaPixel\b/g) ?? [];
  assert.equal(occurrences.length, 1, 'MetaPixel 렌더 지점은 정확히 1곳이어야 한다');
  assert.match(layoutSource, /showTag\('meta-pixel'\)\s*&&\s*<MetaPixel\b/);
});

test('루트 레이아웃: PortOne SDK 스크립트는 정책 게이트 뒤에서만 렌더된다', () => {
  const occurrences = layoutSource.match(/cdn\.portone\.io/g) ?? [];
  assert.equal(occurrences.length, 1, 'PortOne SDK 로드 지점은 정확히 1곳이어야 한다');
  assert.match(
    layoutSource,
    /showTag\('portone-browser-sdk'\)\s*&&\s*<Script\s+src="https:\/\/cdn\.portone\.io/,
  );
});

test('루트 레이아웃: SaaS JSON-LD·알림벨도 정책 게이트를 통과한다', () => {
  assert.match(layoutSource, /showTag\('saas-json-ld'\)\s*&&/);
  assert.match(layoutSource, /showTag\('notification-bell'\)\s*&&/);
});

test('루트 레이아웃: 차단 대상 태그가 전부 게이트에 등장한다 (누락 감지)', () => {
  for (const tag of clinicSiteBlockedTags()) {
    assert.ok(
      layoutSource.includes(`showTag('${tag}')`),
      `layout.tsx 에 showTag('${tag}') 게이트가 없다 — 병원 블로그로 유출된다`,
    );
  }
});

test('루트 레이아웃: 미들웨어 헤더로 병원 블로그를 판정한다', () => {
  assert.match(layoutSource, /CLINIC_SITE_REQUEST_HEADER/);
  assert.match(layoutSource, /shouldRenderTag/);
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
