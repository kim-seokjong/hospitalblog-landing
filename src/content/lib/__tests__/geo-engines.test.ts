import test from 'node:test';
import assert from 'node:assert/strict';

import { parseOpenAiResponse, openAiEngine } from '../geo-engines/openai.ts';
import { parsePerplexityResponse, perplexityEngine } from '../geo-engines/perplexity.ts';
import { parseGeminiResponse, geminiEngine, isGroundingRedirect, resolveGroundingUri } from '../geo-engines/gemini.ts';
import {
  getEnabledEngines,
  isGeoLiveQueryEnabled,
  executeGeoQueries,
  GEO_ENGINES,
  ENABLE_GEMINI_FLAG,
} from '../geo-engines/index.ts';
import { createGeoQueryCache } from '../geo-engines/cache.ts';
import { postJsonWithRetry } from '../geo-engines/http.ts';
import { runPool } from '../geo-engines/pool.ts';
import { createAttemptBudget } from '../geo-engines/attempts.ts';
import { chunkGroups } from '../geo-engines/batching.ts';
import type { GeoEngineAdapter, GeoLiveAnswer } from '../geo-engines/types.ts';

// ---------------------------------------------------------------------------
// 어댑터 파싱 — 각 엔진 공식 문서의 응답 스키마 그대로
// ---------------------------------------------------------------------------

test('OpenAI 파싱: output_text + url_citation 주석 → 텍스트·출처', () => {
  const answer = parseOpenAiResponse({
    output: [
      { type: 'reasoning', content: [] },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: '대구 수성구에는 애플피부과의원이 있습니다.',
            annotations: [
              { type: 'url_citation', url: 'https://blog.naver.com/apple-derm/1', title: '애플피부과' },
              { type: 'file_citation', url: 'https://ignored.example' },
            ],
          },
        ],
      },
    ],
  });

  assert.match(answer.text, /애플피부과의원/);
  assert.equal(answer.sources.length, 1);
  assert.equal(answer.sources[0].url, 'https://blog.naver.com/apple-derm/1');
  assert.equal(answer.searchQueryCount, 1);
});

test('OpenAI 파싱: 텍스트 없으면 throw (토큰 상한 도달)', () => {
  assert.throws(() => parseOpenAiResponse({ output: [{ type: 'message', content: [] }] }), /비어있습니다/);
});

test('Perplexity 파싱: search_results 를 정본으로 사용', () => {
  const answer = parsePerplexityResponse({
    choices: [{ message: { content: '수성구 피부과로는 애플피부과가 있습니다.' } }],
    citations: ['https://legacy.example/should-not-win'],
    search_results: [
      { title: '애플피부과 블로그', url: 'https://blog.naver.com/apple-derm', date: '2026-01-01' },
      { title: '지역 정보', url: 'https://example.com/a' },
    ],
  });

  assert.equal(answer.sources.length, 2);
  assert.equal(answer.sources[0].url, 'https://blog.naver.com/apple-derm');
  assert.equal(answer.sources[0].title, '애플피부과 블로그');
  assert.equal(answer.searchQueryCount, 1);
});

test('Perplexity 파싱: search_results 없으면 구 citations 로 폴백', () => {
  const answer = parsePerplexityResponse({
    choices: [{ message: { content: '답변' } }],
    citations: ['https://a.example', 'https://b.example'],
  });
  assert.deepEqual(
    answer.sources.map((s) => s.url),
    ['https://a.example', 'https://b.example'],
  );
});

test('Perplexity 파싱: 출처가 전혀 없어도 텍스트만 있으면 성공', () => {
  const answer = parsePerplexityResponse({ choices: [{ message: { content: '답변만 있음' } }] });
  assert.deepEqual(answer.sources, []);
});

test('Perplexity 파싱: 본문 비면 throw', () => {
  assert.throws(() => parsePerplexityResponse({ choices: [{ message: { content: '   ' } }] }), /비어있습니다/);
});

test('Gemini 파싱: parts 이어붙이기 + groundingChunks 출처 + 검색 질의 수', () => {
  const answer = parseGeminiResponse({
    candidates: [
      {
        content: { parts: [{ text: '대구 수성구 피부과로는 ' }, { text: '애플피부과의원이 있습니다.' }] },
        groundingMetadata: {
          webSearchQueries: ['대구 수성구 피부과', '수성구 피부과 추천'],
          groundingChunks: [
            { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'blog.naver.com' } },
            { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/def', title: 'example.com' } },
          ],
        },
      },
    ],
  });

  assert.equal(answer.text, '대구 수성구 피부과로는 애플피부과의원이 있습니다.');
  assert.equal(answer.sources.length, 2);
  // Gemini 3 는 실행된 검색 질의 수 단위로 무료 할당량이 차감된다
  assert.equal(answer.searchQueryCount, 2);
});

test('Gemini 파싱: groundingMetadata 없으면 출처 0 · 검색 질의 최소 1', () => {
  const answer = parseGeminiResponse({ candidates: [{ content: { parts: [{ text: '답변' }] } }] });
  assert.deepEqual(answer.sources, []);
  assert.equal(answer.searchQueryCount, 1);
});

test('Gemini 파싱: 후보 없음 → throw', () => {
  assert.throws(() => parseGeminiResponse({ candidates: [] }), /비어있습니다/);
});

// ---------------------------------------------------------------------------
// Gemini 리다이렉트 복원 — 이게 없으면 blog_url 인용이 Gemini 에서만 항상 미탐
// ---------------------------------------------------------------------------

test('그라운딩 리다이렉트 호스트 판별', () => {
  assert.equal(isGroundingRedirect('https://vertexaisearch.cloud.google.com/grounding-api-redirect/x'), true);
  assert.equal(isGroundingRedirect('https://blog.naver.com/abc'), false);
  assert.equal(isGroundingRedirect('not-a-url'), false);
});

test('리다이렉트 복원: Location 헤더를 따라 실제 URL 을 얻는다', async () => {
  const fetchImpl = (async () =>
    new Response(null, { status: 302, headers: { location: 'https://blog.naver.com/apple-derm/223' } })) as unknown as typeof fetch;

  const resolved = await resolveGroundingUri(
    'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
    fetchImpl,
  );
  assert.equal(resolved, 'https://blog.naver.com/apple-derm/223');
});

test('리다이렉트 복원: 구글 호스트가 아니면 요청조차 하지 않는다 (SSRF 방어)', async () => {
  let called = 0;
  const fetchImpl = (async () => {
    called++;
    return new Response(null, { status: 302 });
  }) as unknown as typeof fetch;

  const resolved = await resolveGroundingUri('https://internal.local/secret', fetchImpl);
  assert.equal(resolved, 'https://internal.local/secret');
  assert.equal(called, 0);
});

test('리다이렉트 복원: 실패하면 원본 URL 유지 (그레이스풀)', async () => {
  const fetchImpl = (async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;

  const original = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc';
  assert.equal(await resolveGroundingUri(original, fetchImpl), original);
});

// ---------------------------------------------------------------------------
// 키 없을 때 skip — 환경변수를 안 넣어도 배포가 깨지면 안 된다
// ---------------------------------------------------------------------------

test('키가 하나도 없으면 활성 엔진 0 (mode:disabled 경로)', () => {
  assert.deepEqual(getEnabledEngines({}), []);
  assert.equal(isGeoLiveQueryEnabled({}), false);
});

test('OPENAI_API_KEY 만 있으면 기존과 동일하게 OpenAI 단독 동작', () => {
  const enabled = getEnabledEngines({ OPENAI_API_KEY: 'sk-test' });
  assert.deepEqual(enabled.map((e) => e.id), ['openai']);
  assert.equal(isGeoLiveQueryEnabled({ OPENAI_API_KEY: 'sk-test' }), true);
});

test('키가 있는 엔진만 선택되고 나머지는 조용히 제외', () => {
  const enabled = getEnabledEngines({ PERPLEXITY_API_KEY: 'b' });
  assert.deepEqual(enabled.map((e) => e.id), ['perplexity']);
});

test('운영 기본은 OpenAI + Perplexity 2엔진', () => {
  const enabled = getEnabledEngines({ OPENAI_API_KEY: 'a', PERPLEXITY_API_KEY: 'b' });
  assert.deepEqual(enabled.map((e) => e.id), ['openai', 'perplexity']);
});

// ---------------------------------------------------------------------------
// Gemini 기본 비활성 — 구글 약관상 Grounded Results 의 analyze/cache 금지
// ---------------------------------------------------------------------------

test('★Gemini: GEMINI_API_KEY 가 있어도 옵트인 없이는 활성화되지 않는다', () => {
  const enabled = getEnabledEngines({ OPENAI_API_KEY: 'a', PERPLEXITY_API_KEY: 'b', GEMINI_API_KEY: 'c' });
  assert.deepEqual(enabled.map((e) => e.id), ['openai', 'perplexity']);
  assert.ok(!enabled.some((e) => e.id === 'gemini'));
});

test('★Gemini: 키만 있고 옵트인 없으면 활성 엔진 0', () => {
  assert.deepEqual(getEnabledEngines({ GEMINI_API_KEY: 'c' }), []);
});

test('★Gemini: GEO_ENABLE_GEMINI=true 옵트인 시에만 포함된다', () => {
  const enabled = getEnabledEngines({ OPENAI_API_KEY: 'a', GEMINI_API_KEY: 'c', [ENABLE_GEMINI_FLAG]: 'true' });
  assert.deepEqual(enabled.map((e) => e.id), ['openai', 'gemini']);
});

test('★Gemini: 옵트인 플래그가 true 가 아니면 무시된다', () => {
  for (const value of ['1', 'yes', 'TRUE ', 'on', '']) {
    const enabled = getEnabledEngines({ GEMINI_API_KEY: 'c', [ENABLE_GEMINI_FLAG]: value });
    assert.deepEqual(enabled.map((e) => e.id), [], `flag=${JSON.stringify(value)}`);
  }
});

test('★Gemini: 옵트인해도 키가 없으면 여전히 제외', () => {
  assert.deepEqual(getEnabledEngines({ [ENABLE_GEMINI_FLAG]: 'true' }), []);
});

test('GEO_LIVE_QUERY=off 면 키가 다 있어도 전체 비활성', () => {
  const env = { OPENAI_API_KEY: 'a', PERPLEXITY_API_KEY: 'b', GEMINI_API_KEY: 'c', GEO_LIVE_QUERY: 'OFF' };
  assert.deepEqual(getEnabledEngines(env), []);
  assert.equal(isGeoLiveQueryEnabled(env), false);
});

test('엔진 식별자는 geo_citations.engine 에 기록할 값 그대로', () => {
  assert.deepEqual(GEO_ENGINES.map((e) => e.id), ['openai', 'perplexity', 'gemini']);
});

test('키 없이 run 하면 명시적 에러 (조용한 실패 금지)', async () => {
  const ctx = { fetchImpl: fetch, env: {}, timeoutMs: 100, maxAttempts: 1 };
  await assert.rejects(() => openAiEngine.run('q', ctx), /OPENAI_API_KEY/);
  await assert.rejects(() => perplexityEngine.run('q', ctx), /PERPLEXITY_API_KEY/);
  await assert.rejects(() => geminiEngine.run('q', ctx), /GEMINI_API_KEY/);
});

// ---------------------------------------------------------------------------
// HTTP 타임아웃·재시도
// ---------------------------------------------------------------------------

test('HTTP: 429 는 재시도하고 성공하면 결과 반환', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    if (calls === 1) return new Response('slow down', { status: 429 });
    return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  const data = await postJsonWithRetry({
    url: 'https://x.example',
    headers: {},
    body: {},
    timeoutMs: 1000,
    maxAttempts: 2,
    fetchImpl,
    label: 'Test',
    sleepImpl: async () => {},
  });
  assert.deepEqual(data, { ok: 1 });
  assert.equal(calls, 2);
});

test('HTTP: 401 은 재시도하지 않고 즉시 실패', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response('bad key', { status: 401 });
  }) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      postJsonWithRetry({
        url: 'https://x.example',
        headers: {},
        body: {},
        timeoutMs: 1000,
        maxAttempts: 3,
        fetchImpl,
        label: 'Test',
        sleepImpl: async () => {},
      }),
    /Test API 실패 \(401\)/,
  );
  assert.equal(calls, 1);
});

test('HTTP: 시도 횟수 소진 시 마지막 사유로 실패', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response('boom', { status: 503 });
  }) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      postJsonWithRetry({
        url: 'https://x.example',
        headers: {},
        body: {},
        timeoutMs: 1000,
        maxAttempts: 2,
        fetchImpl,
        label: 'Test',
        sleepImpl: async () => {},
      }),
    /503/,
  );
  assert.equal(calls, 2);
});

// ---------------------------------------------------------------------------
// 워커 풀 — 데드라인 처리
// ---------------------------------------------------------------------------

test('풀: 데드라인을 넘으면 남은 작업을 skipped 로 보고', async () => {
  let clock = 0;
  const done: number[] = [];
  const result = await runPool(
    [1, 2, 3, 4, 5],
    async (n) => {
      done.push(n);
      clock += 100; // 작업마다 100ms 소요로 가정
    },
    { concurrency: 1, minIntervalMs: 0, deadlineAt: 250, now: () => clock, sleepImpl: async () => {} },
  );

  assert.equal(result.completed, 3);
  assert.equal(result.skipped, 2);
  assert.deepEqual(done, [1, 2, 3]);
});

test('풀: worker 가 throw 해도 전체가 멈추지 않는다', async () => {
  let handled = 0;
  const result = await runPool(
    [1, 2, 3],
    async (n) => {
      handled++;
      if (n === 2) throw new Error('boom');
    },
    { concurrency: 1, minIntervalMs: 0, deadlineAt: Number.MAX_SAFE_INTEGER, sleepImpl: async () => {} },
  );
  assert.equal(handled, 3);
  assert.equal(result.completed, 3);
  assert.equal(result.skipped, 0);
});

// ---------------------------------------------------------------------------
// 실행기 — 엔진 격리 / Gemini 예산 / 캐시 연동
// ---------------------------------------------------------------------------

function stubEngine(id: 'openai' | 'perplexity' | 'gemini', impl: (q: string) => Promise<GeoLiveAnswer>): GeoEngineAdapter {
  return {
    id,
    label: id,
    isConfigured: () => true,
    run: (question) => impl(question),
  };
}

test('실행기: 한 엔진이 전부 실패해도 다른 엔진은 계속 돈다', async () => {
  const ok = stubEngine('openai', async (q) => ({ text: `answer:${q}`, sources: [], searchQueryCount: 1 }));
  const broken = stubEngine('perplexity', async () => {
    throw new Error('엔진 다운');
  });

  const { cache, stats, failures } = await executeGeoQueries({
    questions: ['q1', 'q2'],
    engines: [ok, broken],
    env: {},
    deadlineAt: Date.now() + 60_000,
    sleepImpl: async () => {},
  });

  assert.equal(cache.peek('openai', 'q1')?.ok, true);
  assert.equal(cache.peek('perplexity', 'q1')?.ok, false);
  const openaiStat = stats.find((s) => s.engine === 'openai');
  const pplxStat = stats.find((s) => s.engine === 'perplexity');
  assert.equal(openaiStat?.succeeded, 2);
  assert.equal(pplxStat?.failed, 2);
  assert.equal(failures.length, 2);
  assert.ok(failures.every((f) => f.engine === 'perplexity'));
});

test('실행기: 엔진별 상한을 넘는 질의는 skipped 로 집계', async () => {
  const engine = stubEngine('openai', async (q) => ({ text: q, sources: [], searchQueryCount: 1 }));
  const { stats } = await executeGeoQueries({
    questions: ['a', 'b', 'c', 'd'],
    engines: [engine],
    env: {},
    deadlineAt: Date.now() + 60_000,
    maxCallsPerEngine: 2,
    sleepImpl: async () => {},
  });
  assert.equal(stats[0].calls, 2);
  assert.equal(stats[0].skipped, 2);
});

test('실행기: Gemini 검색 질의 예산을 넘으면 그 뒤 질의를 스킵한다 (무료 한도 방어)', async () => {
  // 한 프롬프트가 검색을 1000회 실행했다고 보고 → 예산(800) 즉시 초과
  const gemini = stubEngine('gemini', async (q) => ({ text: q, sources: [], searchQueryCount: 1000 }));
  const { stats, failures } = await executeGeoQueries({
    questions: ['a', 'b', 'c', 'd', 'e', 'f'],
    engines: [gemini],
    env: {},
    deadlineAt: Date.now() + 60_000,
    sleepImpl: async () => {},
  });

  // 동시 실행 중인 호출은 아직 소비량을 보고하지 않았으므로
  // 최대 (동시 실행 수 = 2)건까지만 예산을 넘겨 실행된다.
  assert.ok(stats[0].succeeded <= 2, `succeeded=${stats[0].succeeded}`);
  assert.equal(stats[0].succeeded + stats[0].failed, 6);
  assert.ok(stats[0].failed >= 4);
  assert.ok(failures.length >= 4);
  assert.ok(failures.every((f) => /예산/.test(f.reason)));
});

// ---------------------------------------------------------------------------
// 캐싱 동작 — 같은 (엔진, 질의문)은 1회만 호출
// ---------------------------------------------------------------------------

test('캐시: 같은 (엔진, 질의문)은 factory 를 1회만 호출', async () => {
  const cache = createGeoQueryCache();
  let calls = 0;
  const factory = async (): Promise<GeoLiveAnswer> => {
    calls++;
    return { text: '답변', sources: [], searchQueryCount: 1 };
  };

  const first = await cache.resolve('openai', '대구 수성구 피부과 추천해줘', factory);
  const second = await cache.resolve('openai', '대구 수성구 피부과 추천해줘', factory);

  assert.equal(calls, 1);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(cache.stats(), { hits: 1, misses: 1 });
});

test('캐시: 엔진이 다르면 별도 호출', async () => {
  const cache = createGeoQueryCache();
  let calls = 0;
  const factory = async (): Promise<GeoLiveAnswer> => {
    calls++;
    return { text: '답변', sources: [], searchQueryCount: 1 };
  };

  await cache.resolve('openai', 'q', factory);
  await cache.resolve('perplexity', 'q', factory);
  assert.equal(calls, 2);
  assert.deepEqual(cache.stats(), { hits: 0, misses: 2 });
});

test('캐시: 동시 호출도 1회로 합쳐진다', async () => {
  const cache = createGeoQueryCache();
  let calls = 0;
  const factory = async (): Promise<GeoLiveAnswer> => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return { text: '답변', sources: [], searchQueryCount: 1 };
  };

  await Promise.all([
    cache.resolve('gemini', 'q', factory),
    cache.resolve('gemini', 'q', factory),
    cache.resolve('gemini', 'q', factory),
  ]);
  assert.equal(calls, 1);
  assert.equal(cache.stats().hits, 2);
});

test('캐시: 실패도 캐싱해 같은 실패 질의를 반복 호출하지 않는다', async () => {
  const cache = createGeoQueryCache();
  let calls = 0;
  const factory = async (): Promise<GeoLiveAnswer> => {
    calls++;
    throw new Error('엔진 오류');
  };

  const first = await cache.resolve('openai', 'q', factory);
  const second = await cache.resolve('openai', 'q', factory);

  assert.equal(calls, 1);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(first.ok === false && first.reason, '엔진 오류');
});

test('캐시: peek 은 확정 전에는 undefined', async () => {
  const cache = createGeoQueryCache();
  assert.equal(cache.peek('openai', 'q'), undefined);
  await cache.resolve('openai', 'q', async () => ({ text: 'a', sources: [], searchQueryCount: 1 }));
  assert.equal(cache.peek('openai', 'q')?.ok, true);
});

// ---------------------------------------------------------------------------
// [Codex 2] 데드라인이 실제 요청을 중단하는가 — 300초 플랫폼 제한 방어
// ---------------------------------------------------------------------------

test('데드라인: 요청 타임아웃이 남은 시간으로 좁혀진다 (60초를 그대로 쓰지 않는다)', async () => {
  let clock = 0;
  let observedTimeout = -1;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    // AbortSignal 이 언제 발동하도록 설정됐는지를 간접 측정
    const signal = init.signal as AbortSignal;
    const start = clock;
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => {
        observedTimeout = clock - start;
        resolve();
      }, { once: true });
      setTimeout(resolve, 5);
    });
    return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
  }) as unknown as typeof fetch;

  // 남은 시간 3초 < 기본 타임아웃 60초 → 3초로 좁혀져야 한다
  await postJsonWithRetry({
    url: 'https://x.example',
    headers: {},
    body: {},
    timeoutMs: 60_000,
    maxAttempts: 1,
    fetchImpl,
    label: 'Test',
    deadlineAt: 3_000,
    now: () => clock,
    sleepImpl: async () => {},
  });
  // abort 가 발동하지 않고 정상 응답 — 좁혀진 타임아웃이 요청보다 길었음
  assert.equal(observedTimeout, -1);
});

test('데드라인: 남은 시간이 최소치 미만이면 요청을 시작조차 하지 않는다', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      postJsonWithRetry({
        url: 'https://x.example',
        headers: {},
        body: {},
        timeoutMs: 60_000,
        maxAttempts: 2,
        fetchImpl,
        label: 'Test',
        deadlineAt: 1_000,
        now: () => 900, // 남은 시간 100ms < MIN_REQUEST_WINDOW_MS(1000)
        sleepImpl: async () => {},
      }),
    /남은 시간이 부족/,
  );
  assert.equal(calls, 0);
});

test('데드라인: 임박하면 재시도하지 않는다', async () => {
  let calls = 0;
  let clock = 0;
  const fetchImpl = (async () => {
    calls++;
    clock = 100_000; // 첫 시도로 시간을 거의 다 씀
    return new Response('busy', { status: 503 });
  }) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      postJsonWithRetry({
        url: 'https://x.example',
        headers: {},
        body: {},
        timeoutMs: 60_000,
        maxAttempts: 3,
        fetchImpl,
        label: 'Test',
        deadlineAt: 102_000, // 재시도 후 남는 시간이 MIN_RETRY_WINDOW_MS 미만
        now: () => clock,
        sleepImpl: async () => {},
      }),
    /재시도 생략/,
  );
  assert.equal(calls, 1);
});

test('데드라인: 공통 시그널이 aborted 면 진행 중인 요청도 취소된다', async () => {
  const controller = new AbortController();
  let aborted = false;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal;
    controller.abort(); // 실행 도중 데드라인 도달을 흉내
    await new Promise<void>((resolve) => {
      if (signal.aborted) { aborted = true; resolve(); return; }
      signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true });
    });
    throw new Error('aborted');
  }) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      postJsonWithRetry({
        url: 'https://x.example',
        headers: {},
        body: {},
        timeoutMs: 60_000,
        maxAttempts: 3,
        fetchImpl,
        label: 'Test',
        signal: controller.signal,
        sleepImpl: async () => {},
      }),
    /데드라인 도달/,
  );
  assert.equal(aborted, true);
});

test('실행기: 데드라인이 이미 지났으면 아무 호출도 하지 않고 deadlineReached 를 보고', async () => {
  let calls = 0;
  const engine = stubEngine('openai', async (q) => {
    calls++;
    return { text: q, sources: [], searchQueryCount: 1 };
  });

  const result = await executeGeoQueries({
    questions: ['a', 'b'],
    engines: [engine],
    env: {},
    deadlineAt: Date.now() - 1,
    sleepImpl: async () => {},
  });

  assert.equal(calls, 0);
  assert.equal(result.deadlineReached, true);
  assert.equal(result.stats[0].skipped, 2);
});

// ---------------------------------------------------------------------------
// [Codex 4] 비용 상한은 재시도를 포함한 실제 HTTP 시도 수에 걸려야 한다
// ---------------------------------------------------------------------------

test('시도 예산: 검사 후 증가가 원자적이고 상한을 넘지 않는다', () => {
  const budget = createAttemptBudget(3);
  assert.equal(budget.tryConsume(), true);
  assert.equal(budget.tryConsume(), true);
  assert.equal(budget.tryConsume(), true);
  assert.equal(budget.tryConsume(), false);
  assert.equal(budget.used(), 3);
  assert.equal(budget.remaining(), 0);
});

test('시도 예산: 재시도도 예산을 소비한다 (논리 호출 1건 = 최대 2 시도)', async () => {
  const budget = createAttemptBudget(10);
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response('busy', { status: 503 });
  }) as unknown as typeof fetch;

  await assert.rejects(() =>
    postJsonWithRetry({
      url: 'https://x.example',
      headers: {},
      body: {},
      timeoutMs: 1_000,
      maxAttempts: 2,
      fetchImpl,
      label: 'Test',
      attemptBudget: budget,
      sleepImpl: async () => {},
    }),
  );
  assert.equal(calls, 2);
  assert.equal(budget.used(), 2); // 논리 호출 1건이 시도 2건을 소비
});

test('시도 예산: 소진되면 더 이상 HTTP 요청을 보내지 않는다', async () => {
  const budget = createAttemptBudget(1);
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
  }) as unknown as typeof fetch;

  const options = {
    url: 'https://x.example',
    headers: {},
    body: {},
    timeoutMs: 1_000,
    maxAttempts: 1,
    fetchImpl,
    label: 'Test',
    attemptBudget: budget,
    sleepImpl: async () => {},
  };

  await postJsonWithRetry(options);
  await assert.rejects(() => postJsonWithRetry(options), /시도 상한/);
  assert.equal(calls, 1);
});

test('실행기: httpAttempts 가 재시도를 포함한 실제 요청 수를 보고한다', async () => {
  let attempts = 0;
  const fetchImpl = (async () => {
    attempts++;
    // 첫 질의는 1회 실패 후 성공, 두 번째는 즉시 성공
    if (attempts === 1) return new Response('busy', { status: 503 });
    return new Response(
      JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '답변' }] }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const result = await executeGeoQueries({
    questions: ['q1', 'q2'],
    engines: [openAiEngine],
    env: { OPENAI_API_KEY: 'sk-test' },
    fetchImpl,
    deadlineAt: Date.now() + 60_000,
    sleepImpl: async () => {},
  });

  // 논리 호출 2건인데 실제 HTTP 시도는 3건
  assert.equal(result.stats[0].calls, 2);
  assert.equal(result.httpAttempts, 3);
  assert.equal(result.stats[0].httpAttempts, 3);
});

test('실행기: HTTP 시도 상한에 걸리면 이후 호출이 중단된다', async () => {
  let attempts = 0;
  const fetchImpl = (async () => {
    attempts++;
    return new Response(
      JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '답변' }] }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const result = await executeGeoQueries({
    questions: ['q1', 'q2', 'q3', 'q4', 'q5'],
    engines: [openAiEngine],
    env: { OPENAI_API_KEY: 'sk-test' },
    fetchImpl,
    deadlineAt: Date.now() + 60_000,
    maxHttpAttempts: 2,
    sleepImpl: async () => {},
  });

  assert.equal(attempts, 2);
  assert.equal(result.httpAttempts, 2);
  assert.equal(result.stats[0].succeeded, 2);
  assert.equal(result.stats[0].failed, 3);
});

// ---------------------------------------------------------------------------
// [Codex 3] 배치 insert 가 회원 경계를 가르지 않는다
// ---------------------------------------------------------------------------

test('청킹: 회원 그룹이 두 청크로 갈리지 않는다', () => {
  const groups = [
    ['a1', 'a2', 'a3'],
    ['b1', 'b2', 'b3'],
    ['c1', 'c2', 'c3'],
  ];
  const chunks = chunkGroups(groups, 5);
  // 5행 상한: a(3) 만 첫 청크, b(3) 를 넣으면 6 이라 새 청크
  assert.deepEqual(chunks, [['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2', 'c3']]);
  for (const chunk of chunks) {
    assert.ok(chunk.length % 3 === 0, '그룹이 쪼개지지 않았다');
  }
});

test('청킹: 상한에 여유가 있으면 여러 그룹을 한 청크에 담는다', () => {
  assert.deepEqual(chunkGroups([['a1', 'a2'], ['b1', 'b2'], ['c1']], 5), [
    ['a1', 'a2', 'b1', 'b2', 'c1'],
  ]);
  // 상한을 넘기려는 그룹은 다음 청크로 밀린다 (쪼개지 않는다)
  assert.deepEqual(chunkGroups([['a1', 'a2'], ['b1', 'b2'], ['c1']], 4), [
    ['a1', 'a2', 'b1', 'b2'],
    ['c1'],
  ]);
});

test('청킹: 그룹 자체가 상한보다 크면 단독 청크로 분리(쪼개지 않음)', () => {
  const chunks = chunkGroups([['a1'], ['b1', 'b2', 'b3', 'b4']], 3);
  assert.deepEqual(chunks, [['a1'], ['b1', 'b2', 'b3', 'b4']]);
});

test('청킹: 빈 그룹·빈 입력은 청크를 만들지 않는다', () => {
  assert.deepEqual(chunkGroups([], 10), []);
  assert.deepEqual(chunkGroups([[], []], 10), []);
});

// ---------------------------------------------------------------------------
// [Codex 7] 파서 런타임 타입 가드 — 스키마가 달라도 사유가 분명해야 한다
// ---------------------------------------------------------------------------

test('파서 가드: 최상위가 객체가 아니면 형식 오류로 실패', () => {
  assert.throws(() => parseOpenAiResponse(null), /최상위가 객체가 아닙니다 \(null\)/);
  assert.throws(() => parsePerplexityResponse('문자열'), /최상위가 객체가 아닙니다 \(string\)/);
  assert.throws(() => parseGeminiResponse([1, 2]), /최상위가 객체가 아닙니다 \(array\)/);
});

test('파서 가드: 필수 배열 필드가 배열이 아니면 어느 필드인지 밝힌다', () => {
  assert.throws(() => parseOpenAiResponse({ output: 'nope' }), /output 가 배열이 아닙니다 \(string\)/);
  assert.throws(() => parsePerplexityResponse({}), /choices 가 배열이 아닙니다 \(undefined\)/);
  assert.throws(() => parseGeminiResponse({ candidates: null }), /candidates 가 배열이 아닙니다 \(null\)/);
});

test('파서 가드: 중첩 필드 타입이 이상해도 크래시하지 않고 빈 값으로 흡수', () => {
  // annotations 가 객체, content 가 숫자여도 예외 없이 진행되어야 한다
  const answer = parseOpenAiResponse({
    output: [
      { type: 'message', content: 42 },
      { type: 'message', content: [{ type: 'output_text', text: '정상 텍스트', annotations: { bad: true } }] },
    ],
  });
  assert.equal(answer.text, '정상 텍스트');
  assert.deepEqual(answer.sources, []);
});

test('파서 가드: Perplexity search_results 원소가 문자열이어도 무시하고 진행', () => {
  const answer = parsePerplexityResponse({
    choices: [{ message: { content: '답변' } }],
    search_results: ['bad', { url: 'https://ok.example', title: 'ok' }],
  });
  assert.deepEqual(answer.sources, [{ url: 'https://ok.example', title: 'ok' }]);
});
