import test from 'node:test';
import assert from 'node:assert/strict';
import { findClinicSiteUrl, parseLocalSearch, pickMatchingPlace, type LocalPlace } from '../naver-local.ts';

function place(over: Partial<LocalPlace>): LocalPlace {
  return { name: '', category: '', roadAddress: '', address: '', link: '', ...over };
}

const VB = place({
  name: '브이비성형외과의원',
  category: '병원,의원>성형외과',
  roadAddress: '대구광역시 중구 공평로10길 18 7층',
  address: '대구광역시 중구 삼덕동2가 17-1 7층',
  link: 'https://vb.vbeauty.co.kr/',
});

test('parseLocalSearch 는 <b> 강조를 걷어내고 필요한 필드만 남긴다', () => {
  const parsed = parseLocalSearch({
    items: [{ title: '<b>브이비성형외과의원</b>', link: 'https://vb.vbeauty.co.kr/', roadAddress: '대구광역시 중구 공평로10길 18' }],
  });
  assert.equal(parsed[0].name, '브이비성형외과의원');
  assert.equal(parsed[0].link, 'https://vb.vbeauty.co.kr/');
});

test('parseLocalSearch 는 형태가 어긋나면 빈 배열 (throw 금지)', () => {
  for (const bad of [null, undefined, 'x', 1, {}, { items: 'x' }]) assert.deepEqual(parseLocalSearch(bad), []);
});

test('pickMatchingPlace 는 상호가 정확히 일치할 때만 채택한다', () => {
  assert.equal(pickMatchingPlace([VB], '브이비성형외과의원', '중구')?.link, 'https://vb.vbeauty.co.kr/');
  // 공백 표기가 달라도 정규화 일치면 채택
  assert.ok(pickMatchingPlace([place({ ...VB, name: '플로르 성형외과 의원' })], '플로르성형외과의원', '중구'));
  // 이름이 다르면 절대 채택하지 않는다 (남의 홈페이지를 붙이지 않는다)
  assert.equal(pickMatchingPlace([VB], '다른성형외과의원', '중구'), null);
});

test('pickMatchingPlace 는 지역이 다르면 채택하지 않는다 (동명 타 지역 병원 방어)', () => {
  const seoul = place({ ...VB, roadAddress: '서울특별시 강남구 논현로 873', address: '서울특별시 강남구 신사동' });
  assert.equal(pickMatchingPlace([seoul], '브이비성형외과의원', '중구'), null);
  // 지역 힌트가 없으면 지역 검사를 생략한다
  assert.ok(pickMatchingPlace([seoul], '브이비성형외과의원', ''));
});

test('findClinicSiteUrl: 상호 단독 질의를 먼저 한다 (지역을 앞에 붙이면 0건이 나오는 실측 대응)', async () => {
  const queries: string[] = [];
  const fetchImpl = (async (url: string) => {
    const q = new URL(url).searchParams.get('query') ?? '';
    queries.push(q);
    // 실측 재현: "중구 브이비성형외과의원" 은 0건, 상호 단독은 1건
    const items = q === '브이비성형외과의원' ? [{ title: '<b>브이비성형외과의원</b>', link: VB.link, roadAddress: VB.roadAddress }] : [];
    return new Response(JSON.stringify({ items }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  const url = await findClinicSiteUrl('브이비성형외과의원', '중구', {
    env: { NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' }, fetchImpl,
  });
  assert.equal(url, 'https://vb.vbeauty.co.kr/');
  assert.equal(queries[0], '브이비성형외과의원', '첫 질의는 상호 단독이어야 한다');
  assert.equal(queries.length, 1, '첫 질의에서 찾았으면 추가 호출하지 않는다');
});

test('findClinicSiteUrl: 상호 단독으로 못 찾으면 지역을 붙여 한 번 더 본다 (최대 2콜)', async () => {
  const queries: string[] = [];
  const fetchImpl = (async (url: string) => {
    const q = new URL(url).searchParams.get('query') ?? '';
    queries.push(q);
    const items = q.startsWith('중구 ') ? [{ title: '브이비성형외과의원', link: VB.link, roadAddress: VB.roadAddress }] : [];
    return new Response(JSON.stringify({ items }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  const url = await findClinicSiteUrl('브이비성형외과의원', '중구', {
    env: { NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' }, fetchImpl,
  });
  assert.equal(url, VB.link);
  assert.equal(queries.length, 2);
});

test('findClinicSiteUrl: 이름이 안 맞으면 링크가 있어도 쓰지 않는다', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ items: [{ title: '전혀다른의원', link: 'https://other.co.kr', roadAddress: '대구광역시 중구' }] }), {
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  const url = await findClinicSiteUrl('브이비성형외과의원', '중구', {
    env: { NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' }, fetchImpl,
  });
  assert.equal(url, null);
});

test('findClinicSiteUrl: 키가 없거나 호출이 실패하면 null (throw 금지)', async () => {
  assert.equal(await findClinicSiteUrl('브이비성형외과의원', '중구', { env: {} }), null);
  assert.equal(
    await findClinicSiteUrl('브이비성형외과의원', '중구', {
      env: { NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' },
      fetchImpl: (async () => { throw new Error('down'); }) as unknown as typeof fetch,
    }),
    null,
  );
});
