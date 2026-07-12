import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankRelatedPosts,
  RELATED_POSTS_LIMIT,
  type RelatedPostCandidate,
} from '../related-posts.ts';

// ---------------------------------------------------------------------------
// 픽스처 — 같은 병원의 발행 글들 (태그/키워드 겹침 다양)
// ---------------------------------------------------------------------------

function post(over: Partial<RelatedPostCandidate> & { id: string }): RelatedPostCandidate {
  return {
    title: '',
    publishedAt: null,
    tags: [],
    keyword: null,
    ...over,
  };
}

const CURRENT = post({
  id: 'cur',
  title: '보톡스 시술 주기, 얼마나 자주 맞아야 할까요',
  tags: ['#보톡스', '#주름'],
  keyword: '보톡스 시술 주기',
});

// ---------------------------------------------------------------------------
// 태그/키워드 겹침 순 정렬
// ---------------------------------------------------------------------------

test('태그/키워드 겹침이 많은 글이 앞선다', () => {
  const candidates = [
    post({ id: 'a', title: '겨울철 피부 보습 관리법', tags: ['#보습'], keyword: '피부 보습' }),
    post({ id: 'b', title: '보톡스 후 주의사항 정리', tags: ['#보톡스'], keyword: '보톡스 주의사항' }),
    post({ id: 'c', title: '주름 개선 생활 습관', tags: ['#주름', '#보톡스'], keyword: '주름 보톡스' }),
  ];
  const ranked = rankRelatedPosts(CURRENT, candidates);
  // c(보톡스+주름 겹침 2) > b(보톡스 겹침 1) > a(겹침 0)
  assert.deepEqual(ranked.map((p) => p.id), ['c', 'b', 'a']);
});

test('자기 자신은 후보에서 제외된다', () => {
  const candidates = [CURRENT, post({ id: 'b', tags: ['#보톡스'], title: '보톡스 글' })];
  const ranked = rankRelatedPosts(CURRENT, candidates);
  assert.equal(ranked.some((p) => p.id === 'cur'), false);
  assert.deepEqual(ranked.map((p) => p.id), ['b']);
});

test('겹침이 없으면 최신순으로 보충된다 (부족분 채움)', () => {
  const candidates = [
    post({ id: 'old', title: '치과 스케일링 안내', publishedAt: '2026-01-01T00:00:00Z' }),
    post({ id: 'new', title: '임플란트 관리 방법', publishedAt: '2026-06-01T00:00:00Z' }),
  ];
  const ranked = rankRelatedPosts(CURRENT, candidates);
  // 겹침 0 동점 → 최신(new) 먼저
  assert.deepEqual(ranked.map((p) => p.id), ['new', 'old']);
});

test('겹침 글 우선, 나머지는 최신순 보충 (혼합)', () => {
  const candidates = [
    post({ id: 'match', title: '보톡스 부작용', tags: ['#보톡스'], publishedAt: '2026-01-01T00:00:00Z' }),
    post({ id: 'recent', title: '레이저 토닝 후기', publishedAt: '2026-06-01T00:00:00Z' }),
    post({ id: 'old', title: '점 빼기 상담', publishedAt: '2026-02-01T00:00:00Z' }),
  ];
  const ranked = rankRelatedPosts(CURRENT, candidates);
  // 겹침 보유(match) 최상단 → 나머지는 최신순(recent, old)
  assert.deepEqual(ranked.map((p) => p.id), ['match', 'recent', 'old']);
});

test('상한(limit)을 넘지 않는다 — 기본 4편', () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    post({ id: `p${i}`, title: `보톡스 이야기 ${i}`, tags: ['#보톡스'] }),
  );
  const ranked = rankRelatedPosts(CURRENT, many);
  assert.equal(ranked.length, RELATED_POSTS_LIMIT);
  assert.equal(ranked.length, 4);
});

test('limit 인자로 편수를 조절할 수 있다', () => {
  const many = Array.from({ length: 5 }, (_, i) =>
    post({ id: `p${i}`, title: `주름 이야기 ${i}`, tags: ['#주름'] }),
  );
  assert.equal(rankRelatedPosts(CURRENT, many, 2).length, 2);
});

test('현재 글에 태그/키워드가 없으면 제목 토큰으로 폴백 매칭', () => {
  const currentNoTags = post({ id: 'cur', title: '임플란트 시술 과정 안내' });
  const candidates = [
    post({ id: 'match', title: '임플란트 후 관리', tags: [] }),
    post({ id: 'other', title: '충치 예방 습관' }),
  ];
  const ranked = rankRelatedPosts(currentNoTags, candidates);
  assert.equal(ranked[0].id, 'match');
});

test('빈 제목 후보는 제외된다', () => {
  const candidates = [
    post({ id: 'empty', title: '   ', tags: ['#보톡스'] }),
    post({ id: 'ok', title: '보톡스 정보', tags: ['#보톡스'] }),
  ];
  const ranked = rankRelatedPosts(CURRENT, candidates);
  assert.deepEqual(ranked.map((p) => p.id), ['ok']);
});

test('후보가 없으면 빈 배열', () => {
  assert.deepEqual(rankRelatedPosts(CURRENT, []), []);
});

test("'#' 접두 태그는 토큰화에서 자연 제거되어 매칭된다", () => {
  const candidates = [post({ id: 'b', title: '무관한 제목', tags: ['#보톡스'], keyword: null })];
  const ranked = rankRelatedPosts(CURRENT, candidates);
  // CURRENT 태그 '#보톡스' 와 후보 '#보톡스' 가 '보톡스' 로 매칭
  assert.equal(ranked[0].id, 'b');
});
