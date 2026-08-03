import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlaceScopes,
  districtOf,
  extractDong,
  findClinicRank,
  matchesRegion,
  MAX_PLACE_KEYWORDS,
  MIN_PLACE_KEYWORD_VOLUME,
  parsePlaceListings,
  parsePlaceProfile,
  PLACE_TOP_N,
  placeDetailUrl,
  placeSearchUrl,
  sanitizePlaceKeywords,
  selectPlaceKeywords,
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
  assert.deepEqual(parsePlaceProfile('{"category":"치과"}'), {
    category: '치과',
    keywords: [],
    keywordFieldFound: false,
    categoryFieldFound: true,
  });
  assert.deepEqual(parsePlaceProfile(''), {
    category: '',
    keywords: [],
    keywordFieldFound: false,
    categoryFieldFound: false,
  });
});

/**
 * ⚠️ **"등록 키워드가 빈 배열" 과 "필드를 못 찾음" 은 완전히 다르다** (2026-08-04 지적).
 *    뭉치면 마크업이 바뀐 날 등록해 둔 원장에게 "등록 안 하셨다" 고 말하게 된다.
 */
test('빈 등록과 파싱 실패를 구분한다', () => {
  const empty = parsePlaceProfile('{"category":"치과","keywordList":[]}');
  assert.equal(empty.keywordFieldFound, true, '필드는 찾았고 값이 비어 있는 것');
  assert.deepEqual(empty.keywords, []);

  const broken = parsePlaceProfile('{"category":"치과","keywordTags":["임플란트"]}');
  assert.equal(broken.keywordFieldFound, false, '필드 이름이 바뀌면 못 찾은 것');
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

/* ── 지역 검증 (동명 병원 방어) ─────────────────────────── */

/**
 * ⚠️ 실측: '서울베리굿치과의원' 을 검색하면 서울 서대문구 '베리굿치과의원' 이
 *    **같은 목록에 올라온다**. 이름 정규화만으로 고르면 다른 지역 병원을 자기
 *    병원으로 확정하고, 그 뒤 모든 순위가 남의 순위가 된다.
 */
const REGION_HTML = `
<a href="https://m.place.naver.com/place/111/home">1</a>
<a href="https://m.place.naver.com/place/222/home">2</a>
<script>window.__APOLLO_STATE__ = {
"PlaceListBusinessesItem:111":{"name":"베리굿치과의원","commonAddress":"서울 서대문구 미근동"},
"PlaceListBusinessesItem:222":{"name":"베리굿치과의원","commonAddress":"대구 수성구 범어동"}
};</script>`;

test('목록에서 주소를 함께 읽는다', () => {
  const list = parsePlaceListings(REGION_HTML);
  assert.equal(list[0].address, '서울 서대문구 미근동');
  assert.equal(list[1].address, '대구 수성구 범어동');
});

test('다른 지역의 동명 병원은 우리 병원이 아니다', () => {
  const list = parsePlaceListings(REGION_HTML);
  assert.equal(matchesRegion(list[0], '수성구', '대구'), 'mismatch');
  assert.equal(matchesRegion(list[1], '수성구', '대구'), 'match');
});

/**
 * ⚠️ **같은 시라도 구가 다르면 다른 병원이다** (2026-08-04 지적으로 강화).
 *    "같은 시면 통과" 로 두면 대구 수성구 병원을 찾는데 대구 동구의 동명 병원이
 *    통과해, 그 뒤 모든 순위가 남의 순위가 된다.
 */
test('주소에 구가 적혀 있으면 반드시 일치해야 한다', () => {
  assert.equal(matchesRegion({ id: '1', name: 'x', address: '서울 강남구 역삼동' }, '수성구', '대구'), 'mismatch');
  assert.equal(matchesRegion({ id: '2', name: 'x', address: '대구 동구 신암동' }, '수성구', '대구'), 'mismatch');
  assert.equal(matchesRegion({ id: '3', name: 'x', address: '대구 수성구 범어동' }, '수성구', '대구'), 'match');
});

/**
 * ⚠️ 구·군을 못 읽었으면 **통과시키지 않는다**(2026-08-04 지적으로 뒤집음).
 *    "같은 시면 맞다" 로 두면 대구 수성구 병원을 찾는데 구가 안 적힌 대구 동구
 *    동명 병원이 통과해, 그 병원의 키워드와 순위를 원장 것으로 보고하게 된다.
 *    다른 시·도인 것이 분명할 때만 mismatch, 그 외에는 모른다고 한다.
 */
/**
 * ⚠️ 구·군만 보면 안 된다 (2026-08-04 지적).
 *    제주는 **행정시**(제주시·서귀포시)가 그 자리를 대신하고, 경기도는
 *    `성남시 분당구` 처럼 두 단계가 함께 온다. 하나만 집으면 성남시를 집어
 *    분당구와 다르다고 판정해 **멀쩡한 병원을 미확인으로** 떨군다.
 */
test('행정시·2단계 주소도 지역을 확정한다', () => {
  const jeju = { id: '1', name: 'x', address: '제주특별자치도 제주시 노형동' };
  assert.equal(matchesRegion(jeju, '제주시', '제주'), 'match');
  assert.equal(matchesRegion(jeju, '서귀포시', '제주'), 'mismatch');

  const bundang = { id: '2', name: 'x', address: '경기도 성남시 분당구 정자동' };
  assert.equal(matchesRegion(bundang, '분당구', '경기'), 'match');
  assert.equal(matchesRegion(bundang, '성남시', '경기'), 'match');
  assert.equal(matchesRegion(bundang, '수정구', '경기'), 'mismatch');
});

/** 세종처럼 구·군이 아예 없는 단층 지역은 시·도 일치가 곧 지역 일치다. */
test('단층 지역(세종)은 시·도 일치로 확정한다', () => {
  const sejong = { id: '1', name: 'x', address: '세종특별자치시 도담동' };
  assert.equal(matchesRegion(sejong, '세종시', '세종시'), 'match');
  assert.equal(matchesRegion({ id: '2', name: 'x', address: '대구 수성구 범어동' }, '세종시', '세종시'), 'mismatch');
});

test('구를 못 읽은 주소는 통과가 아니라 미확인이다', () => {
  assert.equal(matchesRegion({ id: '1', name: 'x', address: '대구광역시 달구벌대로 2421' }, '수성구', '대구'), 'unknown');
  assert.equal(matchesRegion({ id: '2', name: 'x', address: '서울특별시 통일로 107' }, '수성구', '대구'), 'mismatch');
});

/** '대구' 는 `구` 로 끝나지만 시·도다 — 이걸 구로 읽으면 전국 매칭이 무너진다. */
test('시·도 이름을 구로 오인하지 않는다', () => {
  assert.equal(districtOf('대구 수성구 범어동', '대구'), '수성구');
  assert.equal(districtOf('대구광역시 달구벌대로 2421', '대구'), '');
});

/**
 * ⚠️ 구 이름은 **한 글자짜리가 흔하다**(동구·서구·남구·북구·중구).
 *    앞에 2글자 이상을 요구했더니 '대구 동구' 가 "구를 못 읽음" 으로 빠져
 *    시·도 폴백으로 통과했다 — 다른 구 병원을 자기 병원으로 확정하는 경로였다.
 */
test('한 글자 구 이름도 읽는다', () => {
  for (const [addr, expected] of [
    ['대구 동구 신암동', '동구'],
    ['부산 중구 남포동', '중구'],
    ['광주 남구 봉선동', '남구'],
    ['대구 군위군 군위읍', '군위군'],
  ] as const) {
    assert.equal(districtOf(addr, addr.split(' ')[0]), expected, addr);
  }
});

/** ⚠️ 주소를 못 읽었으면 통과시키지 않는다 — 확인 못 한 것을 맞다고 하지 않는다. */
test('주소가 비면 지역 확인 실패로 본다', () => {
  assert.equal(matchesRegion({ id: '1', name: 'x', address: '' }, '수성구', '대구'), 'unknown');
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

/* ── 검색량 필터 ───────────────────────────────────────── */

const VOL = {
  임플란트: { total: 12300 },
  치아미백라미네이트: { total: 210 },
  레진빌드업충치치료: { total: 5 },
  턱관절물리치료: { total: 12 },
  치과: { total: 40500 },
};

/**
 * ⚠️ 이 필터가 없으면 `레진빌드업충치치료` 처럼 아무도 안 치는 말이
 *    **동·구·시 세 단계 모두 1위**로 나온다(2026-08-04 실측). 경쟁이 없으니 당연하고,
 *    그 1위는 성과가 아니다 — 리포트가 "잘하고 있다"는 착시를 만든다.
 */
test('검색량이 바닥인 등록 키워드는 재지 않는다', () => {
  const { measured, lowVolume } = selectPlaceKeywords(
    '치과',
    ['임플란트', '레진빌드업충치치료', '치아미백라미네이트', '턱관절물리치료'],
    VOL,
    true,
  );
  const names = measured.map((m) => m.keyword);
  assert.ok(!names.includes('레진빌드업충치치료'), '검색량 5는 걸러야 한다');
  assert.ok(!names.includes('턱관절물리치료'), '검색량 12는 걸러야 한다');
  assert.ok(lowVolume.some((s) => s.keyword === '레진빌드업충치치료'));
});

test('검색량이 큰 순서로 고른다', () => {
  const { measured } = selectPlaceKeywords(
    '치과',
    ['치아미백라미네이트', '임플란트'],
    VOL,
    true,
  );
  assert.deepEqual(measured.map((m) => m.keyword), ['치과', '임플란트', '치아미백라미네이트']);
});

/** 업종은 환자가 가장 많이 치는 말이라 언제나 나와야 한다. */
test('업종은 검색량과 무관하게 항상 잰다', () => {
  const { measured } = selectPlaceKeywords('치과', [], {}, true);
  assert.equal(measured.length, 1);
  assert.equal(measured[0].keyword, '치과');
  assert.equal(measured[0].anchor, true);
});

/**
 * ⚠️ 조회 실패를 이유로 멀쩡한 키워드를 버리면, 검색광고 키가 잠깐 죽은 날
 *    리포트가 통째로 빈약해진다. 못 봤으면 거르지 않는다.
 */
test('검색량을 못 봤으면 거르지 않는다', () => {
  const { measured, lowVolume } = selectPlaceKeywords(
    '치과',
    ['레진빌드업충치치료', '턱관절물리치료'],
    {},
    false,
  );
  assert.deepEqual(measured.map((m) => m.keyword), ['치과', '레진빌드업충치치료', '턱관절물리치료']);
  assert.deepEqual(lowVolume, []);
});

/**
 * ⚠️ 상한에 밀린 것을 "검색량이 거의 없다" 로 뭉치면 **거짓 보고**가 된다.
 *    검색량 210회짜리 키워드를 "거의 검색되지 않는다" 고 말하면 안 된다.
 */
test('상한에 밀린 키워드와 검색량 미달을 분리한다', () => {
  const { measured, lowVolume, overLimit } = selectPlaceKeywords(
    '치과',
    ['임플란트', '치아미백라미네이트', '치아교정'],
    { ...VOL, 치아교정: { total: 9000 } },
    true,
    2,
  );
  assert.equal(measured.length, 3); // 업종 + 2
  assert.ok(overLimit.some((s) => s.keyword === '치아미백라미네이트'), '상한에 밀린 쪽');
  assert.ok(
    !lowVolume.some((s) => s.keyword === '치아미백라미네이트'),
    '검색량 210회를 "거의 없음" 으로 보고하면 안 된다',
  );
});

test('검색량을 키워드에 실어 보낸다', () => {
  const { measured } = selectPlaceKeywords('치과', ['임플란트'], VOL, true);
  assert.equal(measured.find((m) => m.keyword === '임플란트')?.volume, 12300);
});

test('필터 임계값이 네이버 추정 구간(< 10 → 5)보다 위에 있다', () => {
  assert.ok(MIN_PLACE_KEYWORD_VOLUME > 10, '추정치 구간을 확실히 넘겨야 한다');
});

/* ── URL ───────────────────────────────────────────────── */

test('검색·상세 주소를 만든다', () => {
  assert.match(placeSearchUrl('범어동 치과'), /where=m_place/);
  assert.match(placeSearchUrl('범어동 치과'), /query=%EB%B2%94%EC%96%B4%EB%8F%99/);
  assert.equal(placeDetailUrl('2044998731'), 'https://m.place.naver.com/hospital/2044998731/home');
});
