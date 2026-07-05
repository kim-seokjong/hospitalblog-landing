import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateWeeklyCitations,
  buildGeoQuestions,
  detectCitation,
  hospitalNameVariants,
  mondayOfWeek,
  sanitizeExcerpt,
  scoreGeoReadiness,
  EVIDENCE_MAX_LENGTH,
  MAX_QUESTIONS_PER_USER,
} from '../geo-tracking.ts';

// ---------------------------------------------------------------------------
// 질문 생성
// ---------------------------------------------------------------------------

test('질문 생성: 지역+진료과+키워드 2개 → 3개 질문', () => {
  const questions = buildGeoQuestions({
    region: '대구 수성구',
    specialty: '피부과',
    hospitalKeywords: ['여드름 흉터', '레이저 토닝'],
  });
  assert.equal(questions.length, 3);
  assert.equal(questions[0], '대구 수성구 피부과 추천해줘');
  assert.match(questions[1], /여드름 흉터/);
  assert.match(questions[1], /대구 수성구/);
  assert.match(questions[2], /레이저 토닝/);
  assert.match(questions[2], /어디로 가야 해/);
});

test('질문 생성: 지역 없이 진료과만 → 병원 추천형으로 폴백', () => {
  const questions = buildGeoQuestions({
    region: null,
    specialty: '치과',
    hospitalKeywords: [],
  });
  assert.equal(questions.length, 1);
  assert.equal(questions[0], '치과 잘하는 병원 추천해줘');
});

test('질문 생성: 키워드 없이 지역+진료과 → 변형 질문으로 보충', () => {
  const questions = buildGeoQuestions({
    region: '강남구',
    specialty: '정형외과',
    hospitalKeywords: null,
  });
  assert.equal(questions.length, 2);
  assert.equal(questions[1], '강남구 정형외과 어디가 좋아?');
});

test('질문 생성: 재료 전무 → 빈 배열 (질의 스킵)', () => {
  const questions = buildGeoQuestions({ region: '', specialty: '', hospitalKeywords: [] });
  assert.deepEqual(questions, []);
});

test('질문 생성: 상한 3개 초과 금지 + 중복 제거', () => {
  const questions = buildGeoQuestions({
    region: '서울',
    specialty: '내과',
    hospitalKeywords: ['위내시경', '위내시경', '건강검진', '대장내시경'],
  });
  assert.ok(questions.length <= MAX_QUESTIONS_PER_USER);
  assert.equal(new Set(questions).size, questions.length);
});

// ---------------------------------------------------------------------------
// 인용 판정
// ---------------------------------------------------------------------------

test('인용 판정: 병원명 정확 일치 → hospital_name + 발췌', () => {
  const result = detectCitation(
    { text: '수성구에서는 애플피부과의원이 후기가 좋습니다.', sourceUrls: [] },
    { hospitalName: '애플피부과의원', naverBlogId: null },
  );
  assert.equal(result.cited, true);
  assert.equal(result.citationType, 'hospital_name');
  assert.ok(result.evidence);
  assert.match(result.evidence as string, /애플피부과의원/);
});

test('인용 판정: 공백 변형(애플 피부과 의원)도 매칭', () => {
  const result = detectCitation(
    { text: '1) 애플 피부과 의원 — 범어동 위치', sourceUrls: [] },
    { hospitalName: '애플피부과의원', naverBlogId: null },
  );
  assert.equal(result.cited, true);
  assert.equal(result.citationType, 'hospital_name');
});

test('인용 판정: 접미사(의원) 제거 변형 매칭 — 단 3자 이상일 때만', () => {
  const withSuffix = detectCitation(
    { text: '애플피부과가 유명합니다.', sourceUrls: [] },
    { hospitalName: '애플피부과의원', naverBlogId: null },
  );
  assert.equal(withSuffix.cited, true);

  // 접미사 제거 시 2자("김안")가 되는 이름은 변형을 만들지 않음 (오탐 방어)
  assert.deepEqual(hospitalNameVariants('김안의원'), ['김안의원']);
});

test('인용 판정: 블로그 URL이 출처에 있으면 blog_url (병원명보다 우선)', () => {
  const result = detectCitation(
    {
      text: '애플피부과의원 정보는 블로그를 참고하세요.',
      sourceUrls: ['https://blog.naver.com/2yoonfather/223456'],
    },
    { hospitalName: '애플피부과의원', naverBlogId: '2yoonfather' },
  );
  assert.equal(result.cited, true);
  assert.equal(result.citationType, 'blog_url');
  assert.match(result.evidence as string, /blog\.naver\.com/);
});

test('인용 판정: 미인용 → none + evidence null', () => {
  const result = detectCitation(
    { text: '다른 병원들만 소개된 답변입니다.', sourceUrls: ['https://example.com'] },
    { hospitalName: '애플피부과의원', naverBlogId: '2yoonfather' },
  );
  assert.deepEqual(result, { cited: false, citationType: 'none', evidence: null });
});

test('인용 판정: evidence 는 길이 제한 + 태그 이스케이프 적용', () => {
  const longText = `${'가'.repeat(300)}애플피부과의원<script>alert(1)</script>${'나'.repeat(300)}`;
  const result = detectCitation(
    { text: longText, sourceUrls: [] },
    { hospitalName: '애플피부과의원', naverBlogId: null },
  );
  assert.ok((result.evidence as string).length <= EVIDENCE_MAX_LENGTH);
  assert.doesNotMatch(result.evidence as string, /<script>/);
});

// ---------------------------------------------------------------------------
// 발췌 새니타이즈 (프롬프트 인젝션 방어)
// ---------------------------------------------------------------------------

test('새니타이즈: 태그 이스케이프 + 제어문자 제거 + 개행 접기', () => {
  const out = sanitizeExcerpt('<b>굵게</b>\n\n"따옴표"\u0000\u001f 끝');
  assert.equal(out.includes('<'), false);
  assert.equal(out.includes('>'), false);
  assert.match(out, /&lt;b&gt;/);
  assert.match(out, /&quot;따옴표&quot;/);
  assert.equal(out.includes('\n'), false);
  assert.equal(out.includes('\u0000'), false);
});

test('새니타이즈: 최대 길이 초과 시 말줄임', () => {
  const out = sanitizeExcerpt('가'.repeat(500), 100);
  assert.equal(out.length, 100);
  assert.ok(out.endsWith('…'));
});

// ---------------------------------------------------------------------------
// GEO 준비도 점수
// ---------------------------------------------------------------------------

const GOOD_POST = {
  title: '여드름 흉터 치료는 어떻게 하나요?',
  content: '[핵심 요약]\n요약 3줄\n[/핵심 요약]\n▶ 원인\n본문\n[자주 묻는 질문]\nQ1. 질문\nA1. 답\n[/자주 묻는 질문]',
};
const BARE_POST = { title: '병원 소식', content: '그냥 본문만 있는 글입니다.' };

test('준비도: 글 없음 → null (탭은 안내 문구로 성립)', () => {
  assert.equal(scoreGeoReadiness([]), null);
});

test('준비도: 완전 구조 글 → 100점 우수, 팁 없음', () => {
  const result = scoreGeoReadiness([GOOD_POST]);
  assert.ok(result);
  assert.equal(result.score, 100);
  assert.equal(result.grade, '우수');
  assert.equal(result.tips.length, 0);
});

test('준비도: 구조 없는 글 → 0점 개선 필요 + 항목별 팁 제공', () => {
  const result = scoreGeoReadiness([BARE_POST]);
  assert.ok(result);
  assert.equal(result.score, 0);
  assert.equal(result.grade, '개선 필요');
  assert.equal(result.tips.length, 4);
});

test('준비도: 혼합(완전 1 + 미비 1) → 50점 보통, 충족 글 수 정확', () => {
  const result = scoreGeoReadiness([GOOD_POST, BARE_POST]);
  assert.ok(result);
  assert.equal(result.score, 50);
  assert.equal(result.grade, '보통');
  const summary = result.checks.find((c) => c.id === 'summary');
  assert.equal(summary?.passed, 1);
  assert.equal(summary?.total, 2);
});

test('준비도: 네이버 발행 변환본(■ 핵심 요약 / ■ 자주 묻는 질문)도 인식', () => {
  const result = scoreGeoReadiness([
    {
      title: '임플란트 비용이 궁금하신가요?',
      content: '■ 핵심 요약\n요약\n▶ 소제목\n본문\n■ 자주 묻는 질문\nQ1. 질문\nA1. 답',
    },
  ]);
  assert.ok(result);
  assert.equal(result.score, 100);
});

// ---------------------------------------------------------------------------
// 주간 집계
// ---------------------------------------------------------------------------

test('주간 집계: 같은 주 기록은 합산, 과거→현재 순 정렬', () => {
  const rows = [
    { checkedAt: '2026-06-29T01:00:00Z', cited: true },  // 월요일
    { checkedAt: '2026-07-01T01:00:00Z', cited: false }, // 같은 주 수요일
    { checkedAt: '2026-06-22T01:00:00Z', cited: false }, // 전주 월요일
  ];
  const weekly = aggregateWeeklyCitations(rows);
  assert.equal(weekly.length, 2);
  assert.deepEqual(weekly[0], { weekStart: '2026-06-22', total: 1, cited: 0 });
  assert.deepEqual(weekly[1], { weekStart: '2026-06-29', total: 2, cited: 1 });
});

test('주간 집계: 최대 8주만 반환 + 잘못된 날짜는 무시', () => {
  const rows: Array<{ checkedAt: string; cited: boolean }> = [{ checkedAt: 'invalid', cited: true }];
  for (let i = 0; i < 12; i++) {
    rows.push({ checkedAt: `2026-0${Math.min(9, 1 + Math.floor(i / 4))}-0${1 + (i % 4)}T00:00:00Z`, cited: i % 2 === 0 });
  }
  const weekly = aggregateWeeklyCitations(rows);
  assert.ok(weekly.length <= 8);
});

test('주간 집계: 일요일은 그 주 월요일로 귀속', () => {
  assert.equal(mondayOfWeek('2026-07-05T10:00:00Z'), '2026-06-29'); // 2026-07-05 = 일요일
  assert.equal(mondayOfWeek('2026-06-29T00:00:00Z'), '2026-06-29'); // 월요일 자신
});
