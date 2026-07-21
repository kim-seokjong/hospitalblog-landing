import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runBlogCheck,
  parseFeedbackJson,
  pickSeedKeyword,
  toSimpleResult,
  buildQualityDiagnosis,
  wrapUntrusted,
  type BlogCheckReport,
  type BlogCheckLlmCreate,
} from '../blog-check.ts';
import type { TitleQualityStats } from '../blog-check-score.ts';

// ── parseFeedbackJson ──
test('parseFeedbackJson: 코드펜스 섞인 JSON 파싱, 최소 2+2 미달 시 null', () => {
  const ok = parseFeedbackJson(
    '```json\n{"strengths":["장점 하나입니다","장점 둘입니다"],"weaknesses":["부족한 점 하나","부족한 점 둘","심화 지적"]}\n```',
  );
  assert.ok(ok);
  assert.equal(ok?.strengths.length, 2);
  assert.equal(ok?.weaknesses.length, 3);

  assert.equal(parseFeedbackJson('{"strengths":["하나뿐입니다"],"weaknesses":[]}'), null);
  assert.equal(parseFeedbackJson('JSON 아님'), null);
  assert.equal(parseFeedbackJson(''), null);
});

// ── pickSeedKeyword ──
test('pickSeedKeyword: 지역 결합 후보 우선, 없으면 첫 후보, 빈 목록은 null', () => {
  assert.deepEqual(
    pickSeedKeyword([
      { keyword: '보톡스', base: '보톡스', region: '', count: 5 },
      { keyword: '강남 필러', base: '필러', region: '강남', count: 2 },
    ]),
    { base: '필러', region: '강남' },
  );
  assert.deepEqual(
    pickSeedKeyword([{ keyword: '보톡스', base: '보톡스', region: '', count: 5 }]),
    { base: '보톡스', region: '' },
  );
  assert.equal(pickSeedKeyword([]), null);
});

// ── runBlogCheck 통합 (fetch·LLM 전부 모킹/미설정) ──
const RSS = `<rss><channel><title>수성구정형외과 블로그</title>
${Array.from({ length: 10 }, (_, i) => {
  const day = String(2 + i).padStart(2, '0');
  return `<item><title>수성구 도수치료 안내 ${i}회차 — 100% 완치 보장</title>
<link>https://blog.naver.com/testclinic/22399${i}000</link>
<pubDate>Mon, ${day} Jul 2026 09:00:00 +0900</pubDate>
<category>도수치료</category></item>`;
}).join('\n')}
</channel></rss>`;

const mockFetch: typeof fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.startsWith('https://rss.blog.naver.com/testclinic.xml')) {
    return new Response(RSS, { status: 200 });
  }
  if (url.startsWith('https://m.blog.naver.com/testclinic/')) {
    const html = `<div class="se-main-container"><p>${'도수치료는 개인차가 있습니다. '.repeat(10)}</p></div></div>`;
    return new Response(html, { status: 200 });
  }
  throw new Error(`unexpected fetch: ${url}`);
}) as typeof fetch;

test('runBlogCheck: 외부 API 키 전무 환경에서도 그레이스풀 완주', async () => {
  const result = await runBlogCheck('testclinic', {
    env: {} as NodeJS.ProcessEnv, // 검색광고·오픈API·ANTHROPIC 전부 없음
    fetchImpl: mockFetch,
    now: Date.parse('2026-07-20T00:00:00Z'),
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  const r = result.report;

  assert.equal(r.blogId, 'testclinic');
  assert.equal(r.blogTitle, '수성구정형외과 블로그');
  assert.equal(r.totalPosts, 10);
  assert.equal(r.volumesAvailable, false);
  assert.equal(r.serpAvailable, false);
  assert.equal(r.feedbackSource, 'rule'); // LLM 키 없음 → 폴백
  // 키워드 추출 — "수성구 도수치료"
  assert.ok(r.keywords.some((m) => m.keyword === '수성구 도수치료'));
  assert.deepEqual(r.seedKeyword, { base: '도수치료', region: '수성구' });
  // 컴플라이언스 — "100%"·"완치"·"보장" 검출 (제목마다)
  assert.ok(r.compliance.count > 0);
  assert.ok(r.compliancePosts.length > 0);
  assert.ok(r.compliancePosts[0].violations.some((v) => v.word === '완치'));
  // GEO 는 5~10 고정
  assert.ok(r.geo.score >= 5 && r.geo.score <= 10);
  // 장단점 최소 보장
  assert.ok(r.feedback.strengths.length >= 2);
  assert.ok(r.feedback.weaknesses.length >= 2);
});

test('runBlogCheck: RSS 실패 → not_found', async () => {
  const result = await runBlogCheck('noexist1', {
    env: {} as NodeJS.ProcessEnv,
    fetchImpl: (async () => new Response('nf', { status: 404 })) as typeof fetch,
  });
  assert.deepEqual(result, { ok: false, reason: 'not_found' });
});

// ── buildQualityDiagnosis: AbortSignal 전달 + 신뢰 경계 ──
const EMPTY_STATS: TitleQualityStats = {
  pairsChecked: 10,
  duplicatePairs: 2,
  maxSimilarity: 0.8,
  samples: [],
};

test('buildQualityDiagnosis: 실요청에 AbortSignal 전달 + <외부자료> 신뢰 경계 포함', async () => {
  let captured: {
    system?: string;
    content?: string;
    signal?: AbortSignal;
  } = {};
  const createMessage: BlogCheckLlmCreate = async (params, options) => {
    captured = {
      system: params.system,
      content: params.messages[0]?.content,
      signal: options?.signal,
    };
    return { content: [{ type: 'text', text: '제목 틀이 반복되고 있어요. 구조를 다양화해 보세요. 키워드도 조정이 필요해요.' }] };
  };

  const out = await buildQualityDiagnosis(EMPTY_STATS, ['제목 A', '제목 B'], {
    env: { ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv,
    createMessage,
  });
  assert.equal(out.source, 'llm');
  assert.ok(captured.signal instanceof AbortSignal); // 타임아웃 시 실요청 중단 가능
  assert.ok(captured.system?.includes('신뢰 경계'));
  assert.ok(captured.content?.includes('<외부자료>'));
  assert.ok(captured.content?.includes('</외부자료>'));
});

test('buildQualityDiagnosis: 키 없음/호출 실패 → 규칙 폴백 (never throws)', async () => {
  const noKey = await buildQualityDiagnosis(EMPTY_STATS, [], { env: {} as NodeJS.ProcessEnv });
  assert.equal(noKey.source, 'rule');
  assert.ok(noKey.comment.length > 0);

  const failed = await buildQualityDiagnosis(EMPTY_STATS, [], {
    env: { ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv,
    createMessage: async () => {
      throw new Error('down');
    },
  });
  assert.equal(failed.source, 'rule');
});

test('wrapUntrusted: 구분자 래핑', () => {
  assert.equal(wrapUntrusted('본문'), '<외부자료>\n본문\n</외부자료>');
});

// ── 장단점 LLM 경로: 신뢰 경계 + AbortSignal (runBlogCheck 주입 경유) ──
test('runBlogCheck: 장단점 LLM 콜에 신뢰 경계·AbortSignal 적용', async () => {
  let feedbackCall: { system?: string; content?: string; signal?: AbortSignal } | null = null;
  const createMessage: BlogCheckLlmCreate = async (params, options) => {
    if (params.system.includes('진단 코치')) {
      feedbackCall = {
        system: params.system,
        content: params.messages[0]?.content,
        signal: options?.signal,
      };
      return {
        content: [
          {
            type: 'text',
            text: '{"strengths":["장점 하나입니다","장점 둘입니다"],"weaknesses":["부족한 점 하나","부족한 점 둘","심화 지적입니다"]}',
          },
        ],
      };
    }
    // 키워드 폴백 콜 — 신뢰 경계 확인 후 빈 응답(규칙 결과 유지)
    assert.ok(params.system.includes('신뢰 경계'));
    assert.ok(params.messages[0]?.content.includes('<외부자료>'));
    return { content: [{ type: 'text', text: '[]' }] };
  };

  const result = await runBlogCheck('testclinic', {
    env: { ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv,
    fetchImpl: mockFetch,
    createMessage,
    now: Date.parse('2026-07-20T00:00:00Z'),
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.report.feedbackSource, 'llm');
  assert.ok(feedbackCall);
  const call = feedbackCall as { system?: string; content?: string; signal?: AbortSignal };
  assert.ok(call.signal instanceof AbortSignal);
  assert.ok(call.system?.includes('신뢰 경계'));
  assert.ok(call.content?.includes('<외부자료>'));
});

// ── toSimpleResult ──
test('toSimpleResult: 심화 지적 본문은 제거하고 티저만 남긴다', async () => {
  const run = await runBlogCheck('testclinic', {
    env: {} as NodeJS.ProcessEnv,
    fetchImpl: mockFetch,
    now: Date.parse('2026-07-20T00:00:00Z'),
  });
  assert.ok(run.ok);
  if (!run.ok) return;
  const report: BlogCheckReport = run.report;

  const simple = toSimpleResult(report);
  const lockedFull = report.feedback.weaknesses[report.feedback.weaknesses.length - 1];

  assert.equal(simple.weaknesses.length, report.feedback.weaknesses.length - 1);
  assert.ok(!simple.weaknesses.includes(lockedFull));
  assert.ok(simple.lockedWeakness);
  assert.ok(simple.lockedWeakness!.teaser.length <= 13); // 12자 + …
  assert.ok(lockedFull.startsWith(simple.lockedWeakness!.teaser.slice(0, -1)));
  // 상세 전용 필드는 간단 응답에 없다
  assert.ok(!('compliancePosts' in simple));
  assert.ok(simple.keywordPreview.length <= 3);
});
