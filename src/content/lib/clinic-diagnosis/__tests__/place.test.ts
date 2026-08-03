import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlaceScopes,
  extractDong,
  findClinicRank,
  MAX_PLACE_KEYWORDS,
  parsePlaceListings,
  parsePlaceProfile,
  PLACE_TOP_N,
  placeDetailUrl,
  placeSearchUrl,
  sanitizePlaceKeywords,
} from '../place.ts';

/**
 * 픽스처는 **2026-08-03 실제 응답**에서 뽑았다 ("범어동 치과" 검색 / 서울베리굿치과의원 상세).
 * 네이버가 마크업을 바꾸면 이 테스트가 먼저 깨져야 한다 — 진단이 조용히 빈 값을
 * 내보내는 것보다 낫다.
 */
const SEARCH_HTML = `
<a href="https://m.place.naver.com/hospital/2044998731/home">1</a>
<a href="https://m.place.naver.com/hospital/2044998731/review">중복</a>
<a href="https://m.place.naver.com/hospital/33417952/home">2</a>
<a href="https://m.place.naver.com/hospital/37485866/home">3</a>
<a href="https://m.place.naver.com/hospital/1299497887/home">4</a>
<a href="https://m.place.naver.com/hospital/1508543146/home">5</a>
<a href="https://m.place.naver.com/hospital/9999999999/home">6</a>
<script>window.__APOLLO_STATE__ = {
"HospitalSummary:2044998731":{"__typename":"HospitalSummary","id":"2044998731","name":"서울베리굿치과의원","hasBooking":true},
"HospitalSummary:33417952":{"__typename":"HospitalSummary","id":"33417952","name":"라온치과병원"},
"HospitalSummary:37485866":{"__typename":"HospitalSummary","id":"37485866","name":"라온미소치과의원"},
"HospitalSummary:1299497887":{"__typename":"HospitalSummary","id":"1299497887","name":"서울탑플란트치과의원"},
"HospitalSummary:1508543146":{"__typename":"HospitalSummary","id":"1508543146","name":"범어스카이치과교정과치과의원"}
};</script>`;

const DETAIL_HTML = `window.__APOLLO_STATE__ = {"PlaceDetailBase:2044998731":{"category":"치과",
"keywordList":["임플란트","레진빌드업충치치료","수성구범어동치과","치아미백라미네이트","턱관절물리치료"]}};`;

test('검색 HTML → 노출 순서대로 병원 목록', () => {
  const list = parsePlaceListings(SEARCH_HTML);
  assert.equal(list.length, PLACE_TOP_N);
  assert.deepEqual(
    list.map((p) => p.name),
    [
      '서울베리굿치과의원',
      '라온치과병원',
      '라온미소치과의원',
      '서울탑플란트치과의원',
      '범어스카이치과교정과치과의원',
    ],
  );
});

/** 같은 병원의 링크가 여러 번 나와도 순위가 밀리면 안 된다. */
test('중복 링크는 순위를 밀지 않는다', () => {
  const list = parsePlaceListings(SEARCH_HTML);
  assert.equal(list[1].name, '라온치과병원');
});

test('상위 N 을 넘겨 담지 않는다', () => {
  assert.equal(parsePlaceListings(SEARCH_HTML).length, 5);
});

test('빈 HTML 은 빈 목록', () => {
  assert.deepEqual(parsePlaceListings(''), []);
  assert.deepEqual(parsePlaceListings('<html></html>'), []);
});

/**
 * ⚠️ 상호 단독 검색은 **다른 화면**이다 (2026-08-03 실측).
 *    경로가 `/place/` 이고, 이름은 `PlaceListBusinessesItem:<id>` 에 들어 있으며
 *    검색어가 `<mark>` 로 강조돼 있다. 이걸 못 읽으면 자기 병원을 못 찾아
 *    **등록돼 있는 병원을 "미등록"으로 보고**한다 — 실제로 처음에 그렇게 났다.
 */
const NAME_SEARCH_HTML = `
<a href="https://m.place.naver.com/place/2044998731/home">1</a>
<a href="https://m.place.naver.com/place/36477425/home">2</a>
<script>window.__APOLLO_STATE__ = {
"PlaceListBusinessesItem:2044998731":{"name":"\\u003Cmark\\u003E서울베리굿치과의원\\u003C\\u002Fmark\\u003E"},
"PlaceListBusinessesItem:36477425":{"name":"\\u003Cmark\\u003E베리굿치과의원\\u003C\\u002Fmark\\u003E"}
};</script>`;

test('상호 단독 검색 화면(/place/ 경로)도 읽는다', () => {
  const list = parsePlaceListings(NAME_SEARCH_HTML);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, '2044998731');
});

test('검색어 강조 마크업을 걷어낸 이름으로 비교한다', () => {
  const list = parsePlaceListings(NAME_SEARCH_HTML);
  assert.deepEqual(
    list.map((p) => p.name),
    ['서울베리굿치과의원', '베리굿치과의원'],
  );
  // 마크업이 남아 있으면 이 매칭이 실패한다 — 회귀 지점.
  assert.equal(findClinicRank(list, '서울베리굿치과의원'), 1);
});

test('상세 HTML → 업종·등록 키워드', () => {
  const profile = parsePlaceProfile(DETAIL_HTML);
  assert.equal(profile.category, '치과');
  assert.deepEqual(profile.keywords, [
    '임플란트',
    '레진빌드업충치치료',
    '수성구범어동치과',
    '치아미백라미네이트',
    '턱관절물리치료',
  ]);
});

test('키워드가 없는 상세도 깨지지 않는다', () => {
  assert.deepEqual(parsePlaceProfile('{"category":"치과"}'), { category: '치과', keywords: [] });
  assert.deepEqual(parsePlaceProfile(''), { category: '', keywords: [] });
});

/* ── 순위 판정 ─────────────────────────────────────────── */

test('우리 병원 자리를 찾는다', () => {
  const list = parsePlaceListings(SEARCH_HTML);
  assert.equal(findClinicRank(list, '라온미소치과의원'), 3);
  assert.equal(findClinicRank(list, '서울베리굿치과의원'), 1);
});

/** 기관 접미사만 다른 것은 같은 병원이다 — 원장은 보통 '의원' 을 빼고 부른다. */
test('접미사를 뗀 표기도 같은 병원으로 본다', () => {
  const list = parsePlaceListings(SEARCH_HTML);
  assert.equal(findClinicRank(list, '라온미소'), 3);
  assert.equal(findClinicRank(list, '라온치과'), 2); // 라온치과병원
});

/**
 * ⚠️ 부분 일치를 허용하면 **다른 병원의 순위를 자기 것으로 보고**한다.
 *    원장이 그 값을 믿고 판단하므로 오탐이 곧 신뢰 붕괴다.
 *    '라온치과' 는 '라온미소치과의원' 이 아니고, '베리굿치과' 는 '서울베리굿치과의원' 이 아니다.
 */
test('비슷하지만 다른 병원을 자기 것으로 잡지 않는다', () => {
  const list = parsePlaceListings(SEARCH_HTML);
  // 앞에 브랜드가 더 붙은 다른 병원
  assert.equal(findClinicRank(list, '베리굿치과'), null);
  assert.equal(findClinicRank(list, '베리굿치과의원'), null);
  // 뒤에 브랜드가 더 붙은 다른 병원
  assert.equal(findClinicRank(list, '스카이치과'), null);
});

test('목록에 없으면 null', () => {
  assert.equal(findClinicRank(parsePlaceListings(SEARCH_HTML), '없는치과의원'), null);
  assert.equal(findClinicRank([], '라온미소치과의원'), null);
});

/* ── 지역 3단계 ────────────────────────────────────────── */

test('지번주소에서 동을 뽑는다', () => {
  assert.equal(extractDong('대구광역시 수성구 범어동 123-4'), '범어동');
  assert.equal(extractDong('서울특별시 강남구 역삼동 800'), '역삼동');
});

/** 도로명주소에는 동이 없다 — 없는 걸 만들어내면 안 된다. */
test('도로명주소에서는 동을 만들어내지 않는다', () => {
  assert.equal(extractDong('대구광역시 수성구 동대구로 123'), '');
  assert.equal(extractDong(''), '');
});

test('동 → 구 → 시 3단계를 만든다', () => {
  const scopes = buildPlaceScopes({
    lotAddress: '대구광역시 수성구 범어동 123-4',
    region: '수성구',
    shortProvince: '대구',
  });
  assert.deepEqual(
    scopes.map((s) => [s.kind, s.region]),
    [
      ['dong', '범어동'],
      ['gu', '수성구'],
      ['city', '대구'],
    ],
  );
});

/** 같은 값이 두 단계에 걸리면 같은 검색을 두 번 하게 된다 — 접는다. */
test('중복·빈 단계는 접는다', () => {
  const scopes = buildPlaceScopes({ lotAddress: '', region: '세종시', shortProvince: '세종시' });
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0].region, '세종시');
});

/* ── 키워드 정제 ───────────────────────────────────────── */

/**
 * 업주는 '수성구범어동치과' 처럼 지역을 넣어 등록한다. 여기에 또 지역을 붙이면
 * '범어동 수성구범어동치과' 라는 아무도 검색하지 않는 말이 된다.
 */
test('지역이 박힌 키워드는 지역을 떼고, 업종과 같아지면 버린다', () => {
  const out = sanitizePlaceKeywords(
    ['임플란트', '수성구범어동치과', '치아미백라미네이트'],
    ['범어동', '수성구', '대구'],
    '치과',
  );
  assert.deepEqual(out, ['임플란트', '치아미백라미네이트']);
});

test('중복·과도한 길이·공백을 정리한다', () => {
  const out = sanitizePlaceKeywords(
    ['임플란트', '임 플 란 트', '', '가', 'ㅇ'.repeat(30)],
    [],
    '치과',
  );
  assert.deepEqual(out, ['임플란트']);
});

test('키워드 상한이 조합 폭발을 막는 값으로 유지된다', () => {
  assert.ok(MAX_PLACE_KEYWORDS <= 3, '키워드 × 지역 3단계라 상한이 곧 요청 수다');
});

/* ── URL ───────────────────────────────────────────────── */

test('검색·상세 주소를 만든다', () => {
  assert.match(placeSearchUrl('범어동 치과'), /where=m_place/);
  assert.match(placeSearchUrl('범어동 치과'), /query=%EB%B2%94%EC%96%B4%EB%8F%99/);
  assert.equal(placeDetailUrl('2044998731'), 'https://m.place.naver.com/hospital/2044998731/home');
});
