import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJsonWithTimeout } from '../fetch-timeout.ts';
import { fetchBlogDocCount, fetchBlogDocCounts } from '../golden-keywords.ts';

const ENV = {
  NAVER_CLIENT_ID: 'id',
  NAVER_CLIENT_SECRET: 'secret',
} as unknown as NodeJS.ProcessEnv;

const okResponse = (body: unknown): Response =>
  ({ ok: true, json: async () => body }) as unknown as Response;

// ── fetchJsonWithTimeout ──

test('fetchJsonWithTimeout: 응답 없는 fetch 는 timeoutMs 후 ok:false', async () => {
  const hangingFetch: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new Error('aborted'))
      );
    });

  const result = await fetchJsonWithTimeout(
    hangingFetch,
    'https://example.test',
    {},
    20
  );
  assert.deepEqual(result, { ok: false });
});

test('fetchJsonWithTimeout: 헤더만 오고 body 가 멈춰도 timeoutMs 후 ok:false', async () => {
  const headersOnlyFetch: typeof fetch = async (_input, init) => {
    const signal = init?.signal;
    return {
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new Error('body aborted'))
          );
        }),
    } as unknown as Response;
  };

  const result = await fetchJsonWithTimeout(
    headersOnlyFetch,
    'https://example.test',
    {},
    20
  );
  assert.deepEqual(result, { ok: false });
});

test('fetchJsonWithTimeout: 정상 응답은 파싱된 data 를 반환하고 init 을 보존한다', async () => {
  let seenInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    seenInit = init;
    return okResponse({ total: 7 });
  };

  const result = await fetchJsonWithTimeout(
    fetchImpl,
    'https://example.test',
    { headers: { 'X-Test': 'y' } },
    1000
  );
  assert.deepEqual(result, { ok: true, data: { total: 7 } });
  assert.deepEqual(seenInit?.headers, { 'X-Test': 'y' });
  assert.ok(seenInit?.signal instanceof AbortSignal);
});

test('fetchJsonWithTimeout: non-ok·네트워크 오류·파싱 실패 전부 ok:false (그레이스풀)', async () => {
  const notOk: typeof fetch = async () =>
    ({ ok: false, json: async () => ({}) }) as unknown as Response;
  const throwing: typeof fetch = async () => {
    throw new Error('network down');
  };
  const badJson: typeof fetch = async () =>
    ({
      ok: true,
      json: async () => {
        throw new Error('invalid json');
      },
    }) as unknown as Response;

  assert.deepEqual(await fetchJsonWithTimeout(notOk, 'https://x'), { ok: false });
  assert.deepEqual(await fetchJsonWithTimeout(throwing, 'https://x'), { ok: false });
  assert.deepEqual(await fetchJsonWithTimeout(badJson, 'https://x'), { ok: false });
});

// ── fetchBlogDocCount / fetchBlogDocCounts deadline ──

test('fetchBlogDocCount: deadline 이 이미 지났으면 호출 없이 즉시 null', async () => {
  let called = 0;
  const fetchImpl: typeof fetch = async () => {
    called += 1;
    return okResponse({ total: 5 });
  };

  const count = await fetchBlogDocCount('보톡스', {
    env: ENV,
    fetchImpl,
    deadline: Date.now() - 1,
  });
  assert.equal(count, null);
  assert.equal(called, 0);
});

test('fetchBlogDocCount: deadline 여유가 있으면 정상 조회한다', async () => {
  const fetchImpl: typeof fetch = async () => okResponse({ total: 42 });

  const count = await fetchBlogDocCount('보톡스', {
    env: ENV,
    fetchImpl,
    deadline: Date.now() + 60_000,
  });
  assert.equal(count, 42);
});

test('fetchBlogDocCounts: deadline 소진 시 조회·재시도 모두 건너뛰고 null 유지', async () => {
  let called = 0;
  const fetchImpl: typeof fetch = async () => {
    called += 1;
    return okResponse({ total: 5 });
  };

  const out = await fetchBlogDocCounts(['보톡스', '필러'], {
    env: ENV,
    fetchImpl,
    deadline: Date.now() - 1,
    retryDelayMs: 0,
  });
  assert.deepEqual(out, { 보톡스: null, 필러: null });
  assert.equal(called, 0);
});
