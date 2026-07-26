import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SITEMAP_INDEX_MAX_PAGE,
  SITEMAP_INDEX_PAGE_SIZE,
  buildSitemapIndexXml,
  escapeXml,
  parseSitemapPage,
  selectIndexableClinics,
  sitemapPageRange,
  toIsoOrNull,
  type ClinicSitemapSource,
} from '../sitemap-index.ts';

/** 테스트용 loc 조립 — 실제 라우트는 validateSlug + clinicSiteUrl 를 주입한다. */
const buildLoc = (slug: string): string | null =>
  /^[a-z0-9-]+$/.test(slug) ? `https://${slug}.hospitalblog.kr/sitemap.xml` : null;

const source = (
  slug: string,
  postCount: number,
  lastPublishedAt: string | null = null,
): ClinicSitemapSource => ({ slug, postCount, lastPublishedAt });

test('selectIndexableClinics: 발행 글 0편인 병원은 제외한다 (빈 사이트맵 제출 금지)', () => {
  const entries = selectIndexableClinics(
    [source('alpha', 3), source('beta', 0), source('gamma', 1)],
    buildLoc,
  );
  assert.deepEqual(
    entries.map((e) => e.loc),
    [
      'https://alpha.hospitalblog.kr/sitemap.xml',
      'https://gamma.hospitalblog.kr/sitemap.xml',
    ],
  );
});

test('selectIndexableClinics: postCount 가 음수·NaN 이면 제외한다', () => {
  const entries = selectIndexableClinics(
    [source('alpha', -1), source('beta', Number.NaN), source('gamma', 2)],
    buildLoc,
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].loc, 'https://gamma.hospitalblog.kr/sitemap.xml');
});

test('selectIndexableClinics: buildLoc 이 null 인 슬러그(형식 위반)는 제외한다', () => {
  const entries = selectIndexableClinics([source('BAD SLUG', 5), source('ok-clinic', 5)], buildLoc);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].loc, 'https://ok-clinic.hospitalblog.kr/sitemap.xml');
});

test('selectIndexableClinics: 중복 loc 은 한 번만 담는다', () => {
  const entries = selectIndexableClinics([source('alpha', 1), source('alpha', 9)], buildLoc);
  assert.equal(entries.length, 1);
});

test('selectIndexableClinics: 입력 순서를 유지한다 (site_slug 오름차순 페이지네이션 전제)', () => {
  const entries = selectIndexableClinics(
    [source('c-clinic', 1), source('a-clinic', 1), source('b-clinic', 1)],
    buildLoc,
  );
  assert.deepEqual(
    entries.map((e) => e.loc),
    [
      'https://c-clinic.hospitalblog.kr/sitemap.xml',
      'https://a-clinic.hospitalblog.kr/sitemap.xml',
      'https://b-clinic.hospitalblog.kr/sitemap.xml',
    ],
  );
});

test('selectIndexableClinics: 입력 배열을 변형하지 않는다 (불변)', () => {
  const input = [source('alpha', 1), source('beta', 0)];
  const snapshot = JSON.stringify(input);
  selectIndexableClinics(input, buildLoc);
  assert.equal(JSON.stringify(input), snapshot);
});

test('toIsoOrNull: 파싱 불가·빈 값이면 null (lastmod 생략)', () => {
  assert.equal(toIsoOrNull(null), null);
  assert.equal(toIsoOrNull(''), null);
  assert.equal(toIsoOrNull('not-a-date'), null);
  assert.equal(toIsoOrNull('2026-07-25T01:02:03.000Z'), '2026-07-25T01:02:03.000Z');
});

test('buildSitemapIndexXml: sitemapindex 스키마 + loc/lastmod 를 낸다', () => {
  const xml = buildSitemapIndexXml([
    { loc: 'https://alpha.hospitalblog.kr/sitemap.xml', lastModified: '2026-07-25T00:00:00.000Z' },
    { loc: 'https://beta.hospitalblog.kr/sitemap.xml', lastModified: null },
  ]);

  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
  assert.ok(xml.includes('<loc>https://alpha.hospitalblog.kr/sitemap.xml</loc>'));
  assert.ok(xml.includes('<lastmod>2026-07-25T00:00:00.000Z</lastmod>'));
  // lastmod 없는 항목엔 빈 lastmod 태그를 만들지 않는다
  assert.equal(xml.match(/<lastmod>/g)?.length, 1);
  assert.ok(xml.trimEnd().endsWith('</sitemapindex>'));
});

test('buildSitemapIndexXml: 항목 0개여도 well-formed 한 빈 인덱스를 낸다', () => {
  const xml = buildSitemapIndexXml([]);
  assert.ok(xml.includes('<sitemapindex'));
  assert.ok(xml.includes('</sitemapindex>'));
  assert.ok(!xml.includes('<sitemap>'));
});

test('escapeXml: XML 특수문자를 이스케이프한다', () => {
  assert.equal(escapeXml('a&b<c>d"e\'f'), 'a&amp;b&lt;c&gt;d&quot;e&apos;f');
});

test('parseSitemapPage: 잘못된 값은 1 로, 상한 초과는 최대 페이지로 클램프', () => {
  assert.equal(parseSitemapPage(null), 1);
  assert.equal(parseSitemapPage(''), 1);
  assert.equal(parseSitemapPage('abc'), 1);
  assert.equal(parseSitemapPage('0'), 1);
  assert.equal(parseSitemapPage('-5'), 1);
  assert.equal(parseSitemapPage('2'), 2);
  assert.equal(parseSitemapPage('99999'), SITEMAP_INDEX_MAX_PAGE);
});

test('sitemapPageRange: 0 기반 range 로 변환한다', () => {
  assert.deepEqual(sitemapPageRange(1), { from: 0, to: SITEMAP_INDEX_PAGE_SIZE - 1 });
  assert.deepEqual(sitemapPageRange(2), {
    from: SITEMAP_INDEX_PAGE_SIZE,
    to: SITEMAP_INDEX_PAGE_SIZE * 2 - 1,
  });
  // 범위 밖 입력도 안전하게 클램프
  assert.deepEqual(sitemapPageRange(0), { from: 0, to: SITEMAP_INDEX_PAGE_SIZE - 1 });
});

test('페이지 상한이 사이트맵 프로토콜 한도(50,000)를 넘지 않는다', () => {
  assert.ok(SITEMAP_INDEX_PAGE_SIZE * SITEMAP_INDEX_MAX_PAGE <= 50_000);
});
