import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FINDING_GROUP_LABEL,
  FINDING_WEIGHT,
  RANK_CAVEAT,
  buildAiFindings,
  buildBlogFindings,
  buildComplianceFindings,
  buildFindings,
  buildPostSeoFindings,
  buildSiteFindings,
  channelBadges,
  channelStatusText,
  collectUnchecked,
  findingGroupOf,
  groupFindings,
  groupFindingsByChannel,
  normalizeStoredFindings,
  summarizeFindings,
} from '../findings.ts';
import { LEGACY_COMPLIANCE_RISK_ID } from '../findings.ts';
import type { ChannelSection } from '../findings.ts';
import { EMPTY_SITE_AXIS } from '../site-audit.ts';
import { EMPTY_AI_AXIS, summarizeProbes } from '../ai-citation.ts';
import { EMPTY_COMPLIANCE_AXIS } from '../compliance-scan.ts';
import type { PostSeoResult } from '../post-seo.ts';
import type {
  AiAxis,
  BlogAxis,
  CitationPath,
  CitationProbe,
  ComplianceAxis,
  Finding,
  SiteAxis,
} from '../types.ts';

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
  postSeo: null,
};

/** 최근 글 SEO 점검 결과 — ok 값만 바꿔 가며 카드 문구를 검증한다. */
function postSeo(over: Partial<PostSeoResult> = {}): PostSeoResult {
  const check = (id: string, ok: boolean | null): PostSeoResult['checks'][number] => ({
    id: id as PostSeoResult['checks'][number]['id'],
    label: id,
    hint: '설명',
    ok,
    detail: '최근 5편 중 3편 충족',
  });
  const checks = [check('titleLength', true), check('bodyLength', false), check('image', true)];
  return {
    checked: true,
    postsAnalyzed: 5,
    fullBodies: 2,
    summaryOnly: 3,
    checks,
    readyCount: checks.filter((c) => c.ok === true).length,
    missingCount: checks.filter((c) => c.ok === false).length,
    unknownCount: checks.filter((c) => c.ok === null).length,
    ...over,
  };
}

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

test('덩어리 이름은 사람을 흉보는 말이 아니라 할 일로 쓴다', () => {
  assert.equal(FINDING_GROUP_LABEL.bad.title, '지금 고쳐야 할 것');
  assert.equal(FINDING_GROUP_LABEL.improve.title, '챙기면 좋을 것');
  assert.equal(FINDING_GROUP_LABEL.good.title, '잘하고 있는 것');
  assert.equal(FINDING_GROUP_LABEL.unknown.title, '확인하지 못한 것');
  for (const group of ['bad', 'improve', 'good', 'unknown'] as const) {
    assert.ok(FINDING_GROUP_LABEL[group].subtitle.trim().length > 0, `${group}: 부제가 비었다`);
    for (const forbidden of ['못된', '잘된', '개선할 점']) {
      assert.ok(!FINDING_GROUP_LABEL[group].title.includes(forbidden), `${group}: 옛 문구가 남아 있다`);
    }
  }
});

test('groupFindings 는 지금 고쳐야 할 것 / 챙기면 좋을 것 / 잘하고 있는 것 / 미확인으로 나눈다', () => {
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

/**
 * ★ 중복 제거 회귀 방지 (대표 지적 2026-07-27).
 *   결과 화면 맨 위 "진단한 블로그" 블록이 주소·수집 편수·바꾸는 법을 이미 말한다.
 *   같은 말을 카드로 또 하면 "잘하고 있는 것" 개수만 부풀고 원장은 같은 말을 두 번 읽는다.
 */
test('블로그가 특정됐으면 같은 말을 카드로 반복하지 않는다 (상단 블록과 중복)', () => {
  const guess = { blogId: 'night140160', bloggerName: '리팅 이야기', hits: 3, nameInBloggerName: false, titleMentions: 3, confidence: 62 };
  const cards = buildBlogFindings({
    ...BLOG_OK,
    blogId: 'night140160',
    resolution: { kind: 'assumed', guess, guesses: [guess], close: true },
  });
  assert.ok(!ids(cards).includes('blog.exists'), '상단 블록이 말하는 내용을 카드로 또 내면 중복이다');
  // 나머지 블로그 항목은 그대로 나온다 — 중복만 지운 것이지 축을 지운 게 아니다
  assert.ok(ids(cards).includes('blog.freshness'));
});

test('블로그를 특정하지 못한 예외 상황에서는 카드가 남는다 (상단 블록이 안 나오는 경우)', () => {
  const guess = { blogId: 'night140160', bloggerName: '리팅 이야기', hits: 3, nameInBloggerName: false, titleMentions: 3, confidence: 62 };
  const card = buildBlogFindings({
    ...BLOG_OK,
    blogId: null,
    resolution: { kind: 'assumed', guess, guesses: [guess], close: true },
  })[0];
  assert.equal(card.id, 'blog.exists');
  assert.match(card.state, /이 블로그를 병원 블로그로 보고 진단했습니다/);
  assert.match(card.state, /비슷한 후보가 하나 더 있었어요/);
  assert.match(card.action, /진단 페이지에서 주소를 직접 넣어 다시 진단할 수 있어요/);
  // ⚠️ 저장돼 공유 화면에서도 그대로 나오는 문구다 — 화면 위치("아래")를 가리키면 안 된다.
  //    공유 화면에는 후보 선택기도 상세 진단 폼도 없다.
  assert.ok(!/아래/.test(card.action), '공유 화면에 없는 UI 를 가리키면 안 된다');
  assert.equal(card.link?.href, 'https://blog.naver.com/night140160');
});

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

/**
 * 프로브(엔진 호출)에서 축을 만든다 — 집계까지 실제 함수를 통과시킨다.
 * 카운트를 손으로 적어 넣으면 집계 버그가 테스트를 통과해 버린다(실측 오판이 그랬다).
 */
function aiAxis(probes: readonly CitationProbe[]): AiAxis {
  return { ...EMPTY_AI_AXIS, checked: true, probes, ...summarizeProbes(probes) };
}

function p(
  question: string,
  kind: CitationProbe['kind'],
  engine: string,
  mentioned: boolean,
  path: CitationPath = mentioned ? 'directory' : 'none',
  thirdPartyHosts: readonly string[] = mentioned && path === 'directory' ? ['goodoc.co.kr'] : [],
): CitationProbe {
  return {
    question,
    kind,
    engine,
    mentioned,
    path,
    evidence: mentioned ? '…추천 목록…' : null,
    ownedSources: path === 'owned' ? ['https://blog.naver.com/vbps_official/1'] : [],
    thirdPartyHosts,
  };
}

/* 브이성형외과 실측 질의 3종 — 문구 검증에 원문을 그대로 쓴다. */
const Q1 = '대구 중구 성형외과 추천해줘';
const Q2 = '대구 중구 성형외과 중에 잘하는 곳 세 군데만 알려줘';
const Q3 = '대구 중구에서 성형외과 어디로 가는 게 좋을까?';

/**
 * ★ 실측 사고 회귀 방지.
 * 하이업성형외과 진단에서 "질문 6개 중 2개(33%) 등장 → 잘하고 있어요"가 나갔는데,
 * 그 2개는 전부 병원 이름을 넣은 질의였고 추천 질의 4개는 전부 미등장이었다.
 */
test('이름을 넣은 질의만 나온 상태를 절대 "잘하고 있어요"로 판정하지 않는다', () => {
  const findings = buildAiFindings(
    aiAxis([
      p(Q1, 'recommend', 'openai', false),
      p(Q1, 'recommend', 'perplexity', false),
      p(Q2, 'recommend', 'openai', false),
      p(Q2, 'recommend', 'perplexity', false),
      p('대구 수성구 하이업성형외과의원 어떤 병원이야?', 'named', 'openai', true),
    ]),
    true,
  );

  const presence = findings.find((f) => f.id === 'ai.presence');
  assert.equal(presence?.tone, 'warn', '추천 질의 전패인데 good 이 나오면 결론이 뒤집힌다');
  assert.match(presence?.state ?? '', /이름 없이/);
  assert.match(presence?.state ?? '', /두 가지 질문 어느 것에서도 병원이 나오지 않았습니다/);
  assert.ok(!/\d+번/.test(presence?.state ?? ''), '엔진 호출 수를 분모로 다시 쓰면 안 된다');
  // 전무는 "못된 점" 대역
  assert.equal(FINDING_WEIGHT['ai.presence'].severity, 'losing');

  // 이름 질의는 배경 사실로만 — 성과로 포장하지 않는다
  const known = findings.find((f) => f.id === 'ai.known');
  assert.equal(known?.tone, 'good');
  assert.match(known?.action ?? '', /기본입니다/);
  assert.equal(known?.ourScope, false);
});

test('이름을 넣었는데도 AI가 모르면 심각한 문제로 올린다', () => {
  const findings = buildAiFindings(
    aiAxis([p(Q1, 'recommend', 'openai', false), p('n', 'named', 'openai', false)]),
    false,
  );
  const known = findings.find((f) => f.id === 'ai.known');
  assert.equal(known?.tone, 'warn');
  assert.match(known?.why ?? '', /병원 존재 자체를 모르는/);
});

/* ── ★ 질문 단위 집계 (브이성형외과 오판 회귀 방지) ──────── */

test('일부 질문에서만 나오면 "잘된 점"이 아니라 "개선할 점"이다 (브이성형외과 실측)', () => {
  // 질문 3개 × 엔진 2곳 = 프로브 6건. 엔진 호출을 분모로 쓰면 "6번 중 3번"이 되지만,
  // 질문 단위로 보면 Q3 은 두 엔진 모두에서 미등장이다.
  const axis = aiAxis([
    p(Q1, 'recommend', 'openai', true),
    p(Q1, 'recommend', 'perplexity', false),
    p(Q2, 'recommend', 'openai', true),
    p(Q2, 'recommend', 'perplexity', true),
    p(Q3, 'recommend', 'openai', false),
    p(Q3, 'recommend', 'perplexity', false),
  ]);
  assert.equal(axis.recommendQuestionTotal, 3);
  assert.equal(axis.recommendQuestionMentioned, 2);
  assert.equal(axis.recommendQuestionSplit, 1, 'Q1 은 한쪽 엔진에서만 나왔다');

  const findings = buildAiFindings(axis, true);
  const presence = findings.find((f) => f.id.startsWith('ai.presence'));
  assert.equal(presence?.id, 'ai.presence.partial');
  assert.equal(presence?.tone, 'warn', '한 질문에서 아예 안 나오는데 good 이면 안 된다');
  assert.equal(FINDING_WEIGHT['ai.presence.partial'].severity, 'improving', '전무가 아니므로 개선할 점 대역');

  // 안 나온 질문 원문을 그대로 인용한다 — 원장이 눈으로 확인할 수 있어야 한다
  assert.ok(presence?.state.includes(Q3), '미등장 질문 원문이 문구에 없다');
  assert.ok(!presence?.state.includes(Q2), '나온 질문까지 인용하면 초점이 흐려진다');
  // 백분율을 앞세우지 않는다 — 6분의 4 같은 숫자는 실제보다 좋게 들린다
  assert.ok(!/\d+%/.test(presence?.state ?? ''), '백분율이 다시 들어갔다');
  assert.match(presence?.state ?? '', /세 가지 질문 중 두 가지/);
  // 엔진 편차도 사실대로 드러낸다
  assert.match(presence?.state ?? '', /AI 서비스에 따라 나오기도 하고/);
  assert.match(presence?.why ?? '', /보이지 않습니다/);
  assert.equal(presence?.ourScope, true);

  // 질문별 등장 여부를 접어두기로 그대로 펼친다
  assert.equal(presence?.details?.length, 3);
  assert.equal(presence?.details?.find((d) => d.label === Q3)?.ok, false);
  assert.match(presence?.details?.find((d) => d.label === Q1)?.hint ?? '', /2곳 중 1곳/);
});

test('그룹 분류: 일부 등장은 개선할 점, 전무는 못된 점으로 간다', () => {
  const partial = groupFindings(
    buildAiFindings(
      aiAxis([
        p(Q1, 'recommend', 'openai', true),
        p(Q2, 'recommend', 'openai', false),
      ]),
      true,
    ),
  );
  assert.ok(partial.improve.some((f) => f.id === 'ai.presence.partial'));
  assert.equal(partial.bad.length, 0);

  const none = groupFindings(
    buildAiFindings(aiAxis([p(Q1, 'recommend', 'openai', false), p(Q2, 'recommend', 'openai', false)]), true),
  );
  assert.ok(none.bad.some((f) => f.id === 'ai.presence'));
});

test('모든 질문에서 나오면 그때 칭찬한다 (전부 빨간불로 만들지 않는다)', () => {
  const findings = buildAiFindings(
    aiAxis([
      p(Q1, 'recommend', 'openai', true, 'owned'),
      p(Q1, 'recommend', 'perplexity', true, 'owned'),
      p(Q2, 'recommend', 'openai', true, 'owned'),
      p(Q2, 'recommend', 'perplexity', true, 'owned'),
    ]),
    true,
  );
  const presence = findings.find((f) => f.id === 'ai.presence');
  assert.equal(presence?.tone, 'good');
  assert.match(presence?.state ?? '', /두 가지 질문 모두에서 병원이 추천에 올랐습니다/);
  assert.ok(!presence?.state.includes('AI 서비스에 따라'), '편차가 없으면 불필요한 단서를 달지 않는다');
});

test('질의가 하나뿐이어도 질문 단위로 판정한다', () => {
  const shown = buildAiFindings(aiAxis([p(Q1, 'recommend', 'openai', true, 'owned')]), true);
  assert.equal(shown.find((f) => f.id === 'ai.presence')?.tone, 'good');
  // "한 가지 질문 모두에서"는 어색하고 표본이 하나라는 사실도 흐린다
  assert.match(shown.find((f) => f.id === 'ai.presence')?.state ?? '', /물어본 질문에서 병원이 추천에 올랐습니다/);

  const missing = buildAiFindings(aiAxis([p(Q1, 'recommend', 'openai', false)]), true);
  const card = missing.find((f) => f.id === 'ai.presence');
  assert.equal(card?.tone, 'warn');
  assert.match(card?.details?.[0].hint ?? '', /이 표현으로 물었을 때/);
});

test('엔진 편차: 한쪽에서만 나와도 질문은 등장으로 보되 불안정하다고 적는다', () => {
  const findings = buildAiFindings(
    aiAxis([
      p(Q1, 'recommend', 'openai', true, 'owned'),
      p(Q1, 'recommend', 'perplexity', false),
    ]),
    true,
  );
  const presence = findings.find((f) => f.id === 'ai.presence');
  assert.equal(presence?.tone, 'good', '환자는 엔진을 가려 쓰지 않는다');
  assert.match(presence?.state ?? '', /안정적으로 자리 잡은 상태는 아니에요/);
});

test('AI가 언급했지만 근거가 전부 디렉터리면 그 사실을 정면으로 말한다', () => {
  const findings = buildAiFindings(
    aiAxis([p(Q1, 'recommend', 'openai', true), p(Q2, 'recommend', 'openai', true)]),
    true,
  );
  const path = findings.find((f) => f.id === 'ai.path');
  assert.equal(path?.tone, 'warn');
  assert.match(path?.state ?? '', /병원 블로그나 홈페이지가 근거로 잡힌 질문은 하나도 없습니다/);
  assert.equal(path?.ourScope, true);
});

test('자기 글이 근거인 질문이 일부뿐이면 칭찬하지 않는다 (ai.path 오판 회귀 방지)', () => {
  // 실측: 등장 3건 중 2건이 외부 디렉터리, 1건만 병원 자기 글이었는데 "잘된 점"이었다.
  const findings = buildAiFindings(
    aiAxis([
      p(Q1, 'recommend', 'openai', true, 'owned'),
      p(Q2, 'recommend', 'openai', true, 'directory'),
      p('대구 중구 브이성형외과의원 어떤 병원이야?', 'named', 'openai', true, 'directory'),
    ]),
    true,
  );
  const path = findings.find((f) => f.id === 'ai.path');
  assert.equal(path?.tone, 'warn', '자기 콘텐츠 비율이 낮은데 good 이면 실제보다 좋게 읽힌다');
  assert.match(path?.state ?? '', /세 가지 질문 중 한 가지만/);
  assert.equal(path?.ourScope, true);
});

test('자기 자산이 모든 질문의 근거면 칭찬하고 팔지 않는다', () => {
  const findings = buildAiFindings(aiAxis([p(Q1, 'recommend', 'openai', true, 'owned')]), true);
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

test('위험(명시적 금지 유형)이 하나라도 있으면 "지금 고쳐야 할 것"으로 올라간다', () => {
  const axis = complianceAxis({
    hits: [
      { postTitle: '글', postLink: 'l', phrase: '후기', note: 'n', level: 'caution', risk: 'prohibited', riskLabel: '환자 후기·치료경험담' },
      { postTitle: '글', postLink: 'l', phrase: '최신', note: 'n', level: 'caution', risk: 'caution' },
    ],
    postsWithHits: 1,
    prohibitedCount: 1,
    cautionCount: 1,
    postsWithProhibited: 1,
  });
  const card = buildComplianceFindings(axis)[0];
  assert.equal(card.id, 'compliance.prohibited');
  assert.equal(FINDING_WEIGHT['compliance.prohibited'].severity, 'losing');
  assert.match(card.state, /명시적으로 금지한 유형/);
  assert.match(card.state, /환자 후기·치료경험담/);
  assert.match(card.state, /문맥에 따라 갈리는 표현도 1건/);
  // 단정 금지 규칙은 그대로다
  for (const forbidden of ['위반입니다', '처분 대상', '불법', '고발']) {
    assert.ok(!`${card.state}${card.why}${card.action}`.includes(forbidden), `단정 표현 "${forbidden}" 이 들어갔다`);
  }
  assert.ok(groupFindings([card]).bad.includes(card));
});

test('주의만 있으면 "챙기면 좋을 것"으로 내려간다 (빨간색을 흔하게 만들지 않는다)', () => {
  const axis = complianceAxis({
    hits: [{ postTitle: '글', postLink: 'l', phrase: '최신', note: 'n', level: 'caution', risk: 'caution' }],
    postsWithHits: 1,
    prohibitedCount: 0,
    cautionCount: 1,
    postsWithProhibited: 0,
  });
  const card = buildComplianceFindings(axis)[0];
  assert.equal(card.id, 'compliance.risk');
  assert.equal(FINDING_WEIGHT['compliance.risk'].severity, 'improving');
  assert.match(card.state, /명시적으로 금지한 유형에 해당하는 표현은 없었어요/);
  assert.ok(groupFindings([card]).improve.includes(card));
});

test('risk 가 없던 시절 리포트는 위험으로 올리지 않는다 (구 공유 리포트 호환)', () => {
  const card = buildComplianceFindings(
    complianceAxis({
      hits: [{ postTitle: '글', postLink: 'l', phrase: '후기', note: 'n', level: 'review' }],
      postsWithHits: 1,
      prohibitedCount: undefined,
      cautionCount: undefined,
      postsWithProhibited: undefined,
    }),
  )[0];
  assert.equal(card.id, 'compliance.risk');
});

test('검출이 없으면 칭찬하되 검사 범위의 한계를 함께 밝힌다', () => {
  const findings = buildComplianceFindings(complianceAxis({ hits: [], postsWithHits: 0 }));
  assert.equal(findings[0].tone, 'good');
  // 전문까지 못 본 글이 남아 있으면 그 편수를 정확히 밝힌다
  assert.match(findings[0].action, /28편은 글 뒤쪽까지 열어보지 못했으니/);
});

test('검사 범위는 본문 전문·글 앞부분·제목만을 나눠 표시한다', () => {
  const findings = buildComplianceFindings(
    complianceAxis({ postsScanned: 10, bodiesScanned: 5, summariesScanned: 4, hits: [], postsWithHits: 0 }),
  );
  assert.match(findings[0].state, /본문 전문 5편/);
  assert.match(findings[0].state, /글 앞부분 4편/);
  assert.match(findings[0].state, /제목만 1편/);
});

test('모든 글의 본문 전문을 봤으면 "다 본 것은 아니다" 단서를 붙이지 않는다', () => {
  const findings = buildComplianceFindings(
    complianceAxis({ postsScanned: 3, bodiesScanned: 3, summariesScanned: 0, hits: [], postsWithHits: 0 }),
  );
  assert.equal(findings[0].tone, 'good');
  assert.ok(!/열어보지 못했/.test(findings[0].action), '전문을 다 본 경우엔 단서가 없어야 한다');
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

test('블로그 카드가 남는 경우에는 주소도 눌러서 열 수 있다', () => {
  const card = buildFindings({
    blog: { ...BLOG_OK, blogId: null },
    site: EMPTY_SITE_AXIS, ai: EMPTY_AI_AXIS, compliance: EMPTY_COMPLIANCE_AXIS,
  }).find((f) => f.id === 'blog.exists');
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

/* ── 채널(축) 묶기 — 화면의 1차 그룹 ─────────────────────── */

/** 채널별 [분류 개수] 를 한눈에 보기 위한 축약 — 실패 메시지가 읽히게. */
function channelShape(sections: readonly ChannelSection[]): string[] {
  return sections.map(
    (s) =>
      `${s.label}: ${(['bad', 'improve', 'good', 'unknown'] as const)
        .filter((g) => s.counts[g] > 0)
        .map((g) => `${g}${s.counts[g]}`)
        .join('·')}`,
  );
}

/**
 * ★ 프라이브성형외과 실측 재구성 (대표가 지적한 바로 그 화면).
 *   같은 채널 항목이 세 덩어리에 흩어져 "AI는 결국 되는 건가"를 알 수 없었다.
 */
const PRIVE = {
  blog: { ...BLOG_OK, postSeo: postSeo() },
  site: { ...SITE_OK, jsonLd: 'fail' as const, jsonLdTypes: [] },
  ai: aiAxis([
    p(Q1, 'recommend', 'openai', true),
    p(Q1, 'recommend', 'perplexity', true),
    p(Q2, 'recommend', 'openai', true),
    p(Q2, 'recommend', 'perplexity', true),
    p('대구 수성구 프라이브성형외과의원 어떤 병원이야?', 'named', 'openai', true),
  ]),
  compliance: complianceAxis({
    hits: [{ postTitle: '글', postLink: 'l', phrase: '후기', note: 'n', level: 'caution', risk: 'prohibited', riskLabel: '환자 후기·치료경험담' }],
    postsWithHits: 9,
    prohibitedCount: 11,
    cautionCount: 0,
    postsWithProhibited: 9,
  }),
};

test('채널이 1차 그룹이다 — 같은 채널 항목이 흩어지지 않는다 (프라이브 실측)', () => {
  const findings = buildFindings(PRIVE);
  const sections = groupFindingsByChannel(findings);

  // 누락·중복 없이 전부 채널에 담긴다
  assert.equal(sections.reduce((n, s) => n + s.findings.length, 0), findings.length);
  // AI 항목은 한 덩어리 안에 모여 있어야 한다 — 이게 이 개편의 전부다
  const ai = sections.find((s) => s.axis === 'ai');
  assert.deepEqual(ids(ai?.findings ?? []).sort(), ['ai.known', 'ai.path', 'ai.presence']);
  assert.deepEqual(
    channelShape(sections),
    ['의료광고법: bad1', '네이버 블로그: improve1·good3', 'AI 검색: improve1·good2', '홈페이지: improve1·good1'],
  );
});

test('채널 순서는 문제가 심한 채널이 위 (프라이브 실측)', () => {
  const sections = groupFindingsByChannel(buildFindings(PRIVE));
  assert.deepEqual(
    sections.map((s) => s.label),
    ['의료광고법', '네이버 블로그', 'AI 검색', '홈페이지'],
  );
  assert.equal(sections[0].worst, 'bad');
  // 순서 근거는 기존 중요도 표 그대로 — 새 기준을 만들지 않는다
  assert.equal(sections[0].worstRank, FINDING_WEIGHT['compliance.prohibited'].rank);
  assert.equal(sections[1].worstRank, FINDING_WEIGHT['blog.postSeo'].rank);
  assert.equal(sections[2].worstRank, FINDING_WEIGHT['ai.path'].rank);
});

test('나쁜 항목이 있는 채널은 rank 가 낮은 개선 채널보다 위 (브이성형외과 실측)', () => {
  // 홈페이지 접속 실패(bad·10) · 블로그 순위 전무(bad·24) vs 의료광고법 주의만(improve·21)
  const sections = groupFindingsByChannel(
    buildFindings({
      blog: { ...BLOG_OK, daysSinceLatest: 200, postsPerWeek: 0.2, keywords: [{ keyword: '대구 성형외과', apiRank: null, docCount: 10 }] },
      site: { ...SITE_OK, https: 'fail', httpsNote: '인증서 문제' },
      ai: aiAxis([
        p(Q1, 'recommend', 'openai', true),
        p(Q1, 'recommend', 'perplexity', false),
        p(Q2, 'recommend', 'openai', true),
        p(Q2, 'recommend', 'perplexity', true),
        p(Q3, 'recommend', 'openai', false),
        p(Q3, 'recommend', 'perplexity', false),
      ]),
      compliance: complianceAxis({
        hits: [{ postTitle: '글', postLink: 'l', phrase: '최신', note: 'n', level: 'caution', risk: 'caution' }],
        postsWithHits: 1,
        prohibitedCount: 0,
        cautionCount: 1,
        postsWithProhibited: 0,
      }),
    }),
  );
  assert.deepEqual(
    sections.map((s) => s.label),
    ['홈페이지', '네이버 블로그', '의료광고법', 'AI 검색'],
  );
});

test('채널 안 항목은 나쁜 것부터 — 심각도를 버리지 않는다', () => {
  const sections = groupFindingsByChannel(
    buildFindings({
      blog: { ...BLOG_OK, daysSinceLatest: 200, postSeo: postSeo(), keywords: [{ keyword: '대구 성형외과', apiRank: null, docCount: 10 }] },
      site: SITE_OK,
      ai: EMPTY_AI_AXIS,
      compliance: EMPTY_COMPLIANCE_AXIS,
    }),
  );
  const blog = sections.find((s) => s.axis === 'blog');
  // blog.rank(bad·24) → blog.freshness(bad·28) → blog.postSeo(improve·26) → blog.cadence(good)
  assert.deepEqual(ids(blog?.findings ?? []), ['blog.rank', 'blog.freshness', 'blog.postSeo', 'blog.cadence']);
});

test('확인하지 못한 항목은 해당 채널 안에 남고 맨 뒤로 간다 (따로 빼지 않는다)', () => {
  const sections = groupFindingsByChannel(
    buildFindings({
      blog: { ...BLOG_OK, rankChecked: false, keywords: [] },
      site: SITE_OK,
      ai: EMPTY_AI_AXIS,
      compliance: EMPTY_COMPLIANCE_AXIS,
    }),
  );
  const blog = sections.find((s) => s.axis === 'blog');
  assert.equal(blog?.findings.at(-1)?.id, 'blog.rank', '미확인 항목은 채널 맨 뒤');
  assert.equal(blog?.counts.unknown, 1);
  // 전부 미확인인 채널은 맨 아래로 (급한 일이 아니라 빈칸이다)
  assert.deepEqual(sections.map((s) => s.axis), ['site', 'blog', 'ai', 'compliance']);
  assert.ok(sections.slice(-2).every((s) => s.worst === 'unknown'));
});

test('상단 요약 4칸: 채널명 + 상태 (문제 건수 또는 양호 표시)', () => {
  const sections = groupFindingsByChannel(buildFindings(PRIVE));
  assert.deepEqual(
    sections.map((s) => `${s.label} — ${channelStatusText(s)}`),
    [
      '의료광고법 — 지금 고쳐야 할 것 1',
      '네이버 블로그 — 챙기면 좋을 것 1',
      'AI 검색 — 챙기면 좋을 것 1',
      '홈페이지 — 챙기면 좋을 것 1',
    ],
  );

  // 문제가 없는 채널은 건수 대신 양호 표시
  const clean = groupFindingsByChannel(buildFindings({ ...PRIVE, site: SITE_OK }));
  assert.equal(channelStatusText(clean.find((s) => s.axis === 'site')!), '잘하고 있어요');
  // 확인조차 못 한 채널
  const unchecked = groupFindingsByChannel(buildFindings({ ...PRIVE, ai: EMPTY_AI_AXIS }));
  assert.equal(channelStatusText(unchecked.find((s) => s.axis === 'ai')!), '확인하지 못했어요');
});

test('채널 배지 문구는 대표가 정한 덩어리 이름 그대로 쓴다 (줄여 쓰지 않는다)', () => {
  const sections = groupFindingsByChannel(buildFindings(PRIVE));
  assert.deepEqual(channelBadges(sections[0]).map((b) => b.text), ['지금 고쳐야 할 것 1']);
  assert.deepEqual(
    channelBadges(sections.find((s) => s.axis === 'ai')!).map((b) => b.text),
    ['챙기면 좋을 것 1', '잘하고 있는 것 2'],
  );
});

test('옛 공유 리포트도 그대로 채널에 담긴다 (폴백 유지)', () => {
  // 중복 제거 이전에 저장된 리포트에는 blog.exists(잘하고 있는 것) 카드가 들어 있다
  const legacy: Finding = {
    id: 'blog.exists',
    axis: 'blog',
    label: '병원 블로그',
    tone: 'good',
    state: '블로그를 확인했습니다.',
    why: null,
    action: '주소를 눌러 확인해 보세요.',
    ourScope: false,
  };
  const sections = groupFindingsByChannel([legacy, ...buildFindings(PRIVE)]);
  const blog = sections.find((s) => s.axis === 'blog');
  assert.ok(ids(blog?.findings ?? []).includes('blog.exists'));
  assert.equal(blog?.counts.good, 4);
});

/* ── 최근 글 SEO 카드 ───────────────────────────────────── */

test('최근 글 SEO 는 카드 한 장으로만 나가고 항목은 접어두기로 내린다', () => {
  const findings = buildPostSeoFindings(postSeo());
  assert.equal(findings.length, 1, '카드를 쪼개면 화면이 더 복잡해진다');
  assert.equal(findings[0].id, 'blog.postSeo');
  assert.equal(findings[0].axis, 'blog');
  assert.equal(findings[0].details?.length, 3);
});

test('빠진 항목이 있으면 살펴봐야 할 항목으로, 어디까지 봤는지 함께 밝힌다', () => {
  const card = buildPostSeoFindings(postSeo())[0];
  assert.equal(card.tone, 'warn');
  assert.match(card.state, /최근 글 5편/);
  assert.match(card.state, /본문 전문 2편/);
  assert.match(card.state, /앞부분까지 기준|글 앞부분까지/);
  assert.ok(card.why && card.why.length > 0);
});

test('다 갖춰져 있으면 그대로 칭찬한다 (전부 빨간불로 만들지 않는다)', () => {
  const checks = [
    { id: 'titleLength' as const, label: 'a', hint: 'h', ok: true, detail: 'd' },
    { id: 'image' as const, label: 'b', hint: 'h', ok: true, detail: 'd' },
  ];
  const card = buildPostSeoFindings(
    postSeo({ checks, readyCount: 2, missingCount: 0, unknownCount: 0, summaryOnly: 0, fullBodies: 5 }),
  )[0];
  assert.equal(card.tone, 'good');
  assert.equal(card.why, null);
  assert.equal(card.ourScope, false);
});

test('전부 판정 못 했으면 "확인하지 못했다"로 남긴다 (부족으로 몰지 않는다)', () => {
  const checks = [
    { id: 'bodyLength' as const, label: 'a', hint: 'h', ok: null, detail: 'd' },
    { id: 'subheading' as const, label: 'b', hint: 'h', ok: null, detail: 'd' },
  ];
  const card = buildPostSeoFindings(
    postSeo({ checks, readyCount: 0, missingCount: 0, unknownCount: 2, fullBodies: 0, summaryOnly: 5 }),
  )[0];
  assert.equal(card.tone, 'unknown');
});

test('점검 결과가 없으면 카드를 만들지 않는다 (빈 카드 금지)', () => {
  assert.deepEqual(buildPostSeoFindings(null), []);
  assert.deepEqual(buildPostSeoFindings(postSeo({ checked: false })), []);
  assert.deepEqual(buildPostSeoFindings(postSeo({ checks: [] })), []);
});

test('최근 글 SEO 는 블로그 축 카드에 편입된다', () => {
  const findings = buildBlogFindings({ ...BLOG_OK, postSeo: postSeo() });
  assert.ok(ids(findings).includes('blog.postSeo'));
});

test('최근 글 SEO 는 검색 노출 대역의 "개선할 점"으로 분류된다', () => {
  const weight = FINDING_WEIGHT['blog.postSeo'];
  assert.equal(weight.severity, 'improving');
  assert.ok(weight.rank >= 20 && weight.rank < 40, '검색 노출 대역(20~39)에 있어야 한다');

  const grouped = groupFindings(buildBlogFindings({ ...BLOG_OK, postSeo: postSeo() }));
  assert.ok(grouped.improve.some((f) => f.id === 'blog.postSeo'));
});

/* ── 저장된 옛 리포트 보정 ──────────────────────────────── */

/**
 * ★ 2026-07-27 주간 점검 지적.
 *   `compliance.risk` 의 등급이 losing/16 → improving 으로 바뀌었는데, **저장된 옛
 *   리포트는 전부 id 가 `compliance.risk` 이고 hits 에 risk 필드가 없다.** 그래서 같은
 *   공유 링크가 어제까지 "지금 고쳐야 할 것"이던 항목을 "챙기면 좋을 것"으로 내려 보였다.
 *   대표가 전화로 말한 등급과 원장이 보는 화면이 어긋난다.
 */
const LEGACY_COMPLIANCE_AXIS = {
  checked: true,
  postsScanned: 10,
  bodiesScanned: 2,
  summariesScanned: 8,
  postsWithHits: 3,
  // prohibitedCount 없음 = 위험/주의 2단 등급 이전에 저장된 리포트
  hits: [
    { postTitle: '글', postLink: 'https://blog.naver.com/x/1', phrase: '후기', note: 'n', level: 'review' as const },
  ],
} as ComplianceAxis;

const LEGACY_RISK_FINDING: Finding = {
  id: 'compliance.risk',
  axis: 'compliance',
  label: '의료광고법 표현',
  tone: 'warn',
  state: '표현이 3건 확인됐습니다.',
  why: 'w',
  action: 'a',
  ourScope: true,
};

test('옛 리포트의 의료광고법 항목은 그때 등급("지금 고쳐야 할 것")으로 읽는다', () => {
  const findings = normalizeStoredFindings({
    blog: { blogId: null },
    compliance: LEGACY_COMPLIANCE_AXIS,
    findings: [LEGACY_RISK_FINDING],
  });
  assert.equal(findings[0].id, LEGACY_COMPLIANCE_RISK_ID);
  assert.equal(findingGroupOf(findings[0]), 'bad', '조용히 한 단계 내려가면 안 된다');
  assert.equal(FINDING_WEIGHT[LEGACY_COMPLIANCE_RISK_ID].severity, 'losing');
  assert.equal(FINDING_WEIGHT[LEGACY_COMPLIANCE_RISK_ID].rank, 16);
});

test('오늘 만들어진 리포트는 손대지 않는다 (주의만 나온 상태는 "챙기면 좋을 것")', () => {
  const findings = normalizeStoredFindings({
    blog: { blogId: null },
    compliance: { ...LEGACY_COMPLIANCE_AXIS, prohibitedCount: 0, cautionCount: 1, postsWithProhibited: 0 },
    findings: [LEGACY_RISK_FINDING],
  });
  assert.equal(findings[0].id, 'compliance.risk');
  assert.equal(findingGroupOf(findings[0]), 'improve');
});

test('미확인·양호 상태의 의료광고법 항목은 등급을 올리지 않는다', () => {
  const unknown: Finding = { ...LEGACY_RISK_FINDING, tone: 'unknown' };
  const good: Finding = { ...LEGACY_RISK_FINDING, tone: 'good' };
  const findings = normalizeStoredFindings({
    blog: { blogId: null },
    compliance: LEGACY_COMPLIANCE_AXIS,
    findings: [unknown, good],
  });
  assert.deepEqual(findings.map((f) => f.id), ['compliance.risk', 'compliance.risk']);
});

/**
 * ★ 옛 리포트에는 "진단한 블로그" 블록과 같은 말을 하는 blog.exists 카드가 남아 있어
 *   "잘하고 있는 것" 개수가 1 부풀어 보였다 — 오늘 리포트와 배지 숫자가 비교 불가능해진다.
 */
test('블로그가 특정된 옛 리포트의 중복 blog.exists 카드는 읽을 때 뺀다', () => {
  const duplicate: Finding = {
    id: 'blog.exists', axis: 'blog', label: '병원 블로그', tone: 'good',
    state: '블로그를 확인했습니다.', why: null, action: 'a', ourScope: false,
  };
  const keep: Finding = {
    id: 'blog.freshness', axis: 'blog', label: '최근 발행', tone: 'good',
    state: 's', why: null, action: 'a', ourScope: false,
  };
  const findings = normalizeStoredFindings({
    blog: { blogId: 'newprive' },
    compliance: LEGACY_COMPLIANCE_AXIS,
    findings: [duplicate, keep],
  });
  assert.deepEqual(findings.map((f) => f.id), ['blog.freshness']);

  // 블로그를 특정하지 못해 상단 블록이 안 나오는 리포트에서는 그대로 남긴다.
  const kept = normalizeStoredFindings({
    blog: { blogId: null },
    compliance: LEGACY_COMPLIANCE_AXIS,
    findings: [duplicate, keep],
  });
  assert.deepEqual(kept.map((f) => f.id), ['blog.exists', 'blog.freshness']);
});

test('findings 가 배열이 아니어도 죽지 않는다 (깨진 옛 리포트)', () => {
  assert.deepEqual(
    normalizeStoredFindings({
      blog: { blogId: null },
      compliance: LEGACY_COMPLIANCE_AXIS,
      findings: undefined as unknown as readonly Finding[],
    }),
    [],
  );
  const grouped = groupFindings(undefined as unknown as readonly Finding[]);
  assert.deepEqual(grouped.bad, []);
  assert.deepEqual(groupFindingsByChannel(undefined as unknown as readonly Finding[]), []);
});
