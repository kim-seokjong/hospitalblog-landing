import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBlogCheckFeed,
  parsePubDate,
  extractMobileBody,
  fetchBlogCheckFeed,
  fetchLatestBodies,
} from '../blog-check-rss.ts';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title><![CDATA[광화문정형외과 공식블로그]]></title>
<link>https://blog.naver.com/testclinic</link>
<item>
<title><![CDATA[수성구 도수치료 어디서 받을까]]></title>
<link>https://blog.naver.com/testclinic/223999888</link>
<description><![CDATA[<p>본문 일부</p>]]></description>
<category><![CDATA[도수치료]]></category>
<pubDate>Mon, 14 Jul 2026 09:00:00 +0900</pubDate>
</item>
<item>
<title>허리디스크 비수술 치료 &amp; 재활</title>
<link>https://blog.naver.com/testclinic/223999777</link>
<category>척추</category>
<pubDate>invalid-date</pubDate>
</item>
</channel>
</rss>`;

// ── parseBlogCheckFeed ──
test('parseBlogCheckFeed: 채널 제목·item(제목/링크/logNo/발행일/카테고리) 파싱', () => {
  const feed = parseBlogCheckFeed(SAMPLE_RSS);
  assert.equal(feed.blogTitle, '광화문정형외과 공식블로그');
  assert.equal(feed.items.length, 2);

  const [first, second] = feed.items;
  assert.equal(first.title, '수성구 도수치료 어디서 받을까');
  assert.equal(first.logNo, '223999888');
  assert.equal(first.category, '도수치료');
  assert.ok(first.publishedAt?.startsWith('2026-07-14'));

  assert.equal(second.title, '허리디스크 비수술 치료 & 재활');
  assert.equal(second.publishedAt, null); // 파싱 불가 → null (graceful)
});

test('parseBlogCheckFeed: limit 만큼만, 빈/비정상 입력은 빈 피드', () => {
  assert.equal(parseBlogCheckFeed(SAMPLE_RSS, 1).items.length, 1);
  assert.deepEqual(parseBlogCheckFeed(''), { blogTitle: '', items: [] });
  assert.deepEqual(parseBlogCheckFeed('<html>not rss</html>').items, []);
});

// ── parsePubDate ──
test('parsePubDate: RFC822 → ISO, 실패 시 null', () => {
  assert.ok(parsePubDate('Mon, 14 Jul 2026 09:00:00 +0900')?.includes('2026-07-14'));
  assert.equal(parsePubDate('nonsense'), null);
  assert.equal(parsePubDate(''), null);
});

// ── extractMobileBody ──
test('extractMobileBody: se-main-container 영역 우선 추출', () => {
  const html = `<html><body>
    <div class="header">헤더 메뉴 텍스트</div>
    <div class="se-main-container"><p>진료실에서 자주 받는 질문을 정리했습니다.</p><p>도수치료는 개인차가 있습니다.</p></div></div>
    <div class="footer">푸터</div>
  </body></html>`;
  const body = extractMobileBody(html);
  assert.ok(body.includes('진료실에서 자주 받는 질문'));
  assert.ok(!body.includes('푸터'));
});

test('extractMobileBody: maxChars 상한·비정상 입력 방어', () => {
  assert.equal(extractMobileBody(''), '');
  const long = `<div class="se-main-container"><p>${'가'.repeat(9000)}</p></div></div>`;
  assert.ok(extractMobileBody(long, 100).length <= 100);
});

// ── fetchBlogCheckFeed (fetch 모킹) ──
function mockFetch(handler: (url: string) => { status: number; body: string } | null): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const res = handler(url);
    if (!res) throw new Error(`unexpected fetch: ${url}`);
    return new Response(res.body, { status: res.status });
  }) as typeof fetch;
}

test('fetchBlogCheckFeed: 정상 수집', async () => {
  const result = await fetchBlogCheckFeed('testclinic', {
    fetchImpl: mockFetch((url) =>
      url === 'https://rss.blog.naver.com/testclinic.xml'
        ? { status: 200, body: SAMPLE_RSS }
        : null,
    ),
  });
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.feed.items.length, 2);
});

test('fetchBlogCheckFeed: 404/네트워크 오류 → fetch_failed (never throws)', async () => {
  const notFound = await fetchBlogCheckFeed('testclinic', {
    fetchImpl: mockFetch(() => ({ status: 404, body: 'not found' })),
  });
  assert.deepEqual(notFound, { ok: false, reason: 'fetch_failed' });

  const netError = await fetchBlogCheckFeed('testclinic', {
    fetchImpl: (async () => {
      throw new Error('boom');
    }) as typeof fetch,
  });
  assert.deepEqual(netError, { ok: false, reason: 'fetch_failed' });
});

test('fetchBlogCheckFeed: 글 0편 → empty, 잘못된 ID → invalid_id (fetch 미발생)', async () => {
  const empty = await fetchBlogCheckFeed('testclinic', {
    fetchImpl: mockFetch(() => ({ status: 200, body: '<rss><channel><title>x</title></channel></rss>' })),
  });
  assert.deepEqual(empty, { ok: false, reason: 'empty' });

  const invalid = await fetchBlogCheckFeed('INVALID ID!', {
    fetchImpl: (async () => {
      throw new Error('should not fetch');
    }) as typeof fetch,
  });
  assert.deepEqual(invalid, { ok: false, reason: 'invalid_id' });
});

// ── 리다이렉트 수동 추적 (고정 호스트 불변식) ──
test('fetchLatestBodies: 허용 호스트로의 리다이렉트는 추적, 비허용(evil)으로의 리다이렉트는 스킵', async () => {
  const feed = parseBlogCheckFeed(SAMPLE_RSS);
  const bodyHtml = `<div class="se-main-container"><p>${'도수치료 안내 문장입니다. '.repeat(10)}</p></div></div>`;

  // 1) 허용 호스트 내부 리다이렉트 → 최종 본문 수집 성공
  const followed = await fetchLatestBodies('testclinic', feed.items.slice(0, 1), {
    fetchImpl: (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://m.blog.naver.com/testclinic/223999888') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://m.blog.naver.com/PostView.naver?blogId=testclinic&logNo=223999888' },
        });
      }
      return new Response(bodyHtml, { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(followed.length, 1);

  // 2) 허용 밖(evil.com) 리다이렉트 → 자동 추적 없이 해당 항목 스킵
  const blocked = await fetchLatestBodies('testclinic', feed.items.slice(0, 1), {
    fetchImpl: (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://evil.com/steal' },
      })) as typeof fetch,
  });
  assert.equal(blocked.length, 0);
});

test('safeFetch 체인: 홉마다 타이머 리셋 없이 단일 AbortSignal(절대 데드라인) 공유', async () => {
  // 302 → 302 → 200 3홉 체인. 모든 홉의 fetch 가 "같은" AbortSignal 인스턴스를
  // 받아야 한다 — 컨트롤러·타이머가 1개라는 뜻이고, 총 소요가 timeoutMs 를
  // 넘을 수 없다 (홉마다 새 타이머면 최악 (홉수+1)×timeoutMs 로 늘어난다).
  const feed = parseBlogCheckFeed(SAMPLE_RSS);
  const bodyHtml = `<div class="se-main-container"><p>${'도수치료 안내 문장입니다. '.repeat(10)}</p></div></div>`;
  const signals: Array<AbortSignal | null | undefined> = [];
  let hop = 0;

  const bodies = await fetchLatestBodies('testclinic', feed.items.slice(0, 1), {
    fetchImpl: (async (_input: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal);
      hop += 1;
      if (hop <= 2) {
        return new Response(null, {
          status: 302,
          headers: { location: `https://m.blog.naver.com/testclinic/hop${hop}` },
        });
      }
      return new Response(bodyHtml, { status: 200 });
    }) as typeof fetch,
  });

  assert.equal(bodies.length, 1);
  assert.equal(signals.length, 3);
  assert.ok(signals[0] instanceof AbortSignal);
  assert.equal(signals[0], signals[1]); // 동일 인스턴스 = 단일 컨트롤러
  assert.equal(signals[1], signals[2]);
});

// ── fetchLatestBodies ──
test('fetchLatestBodies: 모바일 URL 로 본문 수집, 실패 글은 건너뜀', async () => {
  const feed = parseBlogCheckFeed(SAMPLE_RSS);
  const bodyHtml = `<div class="se-main-container"><p>${'도수치료 안내 문장입니다. '.repeat(10)}</p></div></div>`;
  const bodies = await fetchLatestBodies('testclinic', feed.items, {
    fetchImpl: mockFetch((url) => {
      if (url === 'https://m.blog.naver.com/testclinic/223999888') {
        return { status: 200, body: bodyHtml };
      }
      return { status: 500, body: 'error' };
    }),
  });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].title, '수성구 도수치료 어디서 받을까');
  assert.ok(bodies[0].body.includes('도수치료 안내'));
});
