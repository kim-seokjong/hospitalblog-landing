import test from 'node:test';
import assert from 'node:assert/strict';
import {
  median,
  computeAuthorityWeight,
  rankPostsByAuthority,
  parsePostBodyMetrics,
  aggregateMeasured,
  competitionLevelFromTotal,
  estimateBenchmark,
  buildBenchmarkPromptBlock,
  toMobilePostUrl,
  fetchTopBlogPosts,
  buildSerpBenchmark,
  type SerpPost,
  type SerpBenchmark,
  type PostBodyMetrics,
} from '../serp-benchmark.ts';

const NAVER_ENV = {
  NAVER_CLIENT_ID: 'id',
  NAVER_CLIENT_SECRET: 'secret',
} as NodeJS.ProcessEnv;

function post(partial: Partial<SerpPost>): SerpPost {
  return {
    title: '제목',
    description: '설명',
    link: 'https://blog.naver.com/someone/123',
    postdate: '',
    bloggername: '블로거',
    ...partial,
  };
}

// 본문 HTML 픽스처: se-main-container + 이미지 모듈 3개 + 제목 모듈 2개 + 충분한 한글 본문 + FAQ
function buildBodyHtml(opts: { images?: number; titles?: number; faq?: boolean; chars?: number } = {}): string {
  const images = opts.images ?? 3;
  const titles = opts.titles ?? 2;
  const chars = opts.chars ?? 600;
  const paragraph = '허리 디스크는 척추뼈 사이의 쿠션이 밀려나 신경을 누르는 상태입니다. '.repeat(
    Math.ceil(chars / 30)
  );
  const imageBlocks = Array.from({ length: images }, () => '<div class="se-module se-module-image"><img src="x.jpg"></div>').join('');
  const titleBlocks = Array.from({ length: titles }, (_, i) => `<div class="se-module se-module-text se-title-text"><h2>소제목 ${i}</h2></div>`).join('');
  const faq = opts.faq ? '<div>자주 묻는 질문</div>' : '';
  return `<html><body><div class="se-main-container">${titleBlocks}<p>${paragraph}</p>${imageBlocks}${faq}</div></body></html>`;
}

// ── median ──
test('median: 홀수/짝수/빈 배열', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), 0);
  assert.equal(median([10, NaN, 20]), 15); // 비정상 무시
});

// ── computeAuthorityWeight ──
test('computeAuthorityWeight: 최신 글이 오래된 글보다 가중치 높음', () => {
  const now = Date.parse('2026-06-29T00:00:00Z');
  const fresh = computeAuthorityWeight(post({ postdate: '20260628', bloggername: 'A' }), now);
  const old = computeAuthorityWeight(post({ postdate: '20230101', bloggername: 'A' }), now);
  assert.ok(fresh > old);
  assert.ok(fresh <= 1 && old >= 0);
});

test('computeAuthorityWeight: postdate 없으면 중립, bloggername 없으면 더 낮음', () => {
  const now = Date.now();
  const withName = computeAuthorityWeight(post({ postdate: '', bloggername: 'A' }), now);
  const noName = computeAuthorityWeight(post({ postdate: '', bloggername: '' }), now);
  assert.ok(withName > noName);
});

test('computeAuthorityWeight: 미래/깨진 postdate 방어', () => {
  const now = Date.parse('2020-01-01T00:00:00Z');
  // 미래 날짜는 recency 중립(0.5)로 처리되며 throw 없이 0~1
  const w = computeAuthorityWeight(post({ postdate: '20991231', bloggername: 'A' }), now);
  assert.ok(w >= 0 && w <= 1);
  const broken = computeAuthorityWeight(post({ postdate: 'abcd', bloggername: '' }), now);
  assert.ok(broken >= 0 && broken <= 1);
});

// ── rankPostsByAuthority (불변·안정) ──
test('rankPostsByAuthority: 최신 글이 앞으로, 원본 불변', () => {
  const now = Date.parse('2026-06-29T00:00:00Z');
  const input = [
    post({ link: 'old', postdate: '20200101', bloggername: 'A' }),
    post({ link: 'new', postdate: '20260601', bloggername: 'A' }),
  ];
  const ranked = rankPostsByAuthority(input, now);
  assert.equal(ranked[0].link, 'new');
  // 원본 순서 보존 (불변)
  assert.equal(input[0].link, 'old');
});

// ── parsePostBodyMetrics ──
test('parsePostBodyMetrics: 정상 본문 측정', () => {
  const m = parsePostBodyMetrics(buildBodyHtml({ images: 3, titles: 2, faq: true, chars: 600 }));
  assert.ok(m);
  assert.ok((m as PostBodyMetrics).charCount >= 200);
  assert.equal((m as PostBodyMetrics).imageCount, 3);
  assert.ok((m as PostBodyMetrics).headingCount >= 2);
  assert.equal((m as PostBodyMetrics).hasFaq, true);
});

test('parsePostBodyMetrics: 본문 부족/빈 입력은 null (graceful)', () => {
  assert.equal(parsePostBodyMetrics(''), null);
  assert.equal(parsePostBodyMetrics('<html><body>짧음</body></html>'), null);
  assert.equal(parsePostBodyMetrics('not html at all'), null);
});

// ── aggregateMeasured ──
test('aggregateMeasured: 빈 입력은 null', () => {
  assert.equal(aggregateMeasured([]), null);
});

test('aggregateMeasured: 헤딩 충분하면 그대로, 부족하면 글자수에서 유도', () => {
  const enough = aggregateMeasured([
    { charCount: 2000, imageCount: 6, headingCount: 6, hasFaq: true },
    { charCount: 1800, imageCount: 5, headingCount: 5, hasFaq: false },
  ]);
  assert.ok(enough);
  assert.ok(enough!.targetH2 >= 3);
  assert.equal(enough!.hasFaq, true); // 하나라도 true 면 true
  assert.equal(enough!.sampleSize, 2);

  const weakHeadings = aggregateMeasured([
    { charCount: 2000, imageCount: 5, headingCount: 0, hasFaq: false },
  ]);
  assert.ok(weakHeadings);
  // headingCount 0 → 글자수(2000)에서 유도 → H2 >= 3
  assert.ok(weakHeadings!.targetH2 >= 3);
  assert.ok(weakHeadings!.targetH3 >= 2);
});

test('aggregateMeasured: 이미지 목표는 4~12로 클램프', () => {
  const lowImg = aggregateMeasured([{ charCount: 1500, imageCount: 1, headingCount: 4, hasFaq: false }]);
  assert.equal(lowImg!.targetImages, 4);
  const highImg = aggregateMeasured([{ charCount: 1500, imageCount: 30, headingCount: 4, hasFaq: false }]);
  assert.equal(highImg!.targetImages, 12);
});

// ── competitionLevelFromTotal / estimateBenchmark ──
test('competitionLevelFromTotal: 구간 분류', () => {
  assert.equal(competitionLevelFromTotal(100), 'low');
  assert.equal(competitionLevelFromTotal(10000), 'medium');
  assert.equal(competitionLevelFromTotal(500000), 'high');
  assert.equal(competitionLevelFromTotal(NaN), 'low');
});

test('estimateBenchmark: 경쟁도별 목표 + sampleSize 0', () => {
  const high = estimateBenchmark(500000);
  assert.equal(high.competitionLevel, 'high');
  assert.equal(high.sampleSize, 0);
  assert.ok(high.targetCharCount >= 2000);
  const low = estimateBenchmark(10);
  assert.equal(low.competitionLevel, 'low');
  assert.equal(low.hasFaq, false);
});

// ── buildBenchmarkPromptBlock (의료광고법 가드 포함) ──
test('buildBenchmarkPromptBlock: 수치·하위주제·의료광고법 가드 포함', () => {
  const bm: SerpBenchmark = {
    targetCharCount: 2000, targetH2: 5, targetH3: 3, targetImages: 6,
    subtopics: ['원인', '치료'], hasFaq: true, confidence: 'measured',
    sampleSize: 3, competitionLevel: 'high',
  };
  const block = buildBenchmarkPromptBlock(bm, '허리디스크');
  assert.ok(block.includes('2000'));
  assert.ok(block.includes('허리디스크'));
  assert.ok(block.includes('원인'));
  assert.ok(block.includes('의료광고법'));
  assert.ok(block.includes('비교') && block.includes('비방'));
  assert.ok(block.includes('실측'));
});

// ── toMobilePostUrl ──
test('toMobilePostUrl: 경로형/쿼리형/비정상 처리', () => {
  assert.equal(toMobilePostUrl('https://blog.naver.com/abc/2233'), 'https://m.blog.naver.com/abc/2233');
  assert.equal(
    toMobilePostUrl('https://blog.naver.com/PostView.naver?blogId=abc&logNo=999'),
    'https://m.blog.naver.com/abc/999'
  );
  // 파싱 불가는 원본 그대로
  assert.equal(toMobilePostUrl('not a url'), 'not a url');
});

// ── fetchTopBlogPosts (graceful) ──
test('fetchTopBlogPosts: 키 없으면 빈 결과 (호출 안 함)', async () => {
  let called = false;
  const res = await fetchTopBlogPosts('키워드', {
    env: {} as NodeJS.ProcessEnv,
    fetchImpl: (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch,
  });
  assert.deepEqual(res, { posts: [], total: 0 });
  assert.equal(called, false);
});

test('fetchTopBlogPosts: 성공 시 파싱 + total', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({
      total: 12345,
      items: [
        { title: '<b>제목</b>', description: '설명', link: 'https://blog.naver.com/a/1', postdate: '20260101', bloggername: 'A' },
      ],
    }), { status: 200 })) as unknown as typeof fetch;
  const res = await fetchTopBlogPosts('키워드', { env: NAVER_ENV, fetchImpl });
  assert.equal(res.total, 12345);
  assert.equal(res.posts.length, 1);
  assert.equal(res.posts[0].title, '제목'); // 태그 제거
});

test('fetchTopBlogPosts: non-ok 는 빈 결과', async () => {
  const fetchImpl = (async () => new Response('err', { status: 500 })) as unknown as typeof fetch;
  const res = await fetchTopBlogPosts('키워드', { env: NAVER_ENV, fetchImpl });
  assert.deepEqual(res, { posts: [], total: 0 });
});

// ── buildSerpBenchmark (오케스트레이터) ──
test('buildSerpBenchmark: 키 없으면 null (생성 플로우 폴백)', async () => {
  const bm = await buildSerpBenchmark('키워드', {
    env: {} as NodeJS.ProcessEnv,
    fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
    analyze: async () => ['주제'],
  });
  assert.equal(bm, null);
});

test('buildSerpBenchmark: 본문 측정 성공 → confidence measured', async () => {
  const fetchImpl = (async (url: string) => {
    if (url.includes('openapi.naver.com')) {
      return new Response(JSON.stringify({
        total: 8000,
        items: [
          { title: 'T1', description: 'D1', link: 'https://blog.naver.com/a/1', postdate: '20260601', bloggername: 'A' },
          { title: 'T2', description: 'D2', link: 'https://blog.naver.com/b/2', postdate: '20260501', bloggername: 'B' },
        ],
      }), { status: 200 });
    }
    // 본문 요청
    return new Response(buildBodyHtml({ images: 5, titles: 5, faq: true, chars: 2000 }), { status: 200 });
  }) as unknown as typeof fetch;

  const bm = await buildSerpBenchmark('허리디스크', {
    env: NAVER_ENV,
    fetchImpl,
    analyze: async () => ['원인', '치료'],
    now: Date.parse('2026-06-29T00:00:00Z'),
  });
  assert.ok(bm);
  assert.equal(bm!.confidence, 'measured');
  assert.ok(bm!.sampleSize >= 1);
  assert.ok(bm!.targetCharCount >= 200);
  assert.deepEqual(bm!.subtopics, ['원인', '치료']);
  assert.equal(bm!.competitionLevel, 'medium'); // total 8000
});

test('buildSerpBenchmark: 본문 모두 실패 → confidence estimated (degrade, 안 깨짐)', async () => {
  const fetchImpl = (async (url: string) => {
    if (url.includes('openapi.naver.com')) {
      return new Response(JSON.stringify({
        total: 500000,
        items: [
          { title: 'T1', description: 'D1', link: 'https://blog.naver.com/a/1', postdate: '20260601', bloggername: 'A' },
        ],
      }), { status: 200 });
    }
    return new Response('blocked', { status: 403 }); // 본문 fetch 실패
  }) as unknown as typeof fetch;

  const bm = await buildSerpBenchmark('보톡스', {
    env: NAVER_ENV,
    fetchImpl,
    analyze: async () => ['주제A'],
  });
  assert.ok(bm);
  assert.equal(bm!.confidence, 'estimated');
  assert.equal(bm!.sampleSize, 0);
  assert.equal(bm!.competitionLevel, 'high');
  assert.deepEqual(bm!.subtopics, ['주제A']);
});

test('buildSerpBenchmark: analyze 실패해도 빈 subtopics 로 graceful', async () => {
  const fetchImpl = (async (url: string) => {
    if (url.includes('openapi.naver.com')) {
      return new Response(JSON.stringify({
        total: 100,
        items: [{ title: 'T', description: 'D', link: 'https://blog.naver.com/a/1', postdate: '20260601', bloggername: 'A' }],
      }), { status: 200 });
    }
    return new Response(buildBodyHtml({ chars: 1600 }), { status: 200 });
  }) as unknown as typeof fetch;

  const bm = await buildSerpBenchmark('키워드', {
    env: NAVER_ENV,
    fetchImpl,
    analyze: async () => { throw new Error('claude down'); },
  });
  assert.ok(bm);
  assert.deepEqual(bm!.subtopics, []);
});

test('buildSerpBenchmark: 검색 결과 없으면 null', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ total: 0, items: [] }), { status: 200 })) as unknown as typeof fetch;
  const bm = await buildSerpBenchmark('키워드', { env: NAVER_ENV, fetchImpl, analyze: async () => [] });
  assert.equal(bm, null);
});
