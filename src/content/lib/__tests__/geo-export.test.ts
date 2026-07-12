import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExportFilename,
  buildGeoExportHtml,
  escapeHtml,
  renderBodyHtml,
  type GeoExportInput,
} from '../geo-export.ts';

// ---------------------------------------------------------------------------
// 픽스처
// ---------------------------------------------------------------------------

const BODY_TEXT = `허리 디스크 초기 증상은 아침에 더 묵직하게 느껴지는 경우가 많습니다.

허리 디스크, 왜 생기는 걸까요

디스크는 척추뼈 사이에서 충격을 흡수하는 쿠션입니다. 오래 앉아 있으면 부담이 커집니다.

▶ 오래 앉는 습관이 미치는 영향

앉은 자세는 서 있을 때보다 허리에 더 큰 압력을 줍니다.`;

function baseInput(overrides: Partial<GeoExportInput> = {}): GeoExportInput {
  return {
    title: '허리 디스크 초기 증상, 어떻게 알 수 있을까요',
    bodyText: BODY_TEXT,
    metaDescription: '허리 디스크는 척추뼈 사이 쿠션이 밀려나 신경을 누르는 상태입니다.',
    jsonLd: '{\n  "@type": "Article"\n}',
    summaryLines: [
      '허리 디스크는 척추뼈 사이 쿠션이 밀려나 신경을 누르는 상태입니다',
      '초기에는 다리 저림으로 먼저 나타나는 경우가 많습니다',
    ],
    faqItems: [
      { question: '허리 디스크 초기에는 어떤 증상이 나타나나요?', answer: '다리 저림이 먼저 나타나는 경우가 많습니다.' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 필수 메타·문서 골격
// ---------------------------------------------------------------------------

test('문서 골격: doctype·charset·title·meta description·JSON-LD·canonical 안내가 모두 존재한다', () => {
  const html = buildGeoExportHtml(baseInput());
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<html lang="ko">'));
  assert.ok(html.includes('<meta charset="utf-8" />'));
  assert.ok(html.includes('<title>허리 디스크 초기 증상, 어떻게 알 수 있을까요</title>'));
  assert.ok(html.includes('<meta name="description" content="허리 디스크는 척추뼈 사이 쿠션이 밀려나 신경을 누르는 상태입니다." />'));
  assert.ok(html.includes('<script type="application/ld+json">'));
  assert.ok(html.includes('"@type": "Article"'));
  assert.ok(html.includes('병원 홈페이지 주소로 canonical 을 설정하세요'));
  assert.ok(html.includes('이 파일은 병원 공식 홈페이지 게시용입니다. 네이버 블로그와 함께 발행하면 검색과 AI 인용을 모두 준비할 수 있습니다.'));
});

test('문서 구조: h1 제목 + 요약 섹션 + h2/h3 본문 + FAQ 섹션(시맨틱)', () => {
  const html = buildGeoExportHtml(baseInput());
  assert.ok(html.includes('<h1>허리 디스크 초기 증상, 어떻게 알 수 있을까요</h1>'));
  assert.ok(html.includes('<section aria-label="핵심 요약">'));
  assert.ok(html.includes('<li>허리 디스크는 척추뼈 사이 쿠션이 밀려나 신경을 누르는 상태입니다</li>'));
  assert.ok(html.includes('<h2>허리 디스크, 왜 생기는 걸까요</h2>'));
  assert.ok(html.includes('<h3>오래 앉는 습관이 미치는 영향</h3>'));
  assert.ok(html.includes('<section aria-label="자주 묻는 질문">'));
  assert.ok(html.includes('<h3>허리 디스크 초기에는 어떤 증상이 나타나나요?</h3>'));
  assert.ok(html.includes('<p>다리 저림이 먼저 나타나는 경우가 많습니다.</p>'));
});

test('생략: 요약·FAQ 가 비면 해당 섹션 자체가 없다', () => {
  const html = buildGeoExportHtml(baseInput({ summaryLines: [], faqItems: [] }));
  assert.ok(!html.includes('<section aria-label="핵심 요약">'));
  assert.ok(!html.includes('<section aria-label="자주 묻는 질문">'));
  assert.ok(html.includes('<h1>')); // 본문은 그대로
});

// ---------------------------------------------------------------------------
// XSS 가드
// ---------------------------------------------------------------------------

test('HTML 이스케이프: 본문·제목의 태그 문자가 태그로 해석되지 않는다', () => {
  const html = buildGeoExportHtml(baseInput({
    title: '제목 <img src=x onerror=alert(1)>',
    bodyText: '단락에 <script>alert(1)</script> 이 섞여 있습니다.',
    metaDescription: '설명 "quoted" & <tag>',
    summaryLines: ['요약 <b>줄</b>'],
    faqItems: [{ question: '질문 <i>?', answer: '답변 <u>.' }],
  }));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('content="설명 &quot;quoted&quot; &amp; &lt;tag&gt;"'));
  assert.ok(html.includes('요약 &lt;b&gt;줄&lt;/b&gt;'));
  assert.ok(html.includes('질문 &lt;i&gt;?'));
});

test('JSON-LD 가드: jsonLd 에 "</script" 가 남아 있어도 방어적으로 이스케이프된다', () => {
  const html = buildGeoExportHtml(baseInput({
    jsonLd: '{ "headline": "제목 </script><script>alert(1)</script>" }',
  }));
  // 문서 전체에서 "</script" 는 ld+json 닫는 태그 1개뿐이어야 한다
  const occurrences = html.split('</script').length - 1;
  assert.equal(occurrences, 1);
  assert.ok(html.includes('<\\/script>'));
});

test('escapeHtml: 5개 특수문자 전부 치환', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

// ---------------------------------------------------------------------------
// 본문 변환 규칙
// ---------------------------------------------------------------------------

test('본문 변환: 문장(마침표 종결) 단독 줄은 h2 가 아니라 단락', () => {
  const html = renderBodyHtml('짧지만 문장으로 끝나는 줄입니다.');
  assert.ok(html.startsWith('<p>'));
  assert.ok(!html.includes('<h2>'));
});

test('본문 변환: 블록 내 여러 줄은 <br /> 로 유지된 하나의 단락', () => {
  const html = renderBodyHtml('첫 줄이 여기에 이어지고 있습니다.\n둘째 줄도 이어집니다.');
  assert.equal(html, '<p>첫 줄이 여기에 이어지고 있습니다.<br />둘째 줄도 이어집니다.</p>');
});

test('본문 변환: ▶ 줄이 블록 중간에 섞여도 h3 로 분리된다', () => {
  const html = renderBodyHtml('앞 단락 문장입니다.\n▶ 세부 소제목\n뒤 단락 문장입니다.');
  assert.ok(html.includes('<p>앞 단락 문장입니다.</p>'));
  assert.ok(html.includes('<h3>세부 소제목</h3>'));
  assert.ok(html.includes('<p>뒤 단락 문장입니다.</p>'));
});

// ---------------------------------------------------------------------------
// 파일명
// ---------------------------------------------------------------------------

test('파일명: 한글 보존 + 공백 하이픈 + 금지 문자 제거 + .html', () => {
  assert.equal(
    buildExportFilename('허리 디스크 초기 증상'),
    '허리-디스크-초기-증상.html',
  );
  assert.equal(buildExportFilename('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij.html');
});

test('파일명: 빈 제목·기호만 있는 제목은 폴백', () => {
  assert.equal(buildExportFilename(''), 'doctorpost-geo.html');
  assert.equal(buildExportFilename('???///'), 'doctorpost-geo.html');
});

test('파일명: 60자 상한', () => {
  const name = buildExportFilename('가'.repeat(200));
  assert.equal(name, `${'가'.repeat(60)}.html`);
});
