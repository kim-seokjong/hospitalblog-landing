import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaceFindings } from '../findings.ts';
import type { PlaceAxis, PlaceRankRow } from '../types.ts';

/**
 * 회귀 고정 — 2026-08-04 교차검증.
 *
 * 이 카드들은 **원장이 자기 병원 사실로 믿는 값**이다. 그래서 여기서 지키는 것은
 * "보기 좋은 문구" 가 아니라 **확인하지 못한 것을 확인한 것처럼 말하지 않기** 하나다.
 * 아래 케이스는 전부 실제로 잘못 보고하던 경로였다.
 */

const BASE: PlaceAxis = {
  checked: true,
  presence: 'found',
  placeId: '1',
  placeName: '테스트치과의원',
  category: '치과',
  registeredKeywords: ['임플란트'],
  profileChecked: true,
  keywordFieldFound: true,
  measuredKeywords: [{ keyword: '치과', volume: 250400, anchor: true }],
  lowVolumeKeywords: [],
  overLimitKeywords: [],
  volumeChecked: true,
  ranks: [],
  rankChecked: true,
  topN: 5,
};

const row = (
  scope: PlaceRankRow['scope'],
  state: PlaceRankRow['state'],
  rank: number | null = null,
  keyword = '치과',
): PlaceRankRow => ({
  keyword,
  scope,
  region: scope === 'dong' ? '범어동' : scope === 'gu' ? '수성구' : '대구',
  query: `${scope} ${keyword}`,
  state,
  rank,
});

function cardFor(axis: PlaceAxis, idPart: string) {
  return buildPlaceFindings(axis).find((f) => f.id.includes(idPart));
}

/* ── 대표 키워드 카드 ─────────────────────────────────── */

/**
 * ⚠️ 업종만 읽히고 키워드 구조가 바뀌면, 예전에는 **아무 카드도 안 나왔다** —
 *    원장은 "확인했는데 문제 없다" 로 읽는다. 확인 못 했으면 그렇게 말해야 한다.
 */
test('키워드 필드를 못 읽었으면 미확인 카드를 낸다', () => {
  const card = cardFor({ ...BASE, keywordFieldFound: false, registeredKeywords: [] }, 'place.keywords');
  assert.equal(card?.tone, 'unknown');
  assert.match(card?.state ?? '', /확인하지 못했습니다/);
});

test('필드는 읽었는데 비어 있으면 미등록으로 말한다', () => {
  const card = cardFor({ ...BASE, keywordFieldFound: true, registeredKeywords: [] }, 'place.keywords');
  assert.equal(card?.tone, 'warn');
  assert.match(card?.state ?? '', /등록된 대표 키워드가 없습니다/);
});

/* ── 검색량 신뢰 ──────────────────────────────────────── */

/**
 * ⚠️ API 호출이 성공해도 **특정 키워드 행만 빠질** 수 있다. 그걸 신뢰하면
 *    아무도 안 치는 말의 1위가 '잘하고 있는 것' 으로 올라간다.
 */
test('검색량을 못 받은 등록 키워드는 잘하고 있는 것으로 올리지 않는다', () => {
  const axis: PlaceAxis = {
    ...BASE,
    measuredKeywords: [{ keyword: '임플란트', volume: null, anchor: false }],
    ranks: [
      row('dong', 'ranked', 1, '임플란트'),
      row('gu', 'ranked', 1, '임플란트'),
      row('city', 'ranked', 1, '임플란트'),
    ],
  };
  const card = cardFor(axis, 'place.rank');
  assert.notEqual(card?.tone, 'good');
  assert.match(card?.state ?? '', /검색량 미확인/);
});

test('업종은 검색량을 못 받아도 신뢰한다 — 환자가 실제로 치는 말이다', () => {
  const axis: PlaceAxis = {
    ...BASE,
    measuredKeywords: [{ keyword: '치과', volume: null, anchor: true }],
    ranks: [row('dong', 'ranked', 1), row('gu', 'ranked', 1), row('city', 'ranked', 1)],
  };
  assert.equal(cardFor(axis, 'place.rank')?.tone, 'good');
});

/* ── 부분 확인 ────────────────────────────────────────── */

/**
 * ⚠️ 동만 확인되고 구·시가 타임아웃인데 "더 넓히면 사라진다" 고 쓰면,
 *    **확인도 안 한 범위를 사실처럼** 말하는 것이다.
 */
test('더 넓은 범위를 확인 못 했으면 사라진다고 말하지 않는다', () => {
  const axis: PlaceAxis = {
    ...BASE,
    ranks: [row('dong', 'ranked', 1), row('gu', 'unchecked'), row('city', 'unchecked')],
  };
  const card = cardFor(axis, 'place.rank');
  assert.match(card?.why ?? '', /확인하지 못했습니다/);
  assert.doesNotMatch(card?.why ?? '', /사라집니다/);
});

test('더 넓은 범위가 실제로 5위 밖일 때만 사라진다고 말한다', () => {
  const axis: PlaceAxis = {
    ...BASE,
    ranks: [row('dong', 'ranked', 1), row('gu', 'outside_top'), row('city', 'unchecked')],
  };
  assert.match(cardFor(axis, 'place.rank')?.why ?? '', /사라집니다/);
});

/** 전부 확인했고 어디에도 없을 때만 "안 보인다" 로 단정한다. */
test('일부만 확인된 미노출은 단정하지 않고 미확인으로 둔다', () => {
  const axis: PlaceAxis = {
    ...BASE,
    ranks: [row('dong', 'outside_top'), row('gu', 'unchecked'), row('city', 'unchecked')],
  };
  const card = cardFor(axis, 'place.rank');
  assert.equal(card?.tone, 'unknown');
  assert.match(card?.why ?? '', /나머지 지역은 확인하지 못했습니다/);
});

test('전부 확인하고 어디에도 없으면 단정한다', () => {
  const axis: PlaceAxis = {
    ...BASE,
    ranks: [row('dong', 'outside_top'), row('gu', 'outside_top'), row('city', 'outside_top')],
  };
  const card = cardFor(axis, 'place.rank');
  assert.equal(card?.tone, 'warn');
  assert.match(card?.why ?? '', /보이지 않습니다/);
});

/* ── 등록 여부 ────────────────────────────────────────── */

/** ⚠️ 목록을 못 읽은 것(unknown)을 "미등록" 으로 보고하면 신뢰가 무너진다. */
test('확인 못 한 상태에서는 미등록 카드를 내지 않는다', () => {
  assert.deepEqual(buildPlaceFindings({ ...BASE, checked: false, presence: 'unknown' }), []);
});

test('목록은 읽었는데 없으면 미등록으로 말한다', () => {
  const cards = buildPlaceFindings({ ...BASE, presence: 'not_found' });
  assert.equal(cards.length, 1);
  assert.match(cards[0].state, /확인되지 않았습니다/);
});

/** ⚠️ 경쟁 병원 이름은 어떤 카드에도 실리지 않아야 한다(타 병원 비교·비방 금지). */
test('카드 어디에도 경쟁 병원 이름이 실리지 않는다', () => {
  const axis: PlaceAxis = {
    ...BASE,
    ranks: [row('dong', 'ranked', 3), row('gu', 'outside_top'), row('city', 'outside_top')],
  };
  const text = JSON.stringify(buildPlaceFindings(axis));
  assert.doesNotMatch(text, /경쟁|1위 병원|라온|베리굿/);
});
