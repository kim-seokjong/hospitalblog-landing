import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_SUBMIT_LIMIT,
  belongsToHost,
  buildIndexNowPayload,
  describeIndexNowStatus,
  indexNowKeyLocation,
  isIndexNowAccepted,
  isValidIndexNowKey,
} from '../indexnow.ts';

const HOST = 'myclinic.hospitalblog.kr';
const KEY = 'fa8c0a469da44e9b8f6a769f291829f5';

test('엔드포인트는 참여 검색엔진 전체로 전파되는 글로벌 주소다', () => {
  assert.equal(INDEXNOW_ENDPOINT, 'https://api.indexnow.org/indexnow');
});

test('isValidIndexNowKey: 8~128자 영숫자·하이픈만 통과 (공식 스펙)', () => {
  assert.equal(isValidIndexNowKey(KEY), true);
  assert.equal(isValidIndexNowKey('I-love-IndexNow-3000'), true);
  assert.equal(isValidIndexNowKey('a'.repeat(8)), true);
  assert.equal(isValidIndexNowKey('a'.repeat(128)), true);

  assert.equal(isValidIndexNowKey('short7c'), false);      // 7자
  assert.equal(isValidIndexNowKey('a'.repeat(129)), false); // 129자
  assert.equal(isValidIndexNowKey('has space key'), false);
  assert.equal(isValidIndexNowKey('under_score_key'), false);
  assert.equal(isValidIndexNowKey(null), false);
  assert.equal(isValidIndexNowKey(undefined), false);
  assert.equal(isValidIndexNowKey(12345678), false);
});

test('★ 키가 없으면 payload 가 null 이다 (조용히 건너뛰기 — 배포가 깨지면 안 됨)', () => {
  const urls = [`https://${HOST}/posts/abc`];
  assert.equal(buildIndexNowPayload({ host: HOST, key: null, urls }), null);
  assert.equal(buildIndexNowPayload({ host: HOST, key: undefined, urls }), null);
  assert.equal(buildIndexNowPayload({ host: HOST, key: '', urls }), null);
  // 형식이 어긋난 키도 제출하지 않는다 (403 을 유발할 뿐)
  assert.equal(buildIndexNowPayload({ host: HOST, key: 'bad key!', urls }), null);
});

test('buildIndexNowPayload: 스펙 필드명·keyLocation(호스트 루트)을 만든다', () => {
  const payload = buildIndexNowPayload({
    host: HOST,
    key: KEY,
    urls: [`https://${HOST}/`, `https://${HOST}/posts/abc`],
  });

  assert.ok(payload);
  assert.deepEqual(Object.keys(payload).sort(), ['host', 'key', 'keyLocation', 'urlList']);
  assert.equal(payload.host, HOST);
  assert.equal(payload.key, KEY);
  // ★ 서브도메인은 별개 호스트 → 자기 루트의 키 파일을 가리켜야 한다
  assert.equal(payload.keyLocation, `https://${HOST}/${KEY}.txt`);
  assert.deepEqual(payload.urlList, [`https://${HOST}/`, `https://${HOST}/posts/abc`]);
});

test('buildIndexNowPayload: 호스트가 다른 URL 은 제외한다 (422 방지)', () => {
  const payload = buildIndexNowPayload({
    host: HOST,
    key: KEY,
    urls: [
      'https://other.hospitalblog.kr/posts/x',
      'https://www.hospitalblog.kr/pricing',
      `https://${HOST}/posts/ok`,
    ],
  });
  assert.ok(payload);
  assert.deepEqual(payload.urlList, [`https://${HOST}/posts/ok`]);
});

test('buildIndexNowPayload: 유효 URL 이 하나도 없으면 null', () => {
  assert.equal(
    buildIndexNowPayload({ host: HOST, key: KEY, urls: ['https://example.com/a', 'not-a-url'] }),
    null,
  );
  assert.equal(buildIndexNowPayload({ host: HOST, key: KEY, urls: [] }), null);
});

test('buildIndexNowPayload: 호스트가 비어 있으면 null', () => {
  assert.equal(buildIndexNowPayload({ host: '', key: KEY, urls: [`https://${HOST}/`] }), null);
});

test('buildIndexNowPayload: 중복 URL 제거 + 상한 적용', () => {
  const dup = `https://${HOST}/posts/same`;
  const payload = buildIndexNowPayload({ host: HOST, key: KEY, urls: [dup, dup, dup] });
  assert.ok(payload);
  assert.equal(payload.urlList.length, 1);

  const many = Array.from({ length: INDEXNOW_SUBMIT_LIMIT + 20 }, (_, i) => `https://${HOST}/posts/${i}`);
  const capped = buildIndexNowPayload({ host: HOST, key: KEY, urls: many });
  assert.ok(capped);
  assert.equal(capped.urlList.length, INDEXNOW_SUBMIT_LIMIT);

  const limited = buildIndexNowPayload({ host: HOST, key: KEY, urls: many, limit: 5 });
  assert.ok(limited);
  assert.equal(limited.urlList.length, 5);
});

test('belongsToHost: https + 동일 호스트만 true', () => {
  assert.equal(belongsToHost(`https://${HOST}/a`, HOST), true);
  assert.equal(belongsToHost(`https://${HOST.toUpperCase()}/a`, HOST), true);
  assert.equal(belongsToHost(`http://${HOST}/a`, HOST), false);
  assert.equal(belongsToHost('https://evil.com/a', HOST), false);
  assert.equal(belongsToHost('garbage', HOST), false);
});

test('indexNowKeyLocation: 호스트 루트 경로 (Option 1 — 공식 권장)', () => {
  assert.equal(indexNowKeyLocation(HOST, KEY), `https://${HOST}/${KEY}.txt`);
});

test('isIndexNowAccepted: 200·202 만 접수로 본다 (202 = 키 검증 대기)', () => {
  assert.equal(isIndexNowAccepted(200), true);
  assert.equal(isIndexNowAccepted(202), true);
  assert.equal(isIndexNowAccepted(400), false);
  assert.equal(isIndexNowAccepted(403), false);
  assert.equal(isIndexNowAccepted(422), false);
  assert.equal(isIndexNowAccepted(429), false);
});

test('describeIndexNowStatus: 스펙 표의 실패 사유를 문자열로 남긴다', () => {
  assert.match(describeIndexNowStatus(403), /key/i);
  assert.match(describeIndexNowStatus(422), /host/i);
  assert.match(describeIndexNowStatus(429), /many/i);
  assert.match(describeIndexNowStatus(500), /Unexpected/);
});
