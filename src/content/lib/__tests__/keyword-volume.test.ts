import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQcCount,
  parseKeywordVolumes,
  normalizeKeyword,
  buildSignature,
  buildSearchAdHeaders,
  readSearchAdCredentials,
  computeContentGaps,
  fetchKeywordVolumes,
} from '../keyword-volume.ts';

// ── parseQcCount: '< 10' → 5, 콤마/문자열/음수/비정상 처리 ──
test('parseQcCount: 숫자는 그대로', () => {
  assert.equal(parseQcCount(120), 120);
  assert.equal(parseQcCount(0), 0);
});

test("parseQcCount: '< 10' 문자열은 5", () => {
  assert.equal(parseQcCount('< 10'), 5);
  assert.equal(parseQcCount('<10'), 5);
});

test('parseQcCount: 콤마 포함 숫자문자열 파싱', () => {
  assert.equal(parseQcCount('1,200'), 1200);
});

test('parseQcCount: 음수/비정상은 0', () => {
  assert.equal(parseQcCount(-5), 0);
  assert.equal(parseQcCount('abc'), 0);
  assert.equal(parseQcCount(null), 0);
  assert.equal(parseQcCount(undefined), 0);
});

// ── normalizeKeyword ──
test('normalizeKeyword: 공백제거 + 대문자', () => {
  assert.equal(normalizeKeyword('보톡스 시술'), '보톡스시술');
  assert.equal(normalizeKeyword('  Laser  Toning '), 'LASERTONING');
});

// ── buildSignature: 공식 sample 포맷(base64 of hmac-sha256 raw digest) ──
test('buildSignature: 알려진 입력에 대해 결정적 base64', () => {
  const sig = buildSignature('1700000000000', 'GET', '/keywordstool', 'secret');
  // 정규식: base64 형태 + 결정적(동일 입력 동일 출력)
  assert.match(sig, /^[A-Za-z0-9+/]+=*$/);
  const sig2 = buildSignature('1700000000000', 'GET', '/keywordstool', 'secret');
  assert.equal(sig, sig2);
  // 메시지가 다르면 서명도 달라야 함
  const sig3 = buildSignature('1700000000001', 'GET', '/keywordstool', 'secret');
  assert.notEqual(sig, sig3);
});

// ── buildSearchAdHeaders ──
test('buildSearchAdHeaders: 4개 필수 헤더 구성', () => {
  const headers = buildSearchAdHeaders(
    { apiKey: 'key', secretKey: 'secret', customerId: '12345' },
    'GET',
    '/keywordstool',
    '1700000000000'
  );
  assert.equal(headers['X-API-KEY'], 'key');
  assert.equal(headers['X-Customer'], '12345');
  assert.equal(headers['X-Timestamp'], '1700000000000');
  assert.ok(headers['X-Signature'].length > 0);
});

// ── readSearchAdCredentials: 그레이스풀(하나라도 없으면 null) ──
test('readSearchAdCredentials: 전부 있으면 객체', () => {
  const creds = readSearchAdCredentials({
    NAVER_AD_API_KEY: 'a',
    NAVER_AD_SECRET_KEY: 'b',
    NAVER_AD_CUSTOMER_ID: 'c',
  } as NodeJS.ProcessEnv);
  assert.deepEqual(creds, { apiKey: 'a', secretKey: 'b', customerId: 'c' });
});

test('readSearchAdCredentials: 하나라도 없으면 null (throw 안 함)', () => {
  assert.equal(readSearchAdCredentials({ NAVER_AD_API_KEY: 'a' } as NodeJS.ProcessEnv), null);
  assert.equal(readSearchAdCredentials({} as NodeJS.ProcessEnv), null);
});

// ── parseKeywordVolumes ──
test('parseKeywordVolumes: 응답 매핑 + < 10 처리', () => {
  const list = [
    { relKeyword: '보톡스', monthlyPcQcCnt: 1000, monthlyMobileQcCnt: 5000, compIdx: '높음' },
    { relKeyword: '리프팅', monthlyPcQcCnt: '< 10', monthlyMobileQcCnt: 200, compIdx: '낮음' },
  ];
  const out = parseKeywordVolumes(list);
  assert.deepEqual(out['보톡스'], { pc: 1000, mobile: 5000, total: 6000, compIdx: '높음' });
  assert.deepEqual(out['리프팅'], { pc: 5, mobile: 200, total: 205, compIdx: '낮음' });
});

test('parseKeywordVolumes: requestedKeywords 필터 (공백/대소문자 무시)', () => {
  const list = [
    { relKeyword: '보톡스', monthlyPcQcCnt: 10, monthlyMobileQcCnt: 10, compIdx: '중간' },
    { relKeyword: '무관한키워드', monthlyPcQcCnt: 99, monthlyMobileQcCnt: 99, compIdx: '높음' },
  ];
  const out = parseKeywordVolumes(list, ['보톡스']);
  assert.ok(out['보톡스']);
  assert.equal(out['무관한키워드'], undefined);
});

test('parseKeywordVolumes: 배열 아니면 빈 객체', () => {
  assert.deepEqual(parseKeywordVolumes(null), {});
  assert.deepEqual(parseKeywordVolumes(undefined), {});
  assert.deepEqual(parseKeywordVolumes('nope'), {});
});

// ── computeContentGaps: 내가 안 쓴 주제만, 검색량 내림차순 ──
test('computeContentGaps: 이미 다룬 주제 제외 + 검색량 정렬', () => {
  const candidates = [
    { text: '보톡스 부작용', keyword: '보톡스' },
    { text: '리프팅 효과', keyword: '리프팅' },
    { text: '필러 종류', keyword: '필러' },
  ];
  const myCovered = ['보톡스 시술 후기']; // '보톡스' 커버됨 → 제외
  const volumes = {
    리프팅: { pc: 100, mobile: 100, total: 200, compIdx: '낮음' },
    필러: { pc: 500, mobile: 500, total: 1000, compIdx: '높음' },
  };
  const gaps = computeContentGaps(candidates, myCovered, volumes);
  // 보톡스 제외, 필러(1000) > 리프팅(200) 순
  assert.equal(gaps.length, 2);
  assert.equal(gaps[0].keyword, '필러');
  assert.equal(gaps[1].keyword, '리프팅');
});

test('computeContentGaps: 중복 후보 dedupe', () => {
  const candidates = [
    { text: '레이저 토닝', keyword: '레이저 토닝' },
    { text: '레이저토닝', keyword: '레이저토닝' }, // 정규화 동일
  ];
  const gaps = computeContentGaps(candidates, [], {});
  assert.equal(gaps.length, 1);
});

test('computeContentGaps: 검색량 없으면 입력 순서 유지(안정)', () => {
  const candidates = [
    { text: 'A주제', keyword: 'A' },
    { text: 'B주제', keyword: 'B' },
  ];
  const gaps = computeContentGaps(candidates, [], {});
  assert.equal(gaps[0].keyword, 'A');
  assert.equal(gaps[1].keyword, 'B');
  assert.equal(gaps[0].volume, null);
});

// ── fetchKeywordVolumes: 그레이스풀 분기 ──
test('fetchKeywordVolumes: 키 없으면 available:false (호출 안 함)', async () => {
  let called = false;
  const res = await fetchKeywordVolumes(['보톡스'], {
    env: {} as NodeJS.ProcessEnv,
    fetchImpl: (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch,
  });
  assert.equal(res.available, false);
  assert.deepEqual(res.volumes, {});
  assert.equal(called, false);
});

test('fetchKeywordVolumes: 빈 키워드면 available:true + 빈 volumes', async () => {
  const res = await fetchKeywordVolumes([], { env: {} as NodeJS.ProcessEnv });
  assert.equal(res.available, true);
  assert.deepEqual(res.volumes, {});
});

test('fetchKeywordVolumes: 키 있고 성공하면 파싱된 volumes', async () => {
  const env = {
    NAVER_AD_API_KEY: 'a',
    NAVER_AD_SECRET_KEY: 'b',
    NAVER_AD_CUSTOMER_ID: 'c',
  } as NodeJS.ProcessEnv;
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        keywordList: [
          { relKeyword: '보톡스', monthlyPcQcCnt: 100, monthlyMobileQcCnt: 900, compIdx: '높음' },
        ],
      }),
      { status: 200 }
    )) as unknown as typeof fetch;
  const res = await fetchKeywordVolumes(['보톡스'], { env, fetchImpl });
  assert.equal(res.available, true);
  assert.deepEqual(res.volumes['보톡스'], { pc: 100, mobile: 900, total: 1000, compIdx: '높음' });
});

test('fetchKeywordVolumes: 호출 실패(non-ok)는 available:false', async () => {
  const env = {
    NAVER_AD_API_KEY: 'a',
    NAVER_AD_SECRET_KEY: 'b',
    NAVER_AD_CUSTOMER_ID: 'c',
  } as NodeJS.ProcessEnv;
  const fetchImpl = (async () => new Response('err', { status: 401 })) as unknown as typeof fetch;
  const res = await fetchKeywordVolumes(['보톡스'], { env, fetchImpl });
  assert.equal(res.available, false);
  assert.deepEqual(res.volumes, {});
});

test('fetchKeywordVolumes: fetch throw 도 그레이스풀', async () => {
  const env = {
    NAVER_AD_API_KEY: 'a',
    NAVER_AD_SECRET_KEY: 'b',
    NAVER_AD_CUSTOMER_ID: 'c',
  } as NodeJS.ProcessEnv;
  const fetchImpl = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
  const res = await fetchKeywordVolumes(['보톡스'], { env, fetchImpl });
  assert.equal(res.available, false);
});
