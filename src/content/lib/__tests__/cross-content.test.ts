import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenize,
  tokenizeAll,
  extractConversionTexts,
  isPostCoveredByConversion,
  hasConversionSource,
  isPostCoveredBySource,
  recommendBlogToVideo,
  recommendVideoToBlog,
  TOP_RANK_THRESHOLD,
  MAX_TO_VIDEO,
  MAX_TO_BLOG,
  type CrossPostInput,
  type CrossConversionInput,
} from '../cross-content.ts';

const NOW = new Date('2026-07-05T00:00:00Z');

function post(overrides: Partial<CrossPostInput> & { id: string }): CrossPostInput {
  return {
    title: '제목 없음',
    keyword: null,
    publishedAt: '2026-07-01T00:00:00Z', // 기본: 최근(30일 이내) 발행
    latestRank: null,
    ...overrides,
  };
}

function conv(overrides: Partial<CrossConversionInput> & { conversionId: string }): CrossConversionInput {
  return {
    createdAt: '2026-07-02T00:00:00Z',
    texts: [],
    ...overrides,
  };
}

// ── tokenize ──
test('tokenize: 한글·영문·숫자 토큰 추출, 2자 미만·일반어 제외', () => {
  const tokens = tokenize('보톡스 시술 전 알아야 할 방법 3가지 tip');
  assert.equal(tokens.has('보톡스'), true);
  assert.equal(tokens.has('시술'), true);
  assert.equal(tokens.has('tip'), true);
  assert.equal(tokens.has('전'), false); // 1자 제외
  assert.equal(tokens.has('방법'), false); // 일반어 제외
});

test('tokenize: 비문자열은 빈 Set', () => {
  assert.equal(tokenize(null).size, 0);
  assert.equal(tokenize(123).size, 0);
});

test('tokenizeAll: 여러 조각 병합', () => {
  const tokens = tokenizeAll(['임플란트 비용', '임플란트 과정']);
  assert.equal(tokens.has('임플란트'), true);
  assert.equal(tokens.has('비용'), true);
  assert.equal(tokens.has('과정'), true);
});

// ── extractConversionTexts ──
test('extractConversionTexts: threads.posts + feed.caption + 해시태그 추출', () => {
  const texts = extractConversionTexts({
    threads: { posts: ['임플란트 수명 이야기 1편', ' '], hashtags: ['#임플란트'] },
    feed: { caption: '임플란트 관리 팁', hashtags: ['#치과'] },
  });
  assert.deepEqual(texts, ['임플란트 수명 이야기 1편', '#임플란트', '임플란트 관리 팁', '#치과']);
});

test('extractConversionTexts: 형태가 다르거나 null 이면 빈 배열', () => {
  assert.deepEqual(extractConversionTexts(null), []);
  assert.deepEqual(extractConversionTexts('문자열'), []);
  assert.deepEqual(extractConversionTexts({ threads: { posts: 'not-array' } }), []);
});

// ── isPostCoveredByConversion (중복 판정) ──
test('중복 판정: 키워드 토큰 전부 포함 → 중복', () => {
  const tokens = tokenizeAll(['오늘은 레이저 토닝 시술을 소개합니다']);
  assert.equal(
    isPostCoveredByConversion({ title: '아무 제목', keyword: '레이저 토닝' }, tokens),
    true,
  );
});

test('중복 판정: 키워드 토큰 일부만 포함 → 중복 아님 (보수적)', () => {
  const tokens = tokenizeAll(['레이저 제모 안내']);
  assert.equal(
    isPostCoveredByConversion({ title: '아무 제목', keyword: '레이저 토닝' }, tokens),
    false,
  );
});

test('중복 판정: 제목 토큰 2개 이상 + 50% 이상 겹침 → 중복', () => {
  const tokens = tokenizeAll(['허리디스크 비수술 이야기']);
  assert.equal(
    isPostCoveredByConversion({ title: '허리디스크 비수술', keyword: null }, tokens),
    true,
  );
});

test('중복 판정: 제목 토큰 1개만 겹침 → 중복 아님', () => {
  const tokens = tokenizeAll(['허리디스크 이야기만 있는 텍스트']);
  assert.equal(
    isPostCoveredByConversion(
      { title: '허리디스크 도수치료 스트레칭 운동', keyword: null },
      tokens,
    ),
    false,
  );
});

test('중복 판정: 변환 텍스트 없음(결과 미저장) → 판정 불가 = 중복 아님', () => {
  assert.equal(
    isPostCoveredByConversion({ title: '임플란트 과정', keyword: '임플란트' }, new Set()),
    false,
  );
});

// ── recommendBlogToVideo (순위 필터 · 중복 제외 · 정렬) ──
test('영상화 추천: 상위 15위 이내 또는 최근 30일 글만 후보', () => {
  const posts = [
    post({ id: 'ranked', title: '레이저 토닝 관리', keyword: '레이저 토닝', publishedAt: '2026-01-01T00:00:00Z', latestRank: 5 }),
    post({ id: 'recent', title: '보톡스 시술 안내', keyword: '보톡스' }),
    post({ id: 'old-unranked', title: '오래된 글', keyword: '임플란트', publishedAt: '2026-01-01T00:00:00Z', latestRank: null }),
    post({ id: 'low-rank-old', title: '순위 낮은 옛 글', keyword: '라식', publishedAt: '2026-01-01T00:00:00Z', latestRank: TOP_RANK_THRESHOLD + 1 }),
  ];
  const result = recommendBlogToVideo(posts, [], NOW);
  const ids = result.map((r) => r.postId);
  assert.deepEqual(ids.sort(), ['ranked', 'recent'].sort());
});

test('영상화 추천: 순위 보유 글 우선(오름차순), 나머지는 최신순 — 상위 3개 제한', () => {
  const posts = [
    post({ id: 'r10', title: '글A 도수치료', keyword: '도수치료', latestRank: 10 }),
    post({ id: 'r3', title: '글B 임플란트', keyword: '임플란트', latestRank: 3 }),
    post({ id: 'new1', title: '글C 라식', keyword: '라식', publishedAt: '2026-07-03T00:00:00Z' }),
    post({ id: 'new2', title: '글D 백내장', keyword: '백내장', publishedAt: '2026-07-04T00:00:00Z' }),
  ];
  const result = recommendBlogToVideo(posts, [], NOW);
  assert.equal(result.length, MAX_TO_VIDEO);
  assert.deepEqual(result.map((r) => r.postId), ['r3', 'r10', 'new2']);
});

test('영상화 추천: 이미 영상화된 주제는 제외', () => {
  const posts = [
    post({ id: 'dup', title: '레이저 토닝 후 관리', keyword: '레이저 토닝', latestRank: 2 }),
    post({ id: 'fresh', title: '보톡스 시술 주기', keyword: '보톡스', latestRank: 7 }),
  ];
  const conversions = [
    conv({ conversionId: 'c1', texts: ['오늘은 레이저 토닝 시술 이야기', '#레이저토닝'] }),
  ];
  const result = recommendBlogToVideo(posts, conversions, NOW);
  assert.deepEqual(result.map((r) => r.postId), ['fresh']);
});

test('영상화 추천: 사유 문구 — 순위 글은 순위 명시, 최근 글은 최근 발행 명시', () => {
  const posts = [
    post({ id: 'ranked', title: '임플란트 과정', keyword: '임플란트', latestRank: 4 }),
    post({ id: 'recent', title: '라식 검사 항목', keyword: '라식', latestRank: null }),
  ];
  const result = recommendBlogToVideo(posts, [], NOW);
  const ranked = result.find((r) => r.postId === 'ranked');
  const recent = result.find((r) => r.postId === 'recent');
  assert.ok(ranked && ranked.reason.includes('4위'));
  assert.ok(recent && recent.reason.includes('최근 발행'));
});

test('영상화 추천: 데이터 없음 → 빈 배열 (에러 아님)', () => {
  assert.deepEqual(recommendBlogToVideo([], [], NOW), []);
});

// ── recommendVideoToBlog (주제 역추적 · 각도 중복 회피) ──
test('후속 글 추천: 변환 텍스트와 매칭된 글의 키워드로 후속 각도 제안', () => {
  const posts = [
    post({ id: 'p1', title: '임플란트 수술 과정', keyword: '임플란트' }),
  ];
  const conversions = [
    conv({ conversionId: 'c1', texts: ['임플란트 수술 과정을 영상으로 알아봅니다'] }),
  ];
  const result = recommendVideoToBlog(conversions, posts);
  assert.equal(result.length, 1);
  assert.equal(result[0].topic, '임플란트');
  assert.equal(result[0].suggestedKeyword, '임플란트 자주 묻는 질문');
  assert.ok(result[0].reason.includes('임플란트'));
});

test('후속 글 추천: 첫 각도가 이미 글로 있으면 다음 각도로', () => {
  const posts = [
    post({ id: 'p1', title: '임플란트 수술 과정', keyword: '임플란트' }),
    post({ id: 'p2', title: '임플란트 자주 묻는 질문 모음', keyword: null }),
  ];
  const conversions = [
    conv({ conversionId: 'c1', texts: ['임플란트 수술 과정을 영상으로'] }),
  ];
  const result = recommendVideoToBlog(conversions, posts);
  assert.equal(result.length, 1);
  assert.equal(result[0].suggestedKeyword, '임플란트 오해와 사실');
});

test('후속 글 추천: 원문 매칭 실패(텍스트 무관/미저장) → 추천 없음 (보수적)', () => {
  const posts = [post({ id: 'p1', title: '라식 검사', keyword: '라식' })];
  const conversions = [
    conv({ conversionId: 'no-match', texts: ['전혀 다른 주제의 텍스트'] }),
    conv({ conversionId: 'no-texts', texts: [] }),
  ];
  assert.deepEqual(recommendVideoToBlog(conversions, posts), []);
});

test('후속 글 추천: 같은 주제 변환 여러 건이어도 1회만 + 상위 2개 제한', () => {
  const posts = [
    post({ id: 'p1', title: '임플란트 수술 과정', keyword: '임플란트' }),
    post({ id: 'p2', title: '라식 수술 검사', keyword: '라식' }),
    post({ id: 'p3', title: '백내장 수술 시기', keyword: '백내장' }),
  ];
  const conversions = [
    conv({ conversionId: 'c1', createdAt: '2026-07-04T00:00:00Z', texts: ['임플란트 수술 과정 영상'] }),
    conv({ conversionId: 'c2', createdAt: '2026-07-03T00:00:00Z', texts: ['임플란트 수술 과정 다시 보기'] }),
    conv({ conversionId: 'c3', createdAt: '2026-07-02T00:00:00Z', texts: ['라식 수술 검사 영상'] }),
    conv({ conversionId: 'c4', createdAt: '2026-07-01T00:00:00Z', texts: ['백내장 수술 시기 영상'] }),
  ];
  const result = recommendVideoToBlog(conversions, posts);
  assert.equal(result.length, MAX_TO_BLOG);
  assert.deepEqual(result.map((r) => r.topic), ['임플란트', '라식']);
});

// ── source 연결 1순위 판정 (마이그 038) ──

test('hasConversionSource: sourcePostId 또는 sourceKeyword 있으면 true', () => {
  assert.equal(hasConversionSource({ sourcePostId: 'p1', sourceKeyword: null }), true);
  assert.equal(hasConversionSource({ sourcePostId: null, sourceKeyword: '임플란트' }), true);
  assert.equal(hasConversionSource({ sourcePostId: null, sourceKeyword: '  ' }), false);
  assert.equal(hasConversionSource({}), false);
});

test('isPostCoveredBySource: sourcePostId 일치 → 중복 (확정 연결)', () => {
  assert.equal(
    isPostCoveredBySource({ id: 'p1', keyword: null }, { sourcePostId: 'p1' }),
    true,
  );
  assert.equal(
    isPostCoveredBySource({ id: 'p2', keyword: null }, { sourcePostId: 'p1' }),
    false,
  );
});

test('isPostCoveredBySource: sourceKeyword 는 사실상 동일할 때만 (문자열/토큰 Set 일치)', () => {
  const post = { id: 'p1', keyword: '임플란트 비용' };
  assert.equal(isPostCoveredBySource(post, { sourceKeyword: '임플란트 비용' }), true);
  assert.equal(isPostCoveredBySource(post, { sourceKeyword: '비용 임플란트' }), true); // 어순 무시
  assert.equal(isPostCoveredBySource(post, { sourceKeyword: '임플란트' }), false); // 부분 일치는 미중복
  assert.equal(isPostCoveredBySource(post, { sourceKeyword: '임플란트 비용 기간' }), false);
  assert.equal(isPostCoveredBySource({ id: 'p1', keyword: null }, { sourceKeyword: '임플란트' }), false);
});

test('영상화 추천: source_post_id 연결 변환은 결과물 텍스트 없이도 그 글을 제외한다', () => {
  const posts = [
    post({ id: 'p1', title: '임플란트 수술 과정', keyword: '임플란트' }),
    post({ id: 'p2', title: '라식 수술 검사', keyword: '라식' }),
  ];
  // 과거 토큰 매칭이라면 texts 가 비어 판정 불가 → 재추천됐을 케이스
  const conversions = [conv({ conversionId: 'c1', texts: [], sourcePostId: 'p1' })];
  const result = recommendBlogToVideo(posts, conversions, NOW);
  assert.deepEqual(result.map((r) => r.postId), ['p2']);
});

test('영상화 추천: source_keyword 동일 키워드 글 제외 + source 보유 변환은 토큰 폴백을 타지 않는다', () => {
  const posts = [
    post({ id: 'p1', title: '임플란트 비용 정리', keyword: '임플란트 비용' }),
    post({ id: 'p2', title: '임플란트 수술 과정', keyword: '임플란트 수술' }),
  ];
  // source 보유 → 1순위 판정만. texts 에 '임플란트 수술'이 있어도 p2 를 토큰 매칭으로 제외하지 않는다.
  const conversions = [
    conv({
      conversionId: 'c1',
      texts: ['임플란트 수술 이야기'],
      sourceKeyword: '임플란트 비용',
    }),
  ];
  const result = recommendBlogToVideo(posts, conversions, NOW);
  assert.deepEqual(result.map((r) => r.postId), ['p2']);
});

test('영상화 추천: source 없는 과거 변환은 기존 토큰 매칭으로 폴백 판정', () => {
  const posts = [post({ id: 'p1', title: '임플란트 수술 과정', keyword: '임플란트' })];
  const legacy = [conv({ conversionId: 'c1', texts: ['임플란트 수술 과정을 영상으로'] })];
  assert.deepEqual(recommendBlogToVideo(posts, legacy, NOW), []);
});

test('후속 글 추천: sourcePostId 로 주제 특정 (결과물 텍스트 불필요)', () => {
  const posts = [post({ id: 'p1', title: '임플란트 수술 과정', keyword: '임플란트' })];
  const conversions = [conv({ conversionId: 'c1', texts: [], sourcePostId: 'p1' })];
  const result = recommendVideoToBlog(conversions, posts);
  assert.equal(result.length, 1);
  assert.equal(result[0].topic, '임플란트');
  assert.equal(result[0].suggestedKeyword, '임플란트 자주 묻는 질문');
});

test('후속 글 추천: 키워드 진입 변환은 sourceKeyword 가 곧 주제 (글 매칭 불필요)', () => {
  const posts = [post({ id: 'p1', title: '전혀 다른 주제 글', keyword: '라식' })];
  const conversions = [conv({ conversionId: 'c1', texts: [], sourceKeyword: '허리디스크 증상' })];
  const result = recommendVideoToBlog(conversions, posts);
  assert.equal(result.length, 1);
  assert.equal(result[0].topic, '허리디스크 증상');
});

test('후속 글 추천: sourcePostId 가 조회 범위 밖이면 sourceKeyword 폴백, 그것도 없으면 생략', () => {
  const posts = [post({ id: 'p9', title: '무관한 글', keyword: '무관' })];
  const withKeyword = [
    conv({ conversionId: 'c1', texts: [], sourcePostId: 'gone', sourceKeyword: '임플란트' }),
  ];
  assert.equal(recommendVideoToBlog(withKeyword, posts)[0]?.topic, '임플란트');
  // source 는 있었지만 특정 실패 → 토큰 매칭으로 넘기지 않고 생략 (오연결 방지)
  const unresolvable = [
    conv({ conversionId: 'c2', texts: ['무관한 글 이야기'], sourcePostId: 'gone' }),
  ];
  assert.deepEqual(recommendVideoToBlog(unresolvable, posts), []);
});
