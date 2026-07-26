import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FINDING_WEIGHT,
  RANK_CAVEAT,
  buildAiFindings,
  buildComplianceFindings,
  buildFindings,
  buildSiteFindings,
  collectUnchecked,
  groupFindings,
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
    ai: { ...EMPTY_AI_AXIS, checked: true, recommendTotal: 1, probes: [{ question: 'q', kind: 'recommend', engine: 'openai', mentioned: false, path: 'none', evidence: null, ownedSources: [], thirdPartyHosts: [] }] },
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

/* ── 3분류: 초짜가 봐도 뭐부터 볼지 알아야 한다 ─────────── */

test('groupFindings 는 못된 점 / 개선할 점 / 잘된 점 / 미확인으로 나눈다', () => {
  const findings = buildFindings({
    blog: { ...BLOG_OK, daysSinceLatest: 120, postsPerWeek: 0.2 },
    site: { ...SITE_OK, https: 'fail', httpsNote: '인증서 만료', viewport: 'fail', jsonLd: 'fail', jsonLdTypes: [] },
    ai: EMPTY_AI_AXIS,
    compliance: EMPTY_COMPLIANCE_AXIS,
  });
  const groups = groupFindings(findings);

  // 분류 합계는 원본과 정확히 같아야 한다 (누락·중복 금지)
  assert.equal(
    groups.bad.length + groups.improve.length + groups.good.length + groups.unknown.length,
    findings.length,
  );
  assert.ok(groups.bad.some((f) => f.id === 'site.https'), 'HTTPS 실패는 지금 손해다');
  assert.ok(groups.improve.some((f) => f.id === 'site.readable'), '기술 위생은 개선할 점이다');
  assert.ok(groups.unknown.every((f) => f.tone === 'unknown'));
  assert.ok(groups.good.every((f) => f.tone === 'good'));
});

test('덩어리 안은 중요도(rank) 순으로 정렬된다', () => {
  const findings = buildFindings({
    blog: { ...BLOG_OK, daysSinceLatest: 200, keywords: [{ keyword: '대구 성형외과', apiRank: null, docCount: 10 }] },
    site: { ...SITE_OK, https: 'fail', httpsNote: 'x' },
    ai: EMPTY_AI_AXIS,
    compliance: { ...EMPTY_COMPLIANCE_AXIS, checked: true, postsScanned: 10, hits: [{ postTitle: 't', postLink: 'l', phrase: '최고', note: 'n', level: 'review' }], postsWithHits: 1 },
  });
  const ranks = groupFindings(findings).bad.map((f) => FINDING_WEIGHT[f.id]?.rank ?? 900);
  assert.deepEqual([...ranks].sort((a, b) => a - b), ranks, `정렬이 깨졌다: ${ranks.join(',')}`);
  // 환자 이탈에 직접 영향하는 항목이 검색 노출 항목보다 앞이어야 한다
  assert.ok((FINDING_WEIGHT['site.https']?.rank ?? 0) < (FINDING_WEIGHT['blog.rank']?.rank ?? 0));
});

test('모든 카드 id 가 중요도 표에 등록돼 있다 (표 누락 방지)', () => {
  const findings = buildFindings({
    blog: BLOG_OK,
    site: SITE_OK,
    ai: { ...EMPTY_AI_AXIS, checked: true, recommendTotal: 2, recommendMentioned: 0, namedTotal: 1, namedMentioned: 1,
      probes: [{ question: 'q', kind: 'recommend', engine: 'openai', mentioned: false, path: 'none', evidence: null, ownedSources: [], thirdPartyHosts: [] }] },
    compliance: { ...EMPTY_COMPLIANCE_AXIS, checked: true, postsScanned: 3 },
  });
  for (const f of findings) {
    assert.ok(FINDING_WEIGHT[f.id], `${f.id} 가 FINDING_WEIGHT 에 없다 — 정렬이 맨 뒤로 밀린다`);
  }
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

/**
 * ★ 실측 사고 회귀 방지.
 * 하이업성형외과 진단에서 "질문 6개 중 2개(33%) 등장 → 잘하고 있어요"가 나갔는데,
 * 그 2개는 전부 병원 이름을 넣은 질의였고 추천 질의 4개는 전부 미등장이었다.
 */
test('이름을 넣은 질의만 나온 상태를 절대 "잘하고 있어요"로 판정하지 않는다', () => {
  const findings = buildAiFindings(
    aiAxis({
      probes: [
        { question: '대구 수성구 성형외과 추천해줘', kind: 'recommend', engine: 'openai', mentioned: false, path: 'none', evidence: null, ownedSources: [], thirdPartyHosts: [] },
        { question: '대구 수성구 성형외과 추천해줘', kind: 'recommend', engine: 'perplexity', mentioned: false, path: 'none', evidence: null, ownedSources: [], thirdPartyHosts: [] },
        { question: '대구 수성구 성형외과 중에 잘하는 곳 세 군데만 알려줘', kind: 'recommend', engine: 'openai', mentioned: false, path: 'none', evidence: null, ownedSources: [], thirdPartyHosts: [] },
        { question: '대구 수성구 성형외과 중에 잘하는 곳 세 군데만 알려줘', kind: 'recommend', engine: 'perplexity', mentioned: false, path: 'none', evidence: null, ownedSources: [], thirdPartyHosts: [] },
        { question: '대구 수성구 하이업성형외과의원 어떤 병원이야?', kind: 'named', engine: 'openai', mentioned: true, path: 'directory', evidence: 'e', ownedSources: [], thirdPartyHosts: ['goodoc.co.kr'] },
      ],
      mentionedCount: 1, directoryCount: 1,
      recommendTotal: 4, recommendMentioned: 0, namedTotal: 1, namedMentioned: 1,
    }),
    true,
  );

  const presence = findings.find((f) => f.id === 'ai.presence');
  assert.equal(presence?.tone, 'warn', '추천 질의 전패인데 good 이 나오면 결론이 뒤집힌다');
  assert.match(presence?.state ?? '', /이름 없이/);
  assert.match(presence?.state ?? '', /4번 모두 나오지 않았습니다/);

  // 이름 질의는 배경 사실로만 — 성과로 포장하지 않는다
  const known = findings.find((f) => f.id === 'ai.known');
  assert.equal(known?.tone, 'good');
  assert.match(known?.action ?? '', /기본입니다/);
  assert.equal(known?.ourScope, false);
});

test('이름을 넣었는데도 AI가 모르면 심각한 문제로 올린다', () => {
  const findings = buildAiFindings(
    aiAxis({
      probes: [
        { question: 'r', kind: 'recommend', engine: 'openai', mentioned: false, path: 'none', evidence: null, ownedSources: [], thirdPartyHosts: [] },
        { question: 'n', kind: 'named', engine: 'openai', mentioned: false, path: 'none', evidence: null, ownedSources: [], thirdPartyHosts: [] },
      ],
      recommendTotal: 1, recommendMentioned: 0, namedTotal: 1, namedMentioned: 0,
    }),
    false,
  );
  const known = findings.find((f) => f.id === 'ai.known');
  assert.equal(known?.tone, 'warn');
  assert.match(known?.why ?? '', /병원 존재 자체를 모르는/);
});

test('추천 질의에서 실제로 나오면 그때 칭찬한다', () => {
  const findings = buildAiFindings(
    aiAxis({
      probes: [{ question: 'r', kind: 'recommend', engine: 'openai', mentioned: true, path: 'owned', evidence: 'e', ownedSources: ['https://blog.naver.com/vbps_official/1'], thirdPartyHosts: [] }],
      mentionedCount: 1, ownedCount: 1, recommendTotal: 2, recommendMentioned: 1,
    }),
    true,
  );
  assert.equal(findings.find((f) => f.id === 'ai.presence')?.tone, 'good');
});

test('AI가 언급했지만 근거가 전부 디렉터리면 그 사실을 정면으로 말한다', () => {
  const findings = buildAiFindings(
    aiAxis({
      probes: [
        { question: 'q1', kind: 'recommend', engine: 'openai', mentioned: true, path: 'directory', evidence: 'e', ownedSources: [], thirdPartyHosts: ['goodoc.co.kr'] },
        { question: 'q2', kind: 'recommend', engine: 'openai', mentioned: true, path: 'directory', evidence: 'e', ownedSources: [], thirdPartyHosts: ['modoodoc.com'] },
      ],
      mentionedCount: 2, directoryCount: 2, ownedCount: 0, recommendTotal: 2, recommendMentioned: 2,
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
      probes: [{ question: 'q', kind: 'recommend', engine: 'openai', mentioned: true, path: 'owned', evidence: 'e', ownedSources: ['https://blog.naver.com/vbps_official/1'], thirdPartyHosts: [] }],
      mentionedCount: 1, ownedCount: 1, recommendTotal: 1, recommendMentioned: 1,
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

test('홈페이지 카드는 HTTPS 하나 + 통합 항목 하나, 총 2개로만 나간다', () => {
  const findings = buildSiteFindings(SITE_OK);
  assert.deepEqual(ids(findings), ['site.https', 'site.readable']);
});

test('기본 화면 문구에 기술 용어를 노출하지 않는다 (원장이 모르는 말)', () => {
  const findings = buildSiteFindings({ ...SITE_OK, jsonLd: 'fail', jsonLdTypes: [], sitemapXml: 'fail', viewport: 'fail' });
  const jargon = ['JSON-LD', 'robots.txt', 'sitemap', 'MedicalClinic', 'viewport', 'meta description', 'OG'];
  for (const f of findings) {
    const surface = `${f.label} ${f.state} ${f.why ?? ''} ${f.action}`;
    for (const word of jargon) {
      assert.ok(!surface.includes(word), `${f.id} 기본 문구에 "${word}" 가 노출됐다`);
    }
  }
});

test('통합 항목은 "몇 개 갖춰지고 몇 개 빠졌는지"까지만 말하고 세부는 접어 둔다', () => {
  const findings = buildSiteFindings({ ...SITE_OK, jsonLd: 'fail', jsonLdTypes: [], sitemapXml: 'fail' });
  const card = findings.find((f) => f.id === 'site.readable');
  assert.equal(card?.tone, 'warn');
  assert.match(card?.state ?? '', /\d+가지 중 \d+가지는 갖춰져 있고 \d+가지가 빠져 있습니다/);
  // 세부는 details 안에만 존재한다
  assert.ok((card?.details?.length ?? 0) >= 5);
  assert.ok(card?.details?.some((d) => d.ok === false));
  assert.equal(card?.ourScope, false, '홈페이지는 우리 제품 밖 영역이어야 한다');
});

test('전부 갖춰졌으면 통합 항목도 칭찬한다', () => {
  const card = buildSiteFindings(SITE_OK).find((f) => f.id === 'site.readable');
  assert.equal(card?.tone, 'good');
  assert.equal(card?.why, null);
});

test('AI 크롤러 차단은 세부 항목으로만 표시하고 단정하지 않는다', () => {
  const card = buildSiteFindings({ ...SITE_OK, aiCrawler: 'blocked', blockedAiBots: ['GPTBot', 'ClaudeBot'] })
    .find((f) => f.id === 'site.readable');
  const detail = card?.details?.find((d) => d.label.includes('AI 검색 접근'));
  assert.equal(detail?.ok, false);
});

test('병원용 스키마가 아니면 세부 항목에서 빠진 것으로 잡힌다', () => {
  const card = buildSiteFindings({ ...SITE_OK, jsonLd: 'pass', jsonLdTypes: ['WebSite', 'Organization'] })
    .find((f) => f.id === 'site.readable');
  const detail = card?.details?.find((d) => d.label.includes('병원 정보'));
  assert.equal(detail?.ok, false);
  assert.equal(card?.tone, 'warn');
});

/* ── 주소는 눌러서 열려야 한다 ──────────────────────────── */

test('홈페이지 주소는 클릭 가능한 링크로 나간다', () => {
  const card = buildSiteFindings(SITE_OK).find((f) => f.id === 'site.https');
  assert.equal(card?.link?.href, 'https://vb.vbeauty.co.kr/');
  assert.equal(card?.link?.insecure, false);
});

test('HTTPS 가 안 되면 실제 응답한 http 주소로 연결하고 그 사실을 표시한다', () => {
  const card = buildSiteFindings({
    ...SITE_OK, https: 'fail', httpsNote: '인증서 문제', finalUrl: 'http://vb.vbeauty.co.kr/',
  }).find((f) => f.id === 'site.https');
  assert.equal(card?.link?.href, 'http://vb.vbeauty.co.kr/');
  assert.equal(card?.link?.insecure, true);
});

test('블로그 주소도 눌러서 열 수 있다', () => {
  const card = buildFindings({ blog: BLOG_OK, site: EMPTY_SITE_AXIS, ai: EMPTY_AI_AXIS, compliance: EMPTY_COMPLIANCE_AXIS })
    .find((f) => f.id === 'blog.exists');
  assert.equal(card?.link?.href, 'https://blog.naver.com/vbps_official');
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
