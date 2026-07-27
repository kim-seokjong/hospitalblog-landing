import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brandTokensFromHost,
  hostOf,
  isOwnedDoc,
  isThirdPartyDoc,
  MAX_ACCEPTED_PER_PLATFORM,
  mentionsClinicName,
  parseWebSearch,
  pickSearchedSocialLinks,
  searchSocialAccounts,
  type WebDoc,
} from '../social-search.ts';

/**
 * 네이버 웹문서 검색으로 인스타 계정을 찾는 우회로 검증.
 *
 * ★ 이 파일의 절반은 **오탐 방어 테스트**다. 실측 데이터를 그대로 케이스로 옮겼다:
 *   "한피부과의원 인스타그램" 검색 1위가 @oaro_skyl65(무관한 병원)였고,
 *   @woo.hann_skin_clinic 처럼 발음만 비슷한 남의 병원도 상위에 있었다.
 *   이런 것을 하나라도 채택하면 원장에게 남의 계정을 "원장님 인스타"로 보여주게 된다.
 */

const PROFILE_DOC = (handle: string, title?: string): WebDoc => ({
  title: title ?? `@${handle} - Instagram`,
  description: `@${handle}의 최신 포스트를 확인하세요.`,
  link: `https://www.instagram.com/${handle}/`,
});

/* ── 파싱 ──────────────────────────────────────────────── */

test('webkr 응답을 파싱하고 강조 태그를 걷어낸다', () => {
  const docs = parseWebSearch({
    items: [
      { title: '<b>엣지성형외과</b> 인스타', description: 'a &amp; b', link: 'https://edge1.co.kr/' },
      { nope: 1 },
      null,
    ],
  });
  assert.equal(docs.length, 2, 'null 항목은 버린다');
  assert.equal(docs[0].title, '엣지성형외과 인스타');
  assert.equal(docs[0].description, 'a & b');
});

test('망가진 응답에도 죽지 않는다', () => {
  assert.deepEqual(parseWebSearch(null), []);
  assert.deepEqual(parseWebSearch({ items: 'nope' }), []);
  assert.deepEqual(parseWebSearch('문자열'), []);
});

/* ── 브랜드 토큰 ───────────────────────────────────────── */

test('병원 도메인에서 계정 대조용 토큰을 뽑는다 (끝자리 숫자 제거)', () => {
  assert.deepEqual(brandTokensFromHost('edge1.co.kr'), ['edge']);
  assert.deepEqual(brandTokensFromHost('www.vbeauty.co.kr'), ['vbeauty']);
  assert.deepEqual(brandTokensFromHost('https://www.prive.co.kr/'), ['prive']);
});

test('일반명사 도메인 라벨은 토큰으로 쓰지 않는다 — 남의 병원 계정이 전부 걸린다', () => {
  assert.deepEqual(brandTokensFromHost('clinic.co.kr'), []);
  assert.deepEqual(brandTokensFromHost('skin.com'), []);
  assert.deepEqual(brandTokensFromHost(''), []);
  assert.deepEqual(brandTokensFromHost(null), []);
  // 3자 이하도 버린다(우연히 남의 아이디에 들어간다)
  assert.deepEqual(brandTokensFromHost('abc.co.kr'), []);
});

test('hostOf 는 못 읽는 주소를 빈 문자열로 돌린다', () => {
  assert.equal(hostOf('https://www.edge1.co.kr/a/b'), 'edge1.co.kr');
  assert.equal(hostOf('없는주소'), '');
  assert.equal(hostOf(''), '');
});

/* ── 문서 판정 ─────────────────────────────────────────── */

test('병원 홈페이지·병원 블로그 문서는 소유 문서로 본다', () => {
  const context = { name: '엣지성형외과의원', siteHost: 'edge1.co.kr', blogId: 'edgeblog' };
  assert.ok(isOwnedDoc({ title: '', description: '', link: 'https://edge1.co.kr/sub' }, context));
  assert.ok(isOwnedDoc({ title: '', description: '', link: 'https://m.edge1.co.kr/x' }, context));
  assert.ok(
    isOwnedDoc({ title: '', description: '', link: 'https://blog.naver.com/edgeblog/223' }, context),
  );
  // 남의 블로그는 소유가 아니다
  assert.equal(
    isOwnedDoc({ title: '', description: '', link: 'https://blog.naver.com/someoneelse/223' }, context),
    false,
  );
});

test('제3자 매체 판정 — 출처를 모르는 문서도 제3자로 본다', () => {
  assert.ok(isThirdPartyDoc({ title: '', description: '', link: 'https://blog.naver.com/x/1' }));
  assert.ok(isThirdPartyDoc({ title: '', description: '', link: 'https://babitalk.com/hospitals/1' }));
  assert.ok(isThirdPartyDoc({ title: '', description: '', link: '' }));
  assert.equal(isThirdPartyDoc({ title: '', description: '', link: 'https://edge1.co.kr/' }), false);
});

test('병원 이름 대조는 접미사를 떼고도 본다', () => {
  const doc = { title: '리팅성형외과 리얼모델 촬영', description: '', link: 'https://liting.co.kr/1' };
  assert.ok(mentionsClinicName(doc, '리팅성형외과의원'));
  assert.equal(mentionsClinicName(doc, '엣지성형외과의원'), false);
});

/* ── ★ 채택 규칙 (오탐 방어) ───────────────────────────── */

test('★계정 아이디가 병원 도메인 이름을 담고 있으면 채택한다 (실측: edge1.co.kr → @edge__ps)', () => {
  const docs: WebDoc[] = [
    PROFILE_DOC('edge__ps'),
    PROFILE_DOC('wooa_ps'),
    PROFILE_DOC('marqps6', '이재준 - Instagram'),
  ];
  const links = pickSearchedSocialLinks(docs, { name: '엣지성형외과의원', siteHost: 'edge1.co.kr' });
  assert.equal(links.length, 1);
  assert.equal(links[0].handle, 'edge__ps');
  assert.equal(links[0].source, 'naver_search');
  assert.equal(links[0].kind, 'channel');
});

test('★관계없는 병원 계정은 채택하지 않는다 — 1위여도 버린다 (실측: 한피부과의원)', () => {
  const docs: WebDoc[] = [
    PROFILE_DOC('oaro_skyl65'),
    PROFILE_DOC('woo.hann_skin_clinic'), // 발음만 비슷한 남의 병원
    PROFILE_DOC('dr.cleanup'),
    PROFILE_DOC('haneul_ps'),
  ];
  const links = pickSearchedSocialLinks(docs, { name: '한피부과의원', siteHost: null });
  assert.deepEqual(links, [], '확신이 없으면 "확인되지 않음"이 틀린 계정보다 낫다');
});

test('★게시물·릴스·예약어 경로는 계정으로 채택하지 않는다', () => {
  const docs: WebDoc[] = [
    { title: '엣지성형외과의원 후기', description: 'https://www.instagram.com/p/CxYz123/', link: 'https://edge1.co.kr/r' },
    { title: '엣지성형외과의원 릴스', description: 'https://www.instagram.com/reel/AAA/', link: 'https://edge1.co.kr/r2' },
    { title: '엣지성형외과의원', description: 'https://www.instagram.com/explore/tags/코성형/', link: 'https://edge1.co.kr/r3' },
    { title: '엣지성형외과의원', description: 'https://www.instagram.com/about/', link: 'https://edge1.co.kr/r4' },
  ];
  const links = pickSearchedSocialLinks(docs, { name: '엣지성형외과의원', siteHost: 'edge1.co.kr' });
  assert.deepEqual(links, []);
});

test('병원 소유 문서(홈페이지·자기 블로그)에 적힌 계정은 채택한다', () => {
  const docs: WebDoc[] = [
    {
      title: '리팅성형외과의원 스토리채널',
      description: '인스타그램 : https://www.instagram.com/liting_ps/',
      link: 'https://liting.co.kr/story',
    },
  ];
  const links = pickSearchedSocialLinks(docs, { name: '리팅성형외과의원', siteHost: 'liting.co.kr' });
  assert.equal(links.length, 1);
  assert.equal(links[0].handle, 'liting_ps');
});

test('★남의 블로그 글에 적힌 계정은 병원 이름이 나와도 채택하지 않는다 (글쓴이 계정일 수 있다)', () => {
  const docs: WebDoc[] = [
    {
      title: '엣지성형외과의원 상담 후기',
      description: '제 인스타 https://www.instagram.com/blogger_daily/ 도 놀러오세요',
      link: 'https://blog.naver.com/someone/2242',
    },
  ];
  const links = pickSearchedSocialLinks(docs, { name: '엣지성형외과의원', siteHost: null, blogId: 'edgeblog' });
  assert.deepEqual(links, []);
});

test('★체험단·협찬 글의 계정은 채택하지 않는다', () => {
  const docs: WebDoc[] = [
    {
      title: '엣지성형외과의원 체험단 후기',
      description: '소정의 원고료를 제공받아 작성 https://www.instagram.com/review_kim/',
      link: 'https://sungyesa.com/hlist/1',
    },
  ];
  const links = pickSearchedSocialLinks(docs, { name: '엣지성형외과의원', siteHost: null });
  assert.deepEqual(links, []);
});

test('계정 프로필 페이지 제목에 병원 이름이 있으면 채택한다 (도메인을 몰라도)', () => {
  const docs: WebDoc[] = [
    PROFILE_DOC('edge__ps', '대구엣지성형외과 (@edge__ps) - Instagram'),
    PROFILE_DOC('wooa_ps'),
  ];
  const links = pickSearchedSocialLinks(docs, { name: '엣지성형외과의원', siteHost: null });
  assert.equal(links.length, 1);
  assert.equal(links[0].handle, 'edge__ps');
});

test('유튜브 채널도 같은 규칙으로만 채택한다', () => {
  const docs: WebDoc[] = [
    {
      title: '앤드성형외과의원 [ 눈서코TV ] - YouTube',
      description: '약 5.1천 명의 구독자',
      link: 'https://www.youtube.com/channel/UCoFCLS9LbZgksgrHbIgJ0w',
    },
    {
      title: '엣지성형외과의원 유튜브',
      description: 'https://www.youtube.com/@edge0501',
      link: 'https://edge1.co.kr/tv',
    },
  ];
  const links = pickSearchedSocialLinks(docs, { name: '엣지성형외과의원', siteHost: 'edge1.co.kr' });
  assert.equal(links.length, 1);
  assert.equal(links[0].platform, 'youtube');
  assert.equal(links[0].handle, '@edge0501');
});

test('한 플랫폼에서 너무 많이 채택하지 않는다', () => {
  const docs: WebDoc[] = Array.from({ length: 6 }, (_, i) => ({
    title: `엣지성형외과의원 소식 ${i}`,
    description: `https://www.instagram.com/edge_${i}/`,
    link: `https://edge1.co.kr/n/${i}`,
  }));
  const links = pickSearchedSocialLinks(docs, { name: '엣지성형외과의원', siteHost: 'edge1.co.kr' });
  assert.ok(links.length <= MAX_ACCEPTED_PER_PLATFORM);
});

test('빈 입력에도 죽지 않는다', () => {
  assert.deepEqual(pickSearchedSocialLinks([], { name: '엣지성형외과의원' }), []);
});

/* ── 호출 ──────────────────────────────────────────────── */

const ENV = { NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' };

test('네이버 검색은 병원당 정확히 1회만 부른다', async () => {
  let calls = 0;
  const seen: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls += 1;
    seen.push(String(url));
    return new Response(JSON.stringify({ items: [ { title: '@edge__ps - Instagram', description: '', link: 'https://www.instagram.com/edge__ps/' } ] }), { status: 200 });
  }) as unknown as typeof fetch;

  const result = await searchSocialAccounts(
    { name: '엣지성형외과의원', siteHost: 'edge1.co.kr' },
    { env: ENV, fetchImpl },
  );
  assert.equal(calls, 1);
  assert.ok(seen[0].includes('webkr.json'));
  const query = new URL(seen[0]).searchParams.get('query');
  assert.equal(query, '엣지성형외과의원 인스타그램');
  assert.equal(result.called, true);
  assert.equal(result.links[0].handle, 'edge__ps');
});

test('키가 없으면 네트워크를 타지 않는다', async () => {
  const fetchImpl = (async () => {
    throw new Error('불러선 안 된다');
  }) as unknown as typeof fetch;
  const result = await searchSocialAccounts({ name: '엣지성형외과의원' }, { env: {}, fetchImpl });
  assert.deepEqual(result, { called: false, links: [] });
});

test('★검색이 실패해도 진단은 계속된다 (throw 하지 않는다)', async () => {
  const boom = (async () => {
    throw new Error('네트워크 폭발');
  }) as unknown as typeof fetch;
  const result = await searchSocialAccounts({ name: '엣지성형외과의원' }, { env: ENV, fetchImpl: boom });
  assert.deepEqual(result, { called: false, links: [] });

  const bad = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
  const failed = await searchSocialAccounts({ name: '엣지성형외과의원' }, { env: ENV, fetchImpl: bad });
  assert.deepEqual(failed, { called: true, links: [] });

  const garbage = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
  const parsed = await searchSocialAccounts({ name: '엣지성형외과의원' }, { env: ENV, fetchImpl: garbage });
  assert.deepEqual(parsed.links, []);
});

test('타임아웃이 걸려도 빈 결과로 끝난다', async () => {
  const hang = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
  const result = await searchSocialAccounts(
    { name: '엣지성형외과의원' },
    { env: ENV, fetchImpl: hang, timeoutMs: 10 },
  );
  assert.deepEqual(result, { called: false, links: [] });
});
