import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY_MIN_CHARS,
  EMPTY_POST_SEO,
  KEYWORD_REPEAT_PER_1000_MAX,
  SEO_POST_LIMIT,
  TITLE_MAX_CHARS,
  TITLE_MIN_CHARS,
  aggregateVerdicts,
  analyzePostSeo,
  classifyBodyKind,
  countOccurrences,
  countSectionHeadings,
  judgePost,
  judgeTopicVariety,
  maxKeywordRepeatRate,
  titleHasSearchKeyword,
  toParagraphBlocks,
  toParagraphText,
  type SeoClinicContext,
  type SeoPostInput,
} from '../post-seo.ts';

/**
 * 최근 글 SEO 점검 — 판정 경계와 "확보 수준에 따른 판정 범위"를 고정한다.
 * 특히 요약만 확보된 글에서 분량·구조를 판정하지 않는 것(오진 방지)이 핵심 계약이다.
 */

const CLINIC: SeoClinicContext = { region: '중구', shortProvince: '대구', specialty: '성형외과' };

/** 소제목 2개 + 각 소제목 아래 직답이 있는 잘 쓴 글. */
function goodBody(): string {
  const filler = '수술 후에는 붓기와 멍이 생길 수 있으며 회복 기간에는 개인차가 있습니다. '.repeat(20);
  return [
    '이중턱근육묶기란 무엇인가요',
    '이중턱근육묶기는 턱 아래에 늘어진 활경근을 중앙으로 모아 단단하게 고정하는 수술을 말합니다. 지방만 제거해서는 턱선이 기대만큼 정리되지 않는 경우에 함께 고려하게 되는 방법입니다.',
    filler,
    '회복 기간은 얼마나 걸리나요',
    '일상 복귀는 보통 일주일 안팎이며 붓기가 자연스럽게 가라앉기까지는 한 달 정도를 보는 편입니다. 회복 속도와 붓기가 빠지는 정도는 사람마다 차이가 있을 수 있습니다.',
    filler,
  ].join('\n');
}

const GOOD_POST: SeoPostInput = {
  title: '대구이중턱근육묶기, 또렷한 턱선 만드는 방법',
  link: 'https://blog.naver.com/x/1',
  body: goodBody(),
  bodyKind: 'full',
  hasImage: true,
};

/* ── 확보 수준 판정 ─────────────────────────────────────── */

test('본문을 못 받으면 none', () => {
  assert.equal(classifyBodyKind('', false), 'none');
  assert.equal(classifyBodyKind('   ', false), 'none');
});

test('본문 페이지에서 받아온 것은 짧아도 전문으로 본다', () => {
  assert.equal(classifyBodyKind('짧은 글입니다.', true), 'full');
});

test('네이버가 잘라 준 RSS 요약(.......)은 전문으로 세지 않는다', () => {
  const cut = `${'가'.repeat(400)}.......`;
  assert.equal(classifyBodyKind(cut, false), 'summary');
});

test('RSS가 본문을 통째로 주면 전문으로 인정한다', () => {
  assert.equal(classifyBodyKind('가'.repeat(800), false), 'full');
  assert.equal(classifyBodyKind('가'.repeat(300), false), 'summary');
});

/* ── 본문 구조 복원 ─────────────────────────────────────── */

test('빈 줄이 사라진 본문에서도 소제목과 단락을 되살린다', () => {
  const blocks = toParagraphBlocks(goodBody());
  const headings = blocks.filter((b) => b.kind === 'heading').map((b) => b.text);
  assert.deepEqual(headings, ['이중턱근육묶기란 무엇인가요', '회복 기간은 얼마나 걸리나요']);
});

test('줄바꿈으로 끊긴 문장은 한 단락으로 다시 붙인다', () => {
  const blocks = toParagraphBlocks(['턱 아래 지방은', '나이가 들면서 늘어날 수 있습니다.'].join('\n'));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'body');
  assert.match(blocks[0].text, /턱 아래 지방은 나이가 들면서/);
});

test('복원한 텍스트는 빈 줄로 구분된다 (직답 판정 입력 형태)', () => {
  assert.match(toParagraphText(goodBody()), /무엇인가요\n\n이중턱근육묶기는/);
});

test('빈 본문에도 죽지 않는다', () => {
  assert.deepEqual(toParagraphBlocks(''), []);
  assert.equal(toParagraphText(''), '');
});

/* ── 제목 판정 ──────────────────────────────────────────── */

test('제목에 지역이나 진료과 어간이 있으면 검색 키워드로 인정한다', () => {
  assert.equal(titleHasSearchKeyword('대구 이중턱 수술 후기', CLINIC), true); // 시·도
  assert.equal(titleHasSearchKeyword('중구에서 상담받고 왔어요', CLINIC), true); // 구·군
  assert.equal(titleHasSearchKeyword('성형 전에 알아야 할 것', CLINIC), true); // 진료과 어간
  assert.equal(titleHasSearchKeyword('오늘 점심 메뉴 추천', CLINIC), false);
  assert.equal(titleHasSearchKeyword('', CLINIC), false);
});

test('제목 길이 경계 — 너무 짧거나 너무 길면 빠짐', () => {
  const base = { link: 'l', body: '', bodyKind: 'summary' as const, hasImage: true };
  assert.equal(judgePost({ ...base, title: '가'.repeat(TITLE_MIN_CHARS - 1) }, CLINIC).titleLength, false);
  assert.equal(judgePost({ ...base, title: '가'.repeat(TITLE_MIN_CHARS) }, CLINIC).titleLength, true);
  assert.equal(judgePost({ ...base, title: '가'.repeat(TITLE_MAX_CHARS) }, CLINIC).titleLength, true);
  assert.equal(judgePost({ ...base, title: '가'.repeat(TITLE_MAX_CHARS + 1) }, CLINIC).titleLength, false);
});

/* ── 억지 반복 ──────────────────────────────────────────── */

test('countOccurrences 는 겹치지 않게 센다', () => {
  assert.equal(countOccurrences('가가가가', '가가'), 2);
  assert.equal(countOccurrences('대구 코성형 대구 코성형', '코성형'), 2);
  assert.equal(countOccurrences('아무거나', ''), 0);
});

test('같은 키워드를 본문에 도배하면 반복률이 상한을 넘는다', () => {
  const stuffed = `${'대구코성형 잘하는 곳 대구코성형 후기 '.repeat(40)}`;
  assert.ok(maxKeywordRepeatRate('대구코성형 잘하는 곳', stuffed) > KEYWORD_REPEAT_PER_1000_MAX);
  assert.ok(maxKeywordRepeatRate('대구코성형 잘하는 곳', goodBody()) <= KEYWORD_REPEAT_PER_1000_MAX);
});

test('긴 롱테일 키워드를 정상 횟수로 쓴 글은 억지 반복이 아니다 (실측 오탐 회귀 방지)', () => {
  // 1,200자 글에 11자 키워드가 5번 — 길이로 밀도를 재던 판에서는 오탐이었다
  const body = `${'대구보조개수술유명한곳 자연스러운 디자인이 중요합니다. 상담에서 충분히 확인해 보세요. '.repeat(5)}${'보조개는 표정에 따라 다르게 보일 수 있습니다. '.repeat(20)}`;
  assert.ok(maxKeywordRepeatRate('대구보조개수술유명한곳, 자연스러운 디자인이 중요한 이유', body) <= KEYWORD_REPEAT_PER_1000_MAX);
});

test('본문이 너무 짧으면 반복률을 재지 않는다 (요동 방지)', () => {
  assert.equal(maxKeywordRepeatRate('코성형', '코성형 코성형'), 0);
});

/* ── 글 1편 판정 범위 ───────────────────────────────────── */

test('전문을 확보한 글은 분량·구조·직답까지 판정한다', () => {
  const verdict = judgePost(GOOD_POST, CLINIC);
  assert.equal(verdict.titleLength, true);
  assert.equal(verdict.titleKeyword, true);
  assert.equal(verdict.image, true);
  assert.equal(verdict.bodyLength, true);
  assert.equal(verdict.subheading, true);
  assert.equal(verdict.answerFirst, true);
  assert.equal(verdict.keywordStuffing, true);
});

test('요약만 확보한 글은 분량·구조를 판정하지 않는다 (없는 것을 부족으로 몰지 않는다)', () => {
  const verdict = judgePost({ ...GOOD_POST, bodyKind: 'summary' }, CLINIC);
  assert.equal(verdict.bodyLength, null);
  assert.equal(verdict.subheading, null);
  assert.equal(verdict.answerFirst, null);
  assert.equal(verdict.keywordStuffing, null);
  // 제목·사진은 요약만 있어도 판정된다
  assert.equal(verdict.titleLength, true);
  assert.equal(verdict.image, true);
});

test('짧고 한 덩어리인 글은 분량·소제목·직답이 전부 빠짐으로 잡힌다', () => {
  const verdict = judgePost(
    {
      title: '오늘도 진료합니다',
      link: 'l',
      body: '오늘도 진료합니다. 편하게 방문해 주세요.',
      bodyKind: 'full',
      hasImage: false,
    },
    CLINIC,
  );
  assert.equal(verdict.bodyLength, false);
  assert.equal(verdict.subheading, false);
  assert.equal(verdict.answerFirst, false);
  assert.equal(verdict.image, false);
});

test('분량 경계 — BODY_MIN_CHARS 는 공백을 뺀 글자 수 기준', () => {
  const make = (chars: number) => '가 '.repeat(chars);
  assert.equal(judgePost({ title: '제목', link: 'l', body: make(BODY_MIN_CHARS - 1), bodyKind: 'full', hasImage: true }, CLINIC).bodyLength, false);
  assert.equal(judgePost({ title: '제목', link: 'l', body: make(BODY_MIN_CHARS), bodyKind: 'full', hasImage: true }, CLINIC).bodyLength, true);
});

/* ── 항목 집계 ──────────────────────────────────────────── */

test('판정 가능한 글이 하나도 없으면 확인 못 함(null)', () => {
  assert.deepEqual(aggregateVerdicts([null, null]), { ok: null, evaluated: 0, passed: 0 });
});

test('충족 비율 60% 이상이면 갖춰짐', () => {
  assert.equal(aggregateVerdicts([true, true, true, false, false]).ok, true); // 60%
  assert.equal(aggregateVerdicts([true, true, false, false, false]).ok, false); // 40%
  assert.equal(aggregateVerdicts([true, null, null]).ok, true); // 판정 가능한 것만 센다
});

/* ── 주제 다양성 ────────────────────────────────────────── */

test('제목이 서로 다르면 통과, 사실상 같은 제목이 많으면 빠짐', () => {
  const varied = ['대구 코성형 후기', '눈매교정 회복 기간', '턱선 정리 상담 사례', '보톡스 주의사항'];
  assert.equal(judgeTopicVariety(varied).ok, true);

  const cloned = Array.from({ length: 6 }, (_, i) => `대구 코성형 잘하는 곳 ${i}`);
  assert.equal(judgeTopicVariety(cloned).ok, false);
});

test('비교할 제목이 부족하면 판정하지 않는다', () => {
  assert.equal(judgeTopicVariety(['하나', '둘']).ok, null);
  assert.equal(judgeTopicVariety([]).ok, null);
});

/* ── 종합 ───────────────────────────────────────────────── */

test('글이 하나도 없으면 checked=false 로 빠진다', () => {
  assert.deepEqual(analyzePostSeo([], CLINIC, []), EMPTY_POST_SEO);
});

test('5편을 넘겨도 최근 5편까지만 본다', () => {
  const posts = Array.from({ length: 9 }, (_, i) => ({ ...GOOD_POST, link: `l${i}` }));
  const result = analyzePostSeo(posts, CLINIC, posts.map((p) => p.title));
  assert.equal(result.postsAnalyzed, SEO_POST_LIMIT);
  assert.equal(result.fullBodies, SEO_POST_LIMIT);
});

test('5편이 안 돼도 있는 만큼으로 판정한다', () => {
  const result = analyzePostSeo([GOOD_POST, { ...GOOD_POST, link: 'l2' }], CLINIC, ['가', '나', '다']);
  assert.equal(result.checked, true);
  assert.equal(result.postsAnalyzed, 2);
});

test('잘 쓴 글만 있으면 빠진 항목이 없다 (칭찬 가능 상태)', () => {
  const posts = [
    GOOD_POST,
    { ...GOOD_POST, title: '중구 눈매교정 회복 기간 정리해 드립니다', link: 'l2' },
    { ...GOOD_POST, title: '대구 보톡스 시술 전 알아둘 주의사항', link: 'l3' },
  ];
  const result = analyzePostSeo(posts, CLINIC, posts.map((p) => p.title));
  assert.equal(result.missingCount, 0);
  assert.ok(result.readyCount >= 7);
});

test('요약만 확보되면 구조 항목이 "확인 못 함"으로 남는다', () => {
  const posts = Array.from({ length: 3 }, (_, i) => ({
    ...GOOD_POST,
    link: `s${i}`,
    body: `${'가'.repeat(300)}.......`,
    bodyKind: 'summary' as const,
  }));
  const result = analyzePostSeo(posts, CLINIC, posts.map((p) => p.title));
  assert.equal(result.fullBodies, 0);
  assert.equal(result.summaryOnly, 3);
  const unknownIds = result.checks.filter((c) => c.ok === null).map((c) => c.id);
  assert.deepEqual(unknownIds.sort(), ['answerFirst', 'bodyLength', 'keywordStuffing', 'subheading']);
});

test('모든 항목에 판정 근거 문구가 붙는다 (화면에 그대로 나간다)', () => {
  const result = analyzePostSeo([GOOD_POST], CLINIC, ['가', '나', '다']);
  for (const check of result.checks) {
    assert.ok(check.label.length > 0, `${check.id} 라벨 없음`);
    assert.ok(check.hint.length > 0, `${check.id} 설명 없음`);
    assert.ok(check.detail.length > 0, `${check.id} 근거 없음`);
  }
  assert.equal(result.readyCount + result.missingCount + result.unknownCount, result.checks.length);
});

test('기술 용어를 항목 이름에 세우지 않는다 (원장이 읽는 화면)', () => {
  const result = analyzePostSeo([GOOD_POST], CLINIC, ['가', '나', '다']);
  const jargon = ['SEO', 'AEO', 'GEO', 'meta', 'H2', 'JSON-LD', 'sitemap', 'robots', '스니펫'];
  for (const check of result.checks) {
    for (const word of jargon) {
      assert.ok(!check.label.includes(word), `${check.id} 라벨에 "${word}" 노출`);
    }
  }
});

test('내용이 따라오지 않는 꼬리 줄(병원명·주소 위젯)은 소제목으로 세지 않는다', () => {
  const body = [
    '이중턱근육묶기란 무엇인가요',
    '이중턱근육묶기는 턱 아래에 늘어진 활경근을 중앙으로 모아 고정하는 수술입니다.',
    '브이성형외과의원',
    '대구광역시 중구 공평로10길 18',
    '이 장소의 다른 글',
    '\u200b',
  ].join('\n');
  assert.equal(countSectionHeadings(toParagraphBlocks(body)), 1);
});

test('폭 없는 공백만 있는 줄은 내용으로 세지 않는다', () => {
  assert.deepEqual(toParagraphBlocks('\u200b\n\ufeff\n'), []);
});
