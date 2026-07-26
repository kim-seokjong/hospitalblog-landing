import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateWeeklyCitations,
  buildGeoQuestions,
  detectCitation,
  hasAnswerFirstSection,
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

test('질문 생성: 지역+진료과+키워드 2개 → 5개 질문 (의도별로 서로 다름)', () => {
  const questions = buildGeoQuestions({
    region: '대구 수성구',
    specialty: '피부과',
    hospitalKeywords: ['여드름 흉터', '레이저 토닝'],
  });
  assert.equal(questions.length, 5);
  assert.equal(questions[0], '대구 수성구 피부과 추천해줘');
  assert.match(questions[1], /여드름 흉터/);
  assert.match(questions[1], /대구 수성구/);
  assert.match(questions[2], /레이저 토닝/);
  assert.match(questions[2], /어디로 가야 해/);
  assert.equal(questions[3], '대구 수성구 피부과 중에 잘하는 곳 세 군데만 알려줘');
  assert.equal(questions[4], '대구 수성구 피부과 중에 어디가 제일 유명해?');
  assert.equal(new Set(questions).size, questions.length);
});

test('질문 생성: 첫 질의는 개인정보가 없어 회원 간 캐시 공유가 가능해야 한다', () => {
  const profileA = { region: '대구 수성구', specialty: '피부과', hospitalKeywords: ['여드름'] };
  const profileB = { region: '대구 수성구', specialty: '피부과', hospitalKeywords: ['모공'] };
  assert.equal(buildGeoQuestions(profileA)[0], buildGeoQuestions(profileB)[0]);
});

test('질문 생성: 지역 없이 진료과만 → 전국 단위 질의는 1개만 (비용 방어)', () => {
  const questions = buildGeoQuestions({
    region: null,
    specialty: '치과',
    hospitalKeywords: [],
  });
  assert.equal(questions.length, 1);
  assert.equal(questions[0], '치과 잘하는 병원 추천해줘');
});

test('질문 생성: 키워드 없이 지역+진료과 → 지역 기반 변형으로 4개까지 보충', () => {
  const questions = buildGeoQuestions({
    region: '강남구',
    specialty: '정형외과',
    hospitalKeywords: null,
  });
  assert.equal(questions.length, 4);
  assert.equal(questions[0], '강남구 정형외과 추천해줘');
  assert.equal(questions[1], '강남구 정형외과 어디가 좋아?');
  assert.equal(questions[2], '강남구 정형외과 중에 잘하는 곳 세 군데만 알려줘');
  assert.equal(questions[3], '강남구 정형외과 중에 어디가 제일 유명해?');
});

test('질문 생성: 진료과 없이 지역+키워드 → 키워드 기반 질의로 생성', () => {
  const questions = buildGeoQuestions({
    region: '수성구',
    specialty: null,
    hospitalKeywords: ['임플란트'],
  });
  assert.deepEqual(questions, [
    '수성구에서 임플란트 잘하는 병원 어디야?',
    '수성구에서 임플란트 잘하는 병원 세 군데만 알려줘',
    '수성구에서 임플란트으로 유명한 병원 알려줘',
  ]);
});

test('질문 생성: 재료 전무 → 빈 배열 (질의 스킵)', () => {
  const questions = buildGeoQuestions({ region: '', specialty: '', hospitalKeywords: [] });
  assert.deepEqual(questions, []);
});

test('질문 생성: 상한 5개 초과 금지 + 중복 제거', () => {
  assert.equal(MAX_QUESTIONS_PER_USER, 5);
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

// 질문형 소제목 아래 자족 직답(80자 이상, 종결된 문장)
const ANSWER_PARAGRAPH =
  '여드름 흉터는 염증이 가라앉은 뒤 피부 속 콜라겐이 고르지 않게 채워지면서 남는 자국입니다. 흉터 모양에 따라 관리 방향이 달라져 진료실에서는 유형부터 확인합니다.';

const GOOD_POST = {
  title: '여드름 흉터 치료는 어떻게 하나요?',
  content: [
    '[핵심 요약]',
    '요약 3줄',
    '[/핵심 요약]',
    '',
    '여드름 흉터는 왜 생기나요',
    '',
    ANSWER_PARAGRAPH,
    '',
    '▶ 원인',
    '본문',
    '',
    '[자주 묻는 질문]',
    'Q1. 질문',
    'A1. 답',
    '[/자주 묻는 질문]',
  ].join('\n'),
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
  assert.equal(result.tips.length, 5);
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
      content: [
        '■ 핵심 요약',
        '요약',
        '',
        '임플란트 비용은 어떻게 정해지나요',
        '',
        '임플란트 비용은 잇몸뼈 상태와 뼈 이식 여부, 사용하는 픽스처와 보철 재료에 따라 달라집니다. 진료실에서는 먼저 잇몸뼈부터 확인한 뒤 필요한 단계를 안내드립니다.',
        '',
        '▶ 소제목',
        '본문',
        '',
        '■ 자주 묻는 질문',
        'Q1. 질문',
        'A1. 답',
      ].join('\n'),
    },
  ]);
  assert.ok(result);
  assert.equal(result.score, 100);
});

// ---------------------------------------------------------------------------
// 직답(answer-first) 검사 — 준비도 점수의 신규 항목
// ---------------------------------------------------------------------------

function answerFirstPassed(post: { title: string; content: string }): boolean {
  const result = scoreGeoReadiness([post]);
  return result?.checks.find((c) => c.id === 'answerFirst')?.passed === 1;
}

test('직답: 질문형 소제목 아래 자족 직답 → 통과', () => {
  assert.equal(hasAnswerFirstSection(`여드름 흉터는 왜 생기나요\n\n${ANSWER_PARAGRAPH}`), true);
});

test('직답: 질문형 소제목은 있으나 답이 짧으면 → 미통과', () => {
  assert.equal(hasAnswerFirstSection('여드름 흉터는 왜 생기나요\n\n네, 맞습니다.'), false);
});

test('직답: 소제목이 평서형이면(질문형 아님) → 미통과', () => {
  assert.equal(hasAnswerFirstSection(`여드름 흉터 관리 원칙\n\n${ANSWER_PARAGRAPH}`), false);
});

test('직답: FAQ 블록의 Q/A 는 직답으로 인정하지 않음 (항목 중복 방지)', () => {
  const faqOnly = [
    '[자주 묻는 질문]',
    'Q1. 여드름 흉터는 왜 생기나요?',
    `A1. ${ANSWER_PARAGRAPH}`,
    '[/자주 묻는 질문]',
  ].join('\n');
  assert.equal(hasAnswerFirstSection(faqOnly), false);

  // 네이버 발행 변환본(닫는 마커 없음)도 동일하게 제외
  const naverFaqOnly = ['■ 자주 묻는 질문', 'Q1. 흉터는 왜 생기나요?', `A1. ${ANSWER_PARAGRAPH}`].join('\n');
  assert.equal(hasAnswerFirstSection(naverFaqOnly), false);
});

test('직답: ▶ 세부 소제목(H3)이 질문형이어도 인정', () => {
  assert.equal(hasAnswerFirstSection(`▶ 치료는 얼마나 걸리나요\n\n${ANSWER_PARAGRAPH}`), true);
});

test('직답: 소제목과 직답 사이 [이미지 N] 마커는 건너뜀', () => {
  const content = `치료는 얼마나 걸리나요\n\n[이미지 1: 상담 장면]\n\n${ANSWER_PARAGRAPH}`;
  assert.equal(hasAnswerFirstSection(content), true);
});

test('직답: 경계 — 80자 종결 문장은 통과, 79자는 미통과', () => {
  const heading = '치료는 얼마나 걸리나요';
  const exactly80 = `${'가'.repeat(79)}.`;
  const only79 = `${'가'.repeat(78)}.`;
  assert.equal(exactly80.length, 80);
  assert.equal(hasAnswerFirstSection(`${heading}\n\n${exactly80}`), true);
  assert.equal(hasAnswerFirstSection(`${heading}\n\n${only79}`), false);
});

test('직답: 종결 부호 없는 미완결 문장은 미통과', () => {
  assert.equal(hasAnswerFirstSection(`치료는 얼마나 걸리나요\n\n${'가'.repeat(200)}`), false);
});

test('직답: 소제목 직후가 다른 소제목이면 미통과', () => {
  const content = `치료는 얼마나 걸리나요\n\n▶ 세부 소제목\n\n${ANSWER_PARAGRAPH}`;
  assert.equal(hasAnswerFirstSection(content), false);
});

test('준비도: answerFirst 항목이 점수에 반영됨 (직답 있음 20점 차)', () => {
  const withAnswer = {
    title: '병원 소식',
    content: `여드름 흉터는 왜 생기나요\n\n${ANSWER_PARAGRAPH}`,
  };
  const withoutAnswer = { title: '병원 소식', content: '여드름 흉터는 왜 생기나요\n\n짧은 답.' };
  assert.equal(answerFirstPassed(withAnswer), true);
  assert.equal(answerFirstPassed(withoutAnswer), false);
  assert.equal(scoreGeoReadiness([withAnswer])?.score, 20);
  assert.equal(scoreGeoReadiness([withoutAnswer])?.score, 0);
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
