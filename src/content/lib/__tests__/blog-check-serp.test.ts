import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBlogSearch,
  fetchKeywordSerp,
  fetchKeywordSerps,
} from '../blog-check-serp.ts';

const ENV = {
  NAVER_CLIENT_ID: 'id',
  NAVER_CLIENT_SECRET: 'secret',
} as NodeJS.ProcessEnv;

// ── parseBlogSearch ──
test('parseBlogSearch: total + bloggerlink/link 로 순위 탐색', () => {
  const data = {
    total: 12345,
    items: [
      { link: 'https://blog.naver.com/other1/1', bloggerlink: 'blog.naver.com/other1' },
      { link: 'https://blog.naver.com/florps1/223', bloggerlink: 'blog.naver.com/florps1' },
    ],
  };
  assert.deepEqual(parseBlogSearch(data, 'florps1'), { docCount: 12345, rank: 2 });
});

test('parseBlogSearch: 미노출 → rank null, blogId 부분문자열 오매칭 방지', () => {
  const data = {
    total: 10,
    items: [{ link: 'https://blog.naver.com/florps12/1', bloggerlink: 'blog.naver.com/florps12' }],
  };
  assert.deepEqual(parseBlogSearch(data, 'florps1'), { docCount: 10, rank: null });
});

test('parseBlogSearch: 비정상 응답 → 전부 null (never throws)', () => {
  assert.deepEqual(parseBlogSearch(null, 'a'), { docCount: null, rank: null });
  assert.deepEqual(parseBlogSearch({ total: -1, items: 'x' }, 'a'), { docCount: null, rank: null });
  assert.deepEqual(parseBlogSearch({ total: 5 }, 'a'), { docCount: 5, rank: null });
});

// ── fetchKeywordSerp ──
function jsonFetch(body: unknown, capture?: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    capture?.push(String(input));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

test('fetchKeywordSerp: display=100 1콜로 문서수+순위 동시 조회', async () => {
  const urls: string[] = [];
  const out = await fetchKeywordSerp('수성구 도수치료', 'florps1', {
    env: ENV,
    fetchImpl: jsonFetch(
      {
        total: 999,
        items: [{ link: 'https://blog.naver.com/florps1/223', bloggerlink: 'blog.naver.com/florps1' }],
      },
      urls,
    ),
  });
  assert.deepEqual(out, { docCount: 999, rank: 1 });
  assert.ok(urls[0].includes('display=100'));
  assert.ok(urls[0].startsWith('https://openapi.naver.com/v1/search/blog.json'));
});

test('fetchKeywordSerp: 키 없음/실패/마감 초과 → null 필드 (never throws)', async () => {
  const noCreds = await fetchKeywordSerp('kw', 'id1', { env: {} as NodeJS.ProcessEnv });
  assert.deepEqual(noCreds, { docCount: null, rank: null });

  const failed = await fetchKeywordSerp('kw', 'id1', {
    env: ENV,
    fetchImpl: (async () => {
      throw new Error('down');
    }) as typeof fetch,
  });
  assert.deepEqual(failed, { docCount: null, rank: null });

  const expired = await fetchKeywordSerp('kw', 'id1', {
    env: ENV,
    fetchImpl: jsonFetch({ total: 1, items: [] }),
    deadline: Date.now() - 1000,
  });
  assert.deepEqual(expired, { docCount: null, rank: null });
});

// ── fetchKeywordSerps ──
test('fetchKeywordSerps: 전체 키워드에 대해 결과 맵 반환 (실패 키워드는 null 유지)', async () => {
  const out = await fetchKeywordSerps(['kw1', 'kw2'], 'florps1', {
    env: ENV,
    fetchImpl: jsonFetch({ total: 7, items: [] }),
  });
  assert.deepEqual(out.kw1, { docCount: 7, rank: null });
  assert.deepEqual(out.kw2, { docCount: 7, rank: null });
});

test('fetchKeywordSerps: deadline 소진 시 남은 키워드는 null (그레이스풀)', async () => {
  const out = await fetchKeywordSerps(['kw1', 'kw2'], 'florps1', {
    env: ENV,
    fetchImpl: jsonFetch({ total: 7, items: [] }),
    deadline: Date.now() - 1,
  });
  assert.deepEqual(out.kw1, { docCount: null, rank: null });
  assert.deepEqual(out.kw2, { docCount: null, rank: null });
});
