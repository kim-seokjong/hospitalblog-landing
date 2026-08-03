import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosisEmail, MEDLAW_GUIDE_PATH } from '../email-lead.ts';
import type { DiagnosisLeadSummary } from '../conversion.ts';

/**
 * 회귀 고정 — 2026-08-04.
 *
 * 화면에서 해결방법을 가리고 "메일로 보내드립니다" 라고 말한다. 그러니 **메일에
 * 그게 실제로 들어 있어야 한다.** 받아놓고 안 보내면 카피 문제가 아니라 사기다.
 * 이 파일은 그 약속이 코드로 지켜지는지만 본다.
 */

const summary = (over: Partial<DiagnosisLeadSummary> = {}): DiagnosisLeadSummary =>
  ({
    badCount: 2,
    improveCount: 1,
    goodCount: 0,
    unknownCount: 0,
    badScopeCount: 1,
    improveScopeCount: 0,
    ourScopeCount: 1,
    topIssues: ['블로그 발행 중단'],
    daysSinceLatestPost: 200,
    postsPerWeek: 0,
    prohibitedCount: 0,
    cautionCount: 0,
    keywordsChecked: null,
    keywordsTop10: null,
    aiRecommendTotal: null,
    aiRecommendMentioned: null,
    blogId: null,
    siteUrl: null,
    ...over,
  }) as DiagnosisLeadSummary;

const build = (s: DiagnosisLeadSummary | null) =>
  buildDiagnosisEmail({
    clinicName: '테스트치과의원',
    summary: s,
    reportUrl: 'https://www.hospitalblog.kr/clinic-check/r/abc123',
    runAt: '2026-08-04T01:00:00.000Z',
  });

test('해결방법이 메일 본문에 실린다', () => {
  const { html } = build(
    summary({
      actions: [
        { label: '블로그 발행 중단', action: '주 1회부터 다시 시작하세요.', ourScope: true },
        { label: '홈페이지 보안 연결', action: 'SSL 인증서를 적용하세요.', ourScope: false },
      ],
    }),
  );
  assert.match(html, /고치는 방법/);
  assert.match(html, /주 1회부터 다시 시작하세요/);
  assert.match(html, /SSL 인증서를 적용하세요/);
});

/** 우리가 대신하는 항목만 그렇게 표시한다 — 전부 우리 것으로 만들면 광고로 읽힌다. */
test('우리 범위 표시는 해당 항목에만 붙는다', () => {
  const { html } = build(
    summary({
      actions: [
        { label: 'A', action: '가', ourScope: true },
        { label: 'B', action: '나', ourScope: false },
      ],
    }),
  );
  const marks = html.match(/이 항목은 닥터포스트가 대신할 수 있습니다/g) ?? [];
  assert.equal(marks.length, 1);
});

test('의료광고법 가이드 요약본 링크가 함께 나간다', () => {
  const { html } = build(summary({ actions: [{ label: 'A', action: '가', ourScope: false }] }));
  assert.match(html, /가이드 요약본/);
  assert.ok(html.includes(MEDLAW_GUIDE_PATH), '요약본 경로가 링크로 들어가야 한다');
  assert.match(html, /https:\/\/www\.hospitalblog\.kr\/downloads\//);
});

/**
 * ⚠️ 크몽에서 파는 전자책 본편이 아니라 **요약본**이다. 본편을 무료로 뿌리면 판매와
 *    충돌하고, 받고 나서 다르면 그게 더 나쁘다 — 문구에서 밝힌다.
 */
test('전자책 본편이라고 말하지 않는다', () => {
  const { html } = build(summary({ actions: [{ label: 'A', action: '가', ourScope: false }] }));
  assert.doesNotMatch(html, /전자책 전문|전자책 원본|정가|49,000/);
});

/**
 * ⚠️ email-retry 가 **옛 리드**를 다시 보낼 수 있다. 그때 actions 가 없다고
 *    빈 제목만 남기거나 깨지면 안 된다.
 */
test('옛 리드(actions 없음)도 깨지지 않는다', () => {
  const { html, subject } = build(summary());
  assert.ok(subject.length > 0);
  assert.doesNotMatch(html, /고치는 방법/, '내용이 없으면 머리말도 만들지 않는다');
  assert.match(html, /진단 결과 전체 보기/);
});

test('요약 자체가 없는 옛 리드도 깨지지 않는다', () => {
  const { html, subject } = build(null);
  assert.ok(subject.length > 0);
  assert.match(html, /진단 결과 전체 보기/);
});

/** 해결방법 문구도 HTML 이스케이프를 거쳐야 한다(본문 주입 방지). */
test('해결방법 문구를 이스케이프한다', () => {
  const { html } = build(
    summary({ actions: [{ label: '<script>x</script>', action: '<img onerror=1>', ourScope: false }] }),
  );
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.doesNotMatch(html, /<img onerror=1>/);
  assert.match(html, /&lt;script&gt;/);
});
