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
import { toNaverFormat } from '../naver-format.ts';

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

test('직답: "방법"·"이유"가 든 평서형 소제목은 질문형으로 보지 않는다', () => {
  // 물음표도 의문 어미도 없는 명사구 — 질문 의도가 없으므로 직답 점수 대상이 아님
  assert.equal(hasAnswerFirstSection(`여드름 흉터 치료 방법과 주의사항\n\n${ANSWER_PARAGRAPH}`), false);
  assert.equal(hasAnswerFirstSection(`여드름 흉터가 남는 이유 세 가지\n\n${ANSWER_PARAGRAPH}`), false);
  // 같은 낱말이라도 의문 어미가 붙으면 질문형
  assert.equal(hasAnswerFirstSection(`어떤 방법으로 치료하나요\n\n${ANSWER_PARAGRAPH}`), true);
});

test('직답: 물음표 뒤에 부연이 붙은 소제목도 질문형으로 인정', () => {
  assert.equal(
    hasAnswerFirstSection(`치료는 얼마나 걸리나요? (평균 기간)\n\n${ANSWER_PARAGRAPH}`),
    true,
  );
});

test('직답: 40자를 넘는 긴 질문형 소제목도 인정 (지역·시술명 결합)', () => {
  const longHeading = '강남 여드름 흉터 프락셀 레이저 치료는 보통 얼마나 걸리고 몇 번쯤 받아야 하나요';
  assert.ok(longHeading.length > 40, '전제: 40자 초과 소제목');
  assert.ok(longHeading.length <= 60, '전제: 소제목 상한 60자 이내');
  assert.equal(hasAnswerFirstSection(`${longHeading}\n\n${ANSWER_PARAGRAPH}`), true);
});

test('직답: 소제목 상한(60자)을 넘는 줄은 본문으로 보고 소제목 취급하지 않음', () => {
  const tooLong = `${'가'.repeat(61)}는 왜 생기나요`;
  assert.equal(hasAnswerFirstSection(`${tooLong}\n\n${ANSWER_PARAGRAPH}`), false);
});

test('직답: 문장마다 줄을 바꿔도 한 단락으로 합산 (45자 + 45자 = 90자)', () => {
  const line1 = `${'가'.repeat(44)}.`;
  const line2 = `${'나'.repeat(44)}.`;
  assert.equal(line1.length, 45);
  assert.equal(line2.length, 45);
  assert.equal(hasAnswerFirstSection(`치료는 얼마나 걸리나요\n${line1}\n${line2}`), true);

  // 합산해도 기준 미달이면 여전히 미통과 (35 + 35 = 70자)
  const short1 = `${'가'.repeat(34)}.`;
  const short2 = `${'나'.repeat(34)}.`;
  assert.equal(hasAnswerFirstSection(`치료는 얼마나 걸리나요\n${short1}\n${short2}`), false);
});

test('직답: 단락이 끝난 뒤(빈 줄 이후) 문장은 합산하지 않는다', () => {
  const first = `${'가'.repeat(34)}.`;   // 35자 — 기준 미달
  const later = `${'나'.repeat(99)}.`;   // 다른 단락이라 합산 대상 아님
  assert.equal(hasAnswerFirstSection(`치료는 얼마나 걸리나요\n${first}\n\n${later}`), false);
});

test('직답: 전각 종결부호(。！？)도 문장 종결로 인식', () => {
  const fullWidth = `${'가'.repeat(79)}。`;
  assert.equal(fullWidth.length, 80);
  assert.equal(hasAnswerFirstSection(`치료는 얼마나 걸리나요\n\n${fullWidth}`), true);
  // 전각 물음표로 끝나는 소제목도 질문형
  assert.equal(hasAnswerFirstSection(`치료는 얼마나 걸리나요？\n\n${ANSWER_PARAGRAPH}`), true);
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

  // 닫는 마커가 유실된 원본 마커도 열림-only 폴백으로 제외 ([/자주 묻는 질문] 없음)
  const unclosedFaq = ['[자주 묻는 질문]', 'Q1. 흉터는 왜 생기나요?', `A1. ${ANSWER_PARAGRAPH}`].join('\n');
  assert.equal(hasAnswerFirstSection(unclosedFaq), false);
});

test('직답: 닫는 마커가 유실돼도 본문의 직답은 그대로 인정 (FAQ 앞 구간은 보존)', () => {
  const content = [
    '[핵심 요약]',
    '요약 한 줄입니다.',
    '', // [/핵심 요약] 유실
    '여드름 흉터는 왜 생기나요',
    '',
    ANSWER_PARAGRAPH,
    '',
    '[자주 묻는 질문]', // [/자주 묻는 질문] 유실
    'Q1. 질문',
    'A1. 답',
  ].join('\n');
  assert.equal(hasAnswerFirstSection(content), true);
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

// --- 요약 블록 경계 (닫는 마커 유실·네이버 변환본) -------------------------

test('직답: 닫는 마커가 유실된 [핵심 요약] 안의 물음표 문장은 소제목이 아니다', () => {
  // 요약 줄에 물음표 문장이 섞이면 소제목으로 오인돼 다음 요약 줄이 직답으로 집계된다
  const unclosedSummary = ['[핵심 요약]', '치료는 얼마나 걸리나요?', ANSWER_PARAGRAPH].join('\n');
  assert.equal(hasAnswerFirstSection(unclosedSummary), false);

  // 네이버 변환본(■ 핵심 요약)은 애초에 닫는 마커가 없어 상시 이 경로를 탄다
  const naverSummary = ['■ 핵심 요약', '치료는 얼마나 걸리나요?', ANSWER_PARAGRAPH].join('\n');
  assert.equal(hasAnswerFirstSection(naverSummary), false);

  // 요약 줄이 여러 개여도 동일 (빈 줄이 없어도 종결부호 있는 줄은 전부 요약)
  const manyLines = [
    '■ 핵심 요약',
    '요약 한 줄입니다.',
    '요약 두 줄입니다.',
    '요약 세 줄입니다.',
    '치료는 얼마나 걸리나요?',
    ANSWER_PARAGRAPH,
  ].join('\n');
  assert.equal(hasAnswerFirstSection(manyLines), false);
});

test('직답: 종결부호 없는 요약 줄도 소제목으로 새지 않는다 (뒤에 빈 줄이 없으면 요약)', () => {
  // 물음표 없이 "…나요"로 끝나는 요약 줄 — 종결부호 유무만으로는 H2 와 구분되지 않는다
  const noPunctuation = ['■ 핵심 요약', '치료는 얼마나 걸리나요', ANSWER_PARAGRAPH].join('\n');
  assert.equal(hasAnswerFirstSection(noPunctuation), false);

  const bracketed = ['[핵심 요약]', '치료는 얼마나 걸리나요', ANSWER_PARAGRAPH].join('\n');
  assert.equal(hasAnswerFirstSection(bracketed), false);

  // 요약 줄이 여러 개이고 그중 하나가 종결부호 없는 질문형이어도 동일
  const mixed = [
    '■ 핵심 요약',
    '요약 한 줄입니다.',
    '치료는 얼마나 걸리나요',
    ANSWER_PARAGRAPH,
  ].join('\n');
  assert.equal(hasAnswerFirstSection(mixed), false);
});

test('직답: 빈 줄 뒤의 비질문형 H2 도 직답에 흡수하지 않는다', () => {
  // 소제목 → 빈 줄 → 비질문형 H2 → (빈 줄 유실) → 본문.
  // H2 와 본문이 합쳐져 앞 질문의 직답으로 계산되면 안 된다.
  const content = [
    '치료는 얼마나 걸리나요',
    '',
    '치료 과정과 주의사항', // 비질문형 H2 (질문형 차단에 안 걸림)
    ANSWER_PARAGRAPH,
  ].join('\n');
  assert.equal(hasAnswerFirstSection(content), false);

  // 대조군: 같은 자리에 실제 직답이 오면 정상 인정
  const withAnswer = ['치료는 얼마나 걸리나요', '', ANSWER_PARAGRAPH].join('\n');
  assert.equal(hasAnswerFirstSection(withAnswer), true);
});

test('직답: 요약 직후 소제목(종결부호 없음)은 요약으로 흡수하지 않는다', () => {
  // toNaverFormat 이 [/핵심 요약] 과 뒤따르는 빈 줄까지 제거해 첫 H2 가 요약 줄에 바로 붙는다
  const content = [
    '■ 핵심 요약',
    '요약 한 줄입니다.',
    '요약 두 줄입니다.',
    '여드름 흉터는 왜 생기나요', // 빈 줄 없이 바로 붙은 첫 H2
    '',
    ANSWER_PARAGRAPH,
  ].join('\n');
  assert.equal(hasAnswerFirstSection(content), true);
});

test('직답: 네이버 발행 변환(toNaverFormat) 왕복 후에도 판정이 같다', () => {
  const body = [
    '도입 단락입니다.',
    '',
    '[핵심 요약]',
    '요약 첫 줄입니다.',
    '요약 둘째 줄입니다.',
    '[/핵심 요약]',
    '',
    '여드름 흉터는 왜 생기나요',
    '',
    ANSWER_PARAGRAPH,
    '',
    '[자주 묻는 질문]',
    'Q1. 질문',
    'A1. 답',
    '[/자주 묻는 질문]',
  ].join('\n');
  assert.equal(hasAnswerFirstSection(body), true);
  assert.equal(hasAnswerFirstSection(toNaverFormat(body)), true);

  // 직답만 짧게 바꾸면 원본·변환본 모두 미통과 (변환이 판정을 뒤집지 않는다)
  const weak = body.replace(ANSWER_PARAGRAPH, '네, 맞습니다.');
  assert.equal(hasAnswerFirstSection(weak), false);
  assert.equal(hasAnswerFirstSection(toNaverFormat(weak)), false);

  // 요약 줄 수가 흔들려도(2줄·4줄) 첫 H2 를 요약으로 삼키지 않는다
  const withSummaryLines = (lines: string[]) =>
    toNaverFormat(
      [
        '[핵심 요약]',
        ...lines,
        '[/핵심 요약]',
        '',
        '여드름 흉터는 왜 생기나요',
        '',
        ANSWER_PARAGRAPH,
      ].join('\n'),
    );
  assert.equal(hasAnswerFirstSection(withSummaryLines(['한 줄입니다.', '두 줄입니다.'])), true);
  assert.equal(
    hasAnswerFirstSection(withSummaryLines(['한 줄.', '두 줄.', '세 줄.', '네 줄.'])),
    true,
  );
});

// --- 소제목 오인 방지 (다음 H2 흡수·위치 조건) -----------------------------

test('직답: 빈 줄이 유실돼도 다음 H2 를 직답의 첫 문장으로 흡수하지 않는다', () => {
  // 소제목 + 다음 소제목(59자, 물음표 종결) + 짧은 답 = 합치면 80자를 넘지만 직답은 없다
  const nextHeading = `${'가'.repeat(50)}는 어떻게 하나요?`;
  const shortAnswer = `${'나'.repeat(29)}.`;
  assert.ok(nextHeading.length <= 60, '전제: 소제목 상한 이내');
  assert.ok(nextHeading.length + shortAnswer.length >= 80, '전제: 흡수하면 기준을 넘김');
  assert.equal(
    hasAnswerFirstSection(['첫 치료는 어떻게 진행하나요', nextHeading, shortAnswer].join('\n')),
    false,
  );
});

test('직답: 본문 중간의 의문 표현 줄은 소제목이 아니다 (앞이 빈 줄이어야 소제목)', () => {
  // 줄바꿈으로 끊긴 본문 줄이 의문 표현을 담았다는 이유만으로 소제목이 되면 안 된다
  const midProse = ['앞 단락 문장입니다.', '그럼 언제 병원에 가야 할까요?', ANSWER_PARAGRAPH].join('\n');
  assert.equal(hasAnswerFirstSection(midProse), false);

  const wrappedLong = ['앞 단락 문장입니다.', `${'가'.repeat(45)} 왜 그런가 하면`, '', ANSWER_PARAGRAPH].join('\n');
  assert.equal(hasAnswerFirstSection(wrappedLong), false);

  // 같은 줄이라도 빈 줄 뒤 독립 줄이면 소제목으로 인정
  const standalone = ['앞 단락 문장입니다.', '', '그럼 언제 병원에 가야 할까요?', '', ANSWER_PARAGRAPH].join('\n');
  assert.equal(hasAnswerFirstSection(standalone), true);
});

test('직답: 번호로 시작하는 줄(수동 편집 FAQ·목록)은 소제목이 아니다', () => {
  assert.equal(hasAnswerFirstSection(`1. 흉터는 왜 생기나요?\n${ANSWER_PARAGRAPH}`), false);
  assert.equal(hasAnswerFirstSection(`Q. 흉터는 왜 생기나요?\nA. ${ANSWER_PARAGRAPH}`), false);
});

test('직답: 줄바꿈 합산은 한 줄로 폈을 때와 같은 길이로 계산한다 (공백 복원)', () => {
  const heading = '치료는 얼마나 걸리나요';
  // 첫 줄은 완결 문장(= 소제목 형태가 아님), 둘째 문장만 줄바꿈으로 끊긴 단락
  const line1 = `${'가'.repeat(29)}.`;  // 30자
  const line2 = '나'.repeat(25);        // 25자 (문장 중간)
  const line3 = `${'다'.repeat(22)}.`;  // 23자
  const contentLength = line1.length + line2.length + line3.length;
  assert.equal(contentLength, 78, '전제: 글자만 더하면 78자로 기준 미달');
  assert.equal([line1, line2, line3].join(' ').length, 80, '전제: 공백 복원 시 80자');

  // join('') 이면 78자로 미달 처리된다 — 한 줄로 폈을 때의 공백까지 세야 통과
  assert.equal(hasAnswerFirstSection(`${heading}\n\n${line1}\n${line2}\n${line3}`), true);
  assert.equal(
    hasAnswerFirstSection(`${heading}\n\n${[line1, line2, line3].join(' ')}`),
    true,
  );
});

test('직답: 단락 첫 줄이 문장 중간에서 끊기면 인정하지 않는다 (오탐 방지 대가)', () => {
  // 첫 줄이 짧고 종결부호가 없으면 "다음 H2"와 줄 모양이 같아 구분이 불가능하다.
  // 없는 직답을 인정하는 오탐보다 안전한 false negative 쪽으로 기울인 결과다.
  const wrappedFirst = '치료 방향은 환자의 상태와 흉터 깊이, 그리고 치료 범위에 따라 달라지기 때문에';
  const wrappedRest = '보통 4주 간격으로 서너 번에 나눠 진행하면서 회복 속도를 함께 확인합니다.';
  assert.ok(`${wrappedFirst} ${wrappedRest}`.length >= 80, '전제: 한 줄이면 기준 충족');
  assert.equal(
    hasAnswerFirstSection(`치료는 얼마나 걸리나요\n\n${wrappedFirst}\n${wrappedRest}`),
    false,
  );
  // 같은 내용을 한 줄로 쓰면(정상 생성물의 형태) 그대로 인정된다
  assert.equal(
    hasAnswerFirstSection(`치료는 얼마나 걸리나요\n\n${wrappedFirst} ${wrappedRest}`),
    true,
  );
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
