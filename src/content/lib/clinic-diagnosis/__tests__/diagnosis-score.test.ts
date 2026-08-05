import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFindings, scoreByAxis, gradeOf } from '../findings.ts';
import { extractClinicNames, rankCompetitors } from '../ai-citation.ts';
import type { Finding } from '../types.ts';

const f = (id: string, axis: Finding['axis'], tone: Finding['tone']): Finding =>
  ({ id, axis, tone, label: id, state: '', why: null, action: '', ourScope: true }) as Finding;

/* ── 종합·축별 점수 ───────────────────────────────── */

test('확인하지 못한 항목은 점수에서 빠진다 (0점 처리 금지)', () => {
  // 못 본 것을 감점하면 "블로그를 못 찾았다"가 "블로그가 나쁘다"로 읽힌다
  const withUnknown = scoreFindings([f('a', 'blog', 'good'), f('b', 'place', 'unknown')]);
  const without = scoreFindings([f('a', 'blog', 'good')]);
  assert.equal(withUnknown.score, without.score);
  assert.equal(withUnknown.skipped, 1);
  assert.equal(withUnknown.counted, 1);
});

test('지금 손해(losing) 항목이 개선 항목보다 무겁다', () => {
  // site.https = losing, site.readable = improving
  const losingBad = scoreFindings([f('site.https', 'site', 'warn'), f('site.readable', 'site', 'good')]);
  const improvingBad = scoreFindings([f('site.https', 'site', 'good'), f('site.readable', 'site', 'warn')]);
  assert.ok(losingBad.score < improvingBad.score, '심각한 항목이 틀렸을 때 점수가 더 낮아야 한다');
});

test('전부 좋으면 100점, 전부 경고면 0점', () => {
  assert.equal(scoreFindings([f('site.https', 'site', 'good'), f('a', 'blog', 'good')]).score, 100);
  assert.equal(scoreFindings([f('site.https', 'site', 'warn'), f('a', 'blog', 'warn')]).score, 0);
});

test('확인된 항목이 없으면 점수를 지어내지 않는다', () => {
  const s = scoreFindings([f('a', 'blog', 'unknown')]);
  assert.equal(s.counted, 0);
  assert.equal(s.score, 0);
});

test('등급 경계 — 70 양호 / 40 보통 / 그 아래 취약', () => {
  assert.equal(gradeOf(70), 'good');
  assert.equal(gradeOf(69), 'fair');
  assert.equal(gradeOf(40), 'fair');
  assert.equal(gradeOf(39), 'weak');
});

test('축별 점수 — 측정 못 한 축은 0점이 아니라 unmeasured', () => {
  const axes = scoreByAxis([f('a', 'blog', 'good'), f('b', 'place', 'unknown')]);
  const place = axes.find((a) => a.axis === 'place');
  const blog = axes.find((a) => a.axis === 'blog');
  assert.ok(place && place.unmeasured, '플레이스는 측정 못 함이어야 한다');
  assert.ok(blog && !blog.unmeasured && blog.score === 100);
});

test('축별 점수는 그 축의 항목만 본다', () => {
  const axes = scoreByAxis([
    f('site.https', 'site', 'warn'),
    f('a', 'blog', 'good'),
    f('b', 'blog', 'good'),
  ]);
  assert.equal(axes.find((a) => a.axis === 'site')?.score, 0);
  assert.equal(axes.find((a) => a.axis === 'blog')?.score, 100);
});

/* ── 경쟁 병원 추출 ───────────────────────────────── */

test('AI 답변에서 병원 이름만 뽑는다', () => {
  const text = '메트로안과의원과 잘보는안과가 잘 알려져 있습니다. 대구연세안과도 후보입니다.';
  assert.deepEqual(extractClinicNames(text, '보라빛안과의원'), [
    '메트로안과의원',
    '잘보는안과',
    '대구연세안과',
  ]);
});

test('자기 병원과 분류어는 경쟁에서 뺀다', () => {
  const text = '보라빛안과의원은 좋습니다. 대학병원이나 종합병원도 고려하세요. 우리병원 기준입니다.';
  assert.deepEqual(extractClinicNames(text, '보라빛안과의원'), []);
});

test('이름 표기가 조금 달라도 자기 병원이면 뺀다', () => {
  const text = '보라빛안과가 유명합니다. 메트로안과의원도 있습니다.';
  assert.deepEqual(extractClinicNames(text, '보라빛안과의원'), ['메트로안과의원']);
});

test('여러 답변에 반복해 나온 순으로 정렬한다', () => {
  const ranked = rankCompetitors([
    { competitors: ['메트로안과의원', '잘보는안과'] },
    { competitors: ['메트로안과의원'] },
    { competitors: ['메트로안과의원', '잘보는안과'] },
  ]);
  assert.equal(ranked[0].name, '메트로안과의원');
  assert.equal(ranked[0].count, 3);
  assert.equal(ranked[1].count, 2);
});

test('경쟁 정보가 없는 옛 리포트도 안전하다', () => {
  assert.deepEqual(rankCompetitors([{}, { competitors: undefined }]), []);
  assert.deepEqual(extractClinicNames('', '가나의원'), []);
});

/* ── 못 잰 축의 사유 표시 ───────────────────────────── */

/** 항목 문구(state)에 내부 정보가 섞여 있는 상황을 흉내 낸다. */
const unknownWith = (axis: Finding['axis'], state: string): Finding =>
  ({
    id: `${axis}.exists`,
    axis,
    tone: 'unknown',
    label: '항목',
    state,
    why: null,
    action: '',
    ourScope: true,
  }) as unknown as Finding;

test('못 잰 축은 이유와 다음 행동을 함께 낸다', () => {
  const axes = scoreByAxis([unknownWith('blog', ''), f('a', 'site', 'good')]);
  const blog = axes.find((a) => a.axis === 'blog');
  assert.ok(blog?.unmeasured);
  assert.ok(blog?.unmeasuredReason, '사유가 있어야 한다');
  assert.ok(blog?.unmeasuredAction, '다음 행동이 있어야 한다');
});

test('항목 문구가 비어도 사유는 비지 않는다', () => {
  // state 에 기대면 옛 리포트·빈 문자열에서 이 기능이 조용히 사라진다
  for (const state of ['', '   ', '(후보 없음)']) {
    const axes = scoreByAxis([unknownWith('place', state)]);
    assert.ok(axes[0].unmeasuredReason, `state=${JSON.stringify(state)} 에서 사유가 비었다`);
  }
});

test('내부 정보가 섞인 항목 문구는 화면 사유로 새어 나가지 않는다', () => {
  // 이 점수표는 로그인 없는 공유 링크에 그대로 실린다
  const axes = scoreByAxis([
    unknownWith('site', '수집 실패: /srv/jobs/clinic-123/result.json — token=abc123'),
  ]);
  const reason = axes[0].unmeasuredReason ?? '';
  assert.ok(!reason.includes('/srv/'), '내부 경로가 노출되면 안 된다');
  assert.ok(!reason.includes('token'), '내부 값이 노출되면 안 된다');
});

test('축마다 다른 행동을 안내한다 (AI 축에 "주소를 알려주시면"은 틀린 안내)', () => {
  const ai = scoreByAxis([unknownWith('ai', '')])[0];
  const blog = scoreByAxis([unknownWith('blog', '')])[0];
  assert.ok(!ai.unmeasuredAction!.includes('주소'), 'AI는 주소를 줘도 채워지지 않는다');
  assert.ok(blog.unmeasuredAction!.includes('주소'));
});

test('문구가 손상된 옛 리포트에서도 죽지 않는다', () => {
  const broken = { id: 'x', axis: 'social', tone: 'unknown', label: 'x', ourScope: true } as unknown as Finding;
  const axes = scoreByAxis([broken]);
  assert.ok(axes[0].unmeasuredReason);
});

test('점수가 매겨진 축에는 사유를 붙이지 않는다', () => {
  const axes = scoreByAxis([f('a', 'blog', 'good')]);
  assert.equal(axes.find((x) => x.axis === 'blog')?.unmeasuredReason, null);
  assert.equal(axes.find((x) => x.axis === 'blog')?.unmeasuredAction, null);
});
