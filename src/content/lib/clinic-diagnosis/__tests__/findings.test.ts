import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RANK_CAVEAT,
  buildAiFindings,
  buildComplianceFindings,
  buildFindings,
  buildSiteFindings,
  collectUnchecked,
  summarizeFindings,
} from '../findings.ts';
import { EMPTY_SITE_AXIS } from '../site-audit.ts';
import { EMPTY_AI_AXIS } from '../ai-citation.ts';
import { EMPTY_COMPLIANCE_AXIS } from '../compliance-scan.ts';
import type { AiAxis, BlogAxis, ComplianceAxis, Finding, SiteAxis } from '../types.ts';

const BLOG_OK: BlogAxis = {
  checked: true,
  source: 'auto',
  resolution: {
    kind: 'confident',
    guess: { blogId: 'vbps_official', bloggerName: '브이비성형외과의원', hits: 8, nameInBloggerName: true, titleMentions: 8, confidence: 100 },
  },
  blogId: 'vbps_official',
  blogTitle: '브이비성형외과의원',
  postCount: 50,
  latestPostAt: '2026-07-21T00:00:00.000Z',
  daysSinceLatest: 5,
  postsPerWeek: 2.1,
  keywords: [{ keyword: '대구 성형외과', apiRank: 4, docCount: 120_000 }],
  rankChecked: true,
};

const SITE_OK: SiteAxis = {
  ...EMPTY_SITE_AXIS,
  checked: true,
  source: 'naver',
  url: 'https://vb.vbeauty.co.kr',
  finalUrl: 'https://vb.vbeauty.co.kr/',
  https: 'pass',
  httpStatus: 200,
  metaDescription: 'pass',
  openGraph: 'pass',
  viewport: 'pass',
  jsonLd: 'pass',
  jsonLdTypes: ['MedicalClinic'],
  robotsTxt: 'pass',
  sitemapXml: 'pass',
  aiCrawler: 'allowed',
};

function ids(findings: readonly Finding[]): string[] {
  return findings.map((f) => f.id);
}

/* ── 3단 구조 강제 ──────────────────────────────────────── */

test('모든 카드는 "지금 상태"와 "뭘 해야 하나"를 반드시 갖는다', () => {
  const findings = buildFindings({ blog: BLOG_OK, site: SITE_OK, ai: EMPTY_AI_AXIS, compliance: EMPTY_COMPLIANCE_AXIS });
  assert.ok(findings.length > 0);
  for (const f of findings) {
    assert.ok(f.state.trim().length > 0, `${f.id}: 지금 상태가 비어 있다`);
    assert.ok(f.action.trim().length > 0, `${f.id}: 행동이 비어 있다`);
  }
});

test('경고 카드는 "왜 문제인가"가 반드시 붙는다 (좋음·미확인은 없어도 된다)', () => {
  const findings = buildFindings({
    blog: { ...BLOG_OK, daysSinceLatest: 120, postsPerWeek: 0.2, keywords: [{ keyword: '대구 성형외과', apiRank: null, docCount: 120 }] },
    site: { ...SITE_OK, https: 'fail', httpsNote: '인증서 문제', viewport: 'fail', jsonLd: 'fail', jsonLdTypes: [], aiCrawler: 'blocked', blockedAiBots: ['GPTBot'] },
    ai: EMPTY_AI_AXIS,
    compliance: EMPTY_COMPLIANCE_AXIS,
  });
  const warns = findings.filter((f) => f.tone === 'warn');
  assert.ok(warns.length >= 4);
  for (const f of warns) {
    assert.ok(f.why && f.why.trim().length > 0, `${f.id}: 경고인데 이유가 없다`);
  }
});

/* ── 균형: 광고로 읽히지 않게 ───────────────────────────── */

test('우리 제품과 무관한 항목(ourScope=false)이 반드시 섞인다', () => {
  const findings = buildFindings({
    blog: { ...BLOG_OK, daysSinceLatest: 200, keywords: [{ keyword: '대구 성형외과', apiRank: null, docCount: 10 }] },
    site: { ...SITE_OK, https: 'fail', httpsNote: 'x', viewport: 'fail' },
    ai: { ...EMPTY_AI_AXIS, checked: true, probes: [{ question: 'q', engine: 'openai', mentioned: false, path: 'none', evidence: null, ownedSources: [], thirdPartyHosts: [] }] },
    compliance: { ...EMPTY_COMPLIANCE_AXIS, checked: true, postsScanned: 10, hits: [{ postTitle: 't', postLink: 'l', phrase: '최고', note: 'n', level: 'review' }], postsWithHits: 1 },
  });
  const outside = findings.filter((f) => !f.ourScope);
  assert.ok(outside.length >= 3, '전부 우리 제품으로 귀결되면 광고로 읽힌다');
  // 홈페이지 축은 전부 우리 밖 영역이어야 한다
  assert.ok(findings.filter((f) => f.axis === 'site').every((f) => !f.ourScope));
});

test('잘하고 있는 항목은 그대로 칭찬한다', () => {
  const findings = buildFindings({ blog: BLOG_OK, site: SITE_OK, ai: EMPTY_AI_AXIS, compliance: EMPTY_COMPLIANCE_AXIS });
  const good = findings.filter((f) => f.tone === 'good');
  assert.ok(good.length >= 4, `좋은 항목이 ${good.length}개뿐 — 전부 빨간불이면 신뢰가 안 간다`);
  for (const f of good) assert.equal(f.why, null, `${f.id}: 좋은 항목에 문제 설명이 붙어 있다`);
});

/* ── 정직성: 못 구한 것은 못 구했다고 ───────────────────── */

test('데이터를 못 구한 축은 unknown + "확인하지 못했습니다"로 표기된다', () => {
  const findings = buildFindings({
    blog: { ...BLOG_OK, checked: false, blogId: null, resolution: { kind: 'unavailable' } },
    site: EMPTY_SITE_AXIS,
    ai: EMPTY_AI_AXIS,
    compliance: EMPTY_COMPLIANCE_AXIS,
  });
  const unknowns = findings.filter((f) => f.tone === 'unknown');
  assert.equal(unknowns.length, findings.length, '확인된 게 없으면 전부 unknown 이어야 한다');
  for (const f of unknowns) assert.match(f.state, /확인하지 못했|특정하지 못했/);
});

test('collectUnchecked 는 확인 못 한 축 이름을 그대로 돌려준다', () => {
  const unchecked = collectUnchecked({
    blog: { ...BLOG_OK, blogId: null },
    site: EMPTY_SITE_AXIS,
    ai: EMPTY_AI_AXIS,
    compliance: EMPTY_COMPLIANCE_AXIS,
  });
  assert.deepEqual(unchecked, ['네이버 블로그', '홈페이지', 'AI 검색 인용', '의료광고법 표현']);
});

/* ── 블로그 축 ──────────────────────────────────────────── */

test('블로그 추정이 애매하면 진단을 이어가지 않고 사용자 선택으로 넘긴다', () => {
  const findings = buildFindings({
    blog: {
      ...BLOG_OK, blogId: null,
      resolution: { kind: 'uncertain', guesses: [
        { blogId: 'ehdrjsdlgud1', bloggerName: '플로르성형외과의원', hits: 1, nameInBloggerName: true, titleMentions: 1, confidence: 65 },
        { blogId: 'florps1', bloggerName: '플로르 성형외과의원', hits: 1, nameInBloggerName: true, titleMentions: 1, confidence: 65 },
      ] },
    },
    site: EMPTY_SITE_AXIS, ai: EMPTY_AI_AXIS, compliance: EMPTY_COMPLIANCE_AXIS,
  });
  const blogCards = findings.filter((f) => f.axis === 'blog');
  assert.deepEqual(ids(blogCards), ['blog.exists']);
  assert.equal(blogCards[0].tone, 'unknown');
  assert.match(blogCards[0].action, /잘못 짚은 블로그로 진단해 드리지 않으려고/);
});

test('순위 항목에는 API·화면 순위 차이 경고가 항상 붙는다', () => {
  const exposed = buildFindings({ blog: BLOG_OK, site: EMPTY_SITE_AXIS, ai: EMPTY_AI_AXIS, compliance: EMPTY_COMPLIANCE_AXIS });
  assert.ok(exposed.find((f) => f.id === 'blog.rank')?.state.includes(RANK_CAVEAT));

  const notExposed = buildFindings({
    blog: { ...BLOG_OK, keywords: [{ keyword: '대구 성형외과', apiRank: null, docCount: 10 }] },
    site: EMPTY_SITE_AXIS, ai: EMPTY_AI_AXIS, compliance: EMPTY_COMPLIANCE_AXIS,
  });
  assert.ok(notExposed.find((f) => f.id === 'blog.rank')?.state.includes(RANK_CAVEAT));
});

/* ── AI 축 (이 진단의 핵심 논지) ────────────────────────── */

function aiAxis(over: Partial<AiAxis>): AiAxis {
  return { ...EMPTY_AI_AXIS, checked: true, ...over };
}

test('AI가 언급했지만 근거가 전부 디렉터리면 그 사실을 정면으로 말한다', () => {
  const findings = buildAiFindings(
    aiAxis({
      probes: [
        { question: 'q1', engine: 'openai', mentioned: true, path: 'directory', evidence: 'e', ownedSources: [], thirdPartyHosts: ['goodoc.co.kr'] },
        { question: 'q2', engine: 'openai', mentioned: true, path: 'directory', evidence: 'e', ownedSources: [], thirdPartyHosts: ['modoodoc.com'] },
      ],
      mentionedCount: 2, directoryCount: 2, ownedCount: 0,
    }),
    true,
  );
  const path = findings.find((f) => f.id === 'ai.path');
  assert.equal(path?.tone, 'warn');
  assert.match(path?.state ?? '', /병원 블로그나 홈페이지가 근거로 잡힌 건 0건/);
  assert.equal(path?.ourScope, true);
});

test('자기 자산이 근거로 잡혔으면 칭찬하고 팔지 않는다', () => {
  const findings = buildAiFindings(
    aiAxis({
      probes: [{ question: 'q', engine: 'openai', mentioned: true, path: 'owned', evidence: 'e', ownedSources: ['https://blog.naver.com/vbps_official/1'], thirdPartyHosts: [] }],
      mentionedCount: 1, ownedCount: 1,
    }),
    true,
  );
  const path = findings.find((f) => f.id === 'ai.path');
  assert.equal(path?.tone, 'good');
  assert.equal(path?.ourScope, false);
});

test('AI 축을 못 돌렸으면 "미언급"이 아니라 "확인하지 못함"이다', () => {
  const findings = buildAiFindings(EMPTY_AI_AXIS, false);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tone, 'unknown');
  assert.match(findings[0].state, /확인하지 못했습니다/);
});

/* ── 의료광고법 축: 단정 금지 ───────────────────────────── */

function complianceAxis(over: Partial<ComplianceAxis>): ComplianceAxis {
  return { ...EMPTY_COMPLIANCE_AXIS, checked: true, postsScanned: 30, bodiesScanned: 2, ...over };
}

test('의료광고법 카드는 위반·처분으로 단정하지 않는다', () => {
  const findings = buildComplianceFindings(
    complianceAxis({
      hits: [{ postTitle: '글', postLink: 'l', phrase: '최고', note: '최상급 표현 관련…', level: 'review' }],
      postsWithHits: 1,
    }),
  );
  const card = findings[0];
  assert.match(card.state, /자주 지적되는 표현/);
  assert.match(card.why ?? '', /지금 위반이라는 판단은 아닙니다/);
  for (const forbidden of ['위반입니다', '처분 대상', '불법', '고발']) {
    assert.ok(!`${card.state}${card.why}${card.action}`.includes(forbidden), `단정 표현 "${forbidden}" 이 들어갔다`);
  }
});

test('검출이 없으면 칭찬하되 검사 범위의 한계를 함께 밝힌다', () => {
  const findings = buildComplianceFindings(complianceAxis({ hits: [], postsWithHits: 0 }));
  assert.equal(findings[0].tone, 'good');
  assert.match(findings[0].action, /본문 전체를 다 본 것은 아니니/);
});

/* ── 홈페이지 축 ────────────────────────────────────────── */

test('홈페이지 주소를 못 찾으면 요청 없이 안내만 한다', () => {
  const findings = buildSiteFindings(EMPTY_SITE_AXIS);
  assert.deepEqual(ids(findings), ['site.exists']);
  assert.equal(findings[0].tone, 'unknown');
});

test('AI 크롤러 차단은 무조건 나쁘다고 하지 않는다 (의도적 차단 가능성 인정)', () => {
  const findings = buildSiteFindings({ ...SITE_OK, aiCrawler: 'blocked', blockedAiBots: ['GPTBot', 'ClaudeBot'] });
  const card = findings.find((f) => f.id === 'site.aiCrawler');
  assert.match(card?.action ?? '', /콘텐츠 보호가 목적이었다면 그대로 두셔도 됩니다/);
});

test('구조화 데이터가 있어도 병원용 스키마가 아니면 경고한다', () => {
  const findings = buildSiteFindings({ ...SITE_OK, jsonLd: 'pass', jsonLdTypes: ['WebSite', 'Organization'] });
  const card = findings.find((f) => f.id === 'site.jsonld');
  assert.equal(card?.tone, 'warn');
  assert.match(card?.state ?? '', /병원 정보용 항목은 없습니다/);
});

/* ── 요약 ───────────────────────────────────────────────── */

test('summarizeFindings 는 좋음·주의·미확인을 따로 센다 (점수 하나로 뭉개지 않는다)', () => {
  const summary = summarizeFindings(
    buildFindings({ blog: BLOG_OK, site: SITE_OK, ai: EMPTY_AI_AXIS, compliance: EMPTY_COMPLIANCE_AXIS }),
  );
  assert.ok(summary.good > 0);
  assert.ok(summary.unknown > 0);
  assert.equal(typeof summary.warn, 'number');
});
