import test from 'node:test';
import assert from 'node:assert/strict';
import { rankDisplay, DEFAULT_SCAN_DEPTH } from '../rank-display.ts';

// ══════════════════════════════════════════════════════════════════
// 이번 수정의 핵심 계약:
//   "측정 실패" 와 "순위권 밖" 은 화면에서 절대 같아 보이면 안 된다.
//   두 달간 이 둘이 뭉개져서, 측정이 죽어 있는데도 화면은 "100위 밖"이라고 말했다.
// ══════════════════════════════════════════════════════════════════

test('★ 측정 실패와 순위권 밖은 서로 다른 문구다', () => {
  const failed = rankDisplay('failed', null, 0);
  const notFound = rankDisplay('not_found', null, 300);

  assert.notEqual(failed.text, notFound.text);
  assert.equal(failed.text, '측정 실패');
  assert.equal(notFound.text, '300위 밖');
});

test('★ 측정 실패 문구에 "위 밖" 이 들어가면 안 된다 (순위권 밖으로 오해)', () => {
  const failed = rankDisplay('failed', null, 0);
  assert.ok(!failed.text.includes('위 밖'), `실제: ${failed.text}`);
  assert.ok(failed.hint.includes('순위권 밖이라는 뜻이 아니'), '설명에서 명확히 부정해야 한다');
});

test('★ 측정 실패는 rank 값이 딸려와도 순위로 표시하지 않는다', () => {
  // 방어: 어떤 이유로 failed 인데 rank 가 남아 있어도 순위처럼 보이면 안 된다
  const failed = rankDisplay('failed', 5, 300);
  assert.equal(failed.text, '측정 실패');
});

test('★ 스캔 깊이를 실제로 본 만큼 정직하게 말한다', () => {
  assert.equal(rankDisplay('not_found', null, 300).text, '300위 밖');
  assert.equal(rankDisplay('not_found', null, 100).text, '100위 밖');
  // 깊이 정보가 없는 구 데이터는 기본값으로
  assert.equal(rankDisplay('not_found', null, null).text, `${DEFAULT_SCAN_DEPTH}위 밖`);
  assert.equal(rankDisplay('not_found', null, 0).text, `${DEFAULT_SCAN_DEPTH}위 밖`);
});

test('순위 확정은 숫자로 표시하고 강조 톤', () => {
  const ok = rankDisplay('ok', 5, 300);
  assert.equal(ok.text, '5위');
  assert.equal(ok.tone, 'rank');
});

test('모호(내 글 여럿)는 순위로도 순위권 밖으로도 표시하지 않는다', () => {
  const amb = rankDisplay('ambiguous', null, 300);
  assert.equal(amb.text, '확인 필요');
  assert.equal(amb.tone, 'warn');
  assert.ok(!amb.text.includes('위'));
});

test('★ 구 스키마(status 미기록) + rank 없음은 "순위권 밖"이라 단정하지 않는다', () => {
  // 마이그 052 미적용 환경. 측정이 됐는지조차 알 수 없으므로 단정 금지.
  const legacy = rankDisplay(null, null, null);
  assert.equal(legacy.text, '집계 전');
  assert.ok(!legacy.text.includes('위 밖'));
});

test('구 스키마라도 rank 가 있으면 순위로 표시', () => {
  assert.equal(rankDisplay(null, 12, null).text, '12위');
});

test('톤 구분 — 실패/모호는 warn, 순위권 밖은 muted (시각적으로 구분)', () => {
  assert.equal(rankDisplay('failed', null, 0).tone, 'warn');
  assert.equal(rankDisplay('ambiguous', null, 0).tone, 'warn');
  assert.equal(rankDisplay('not_found', null, 300).tone, 'muted');
  assert.notEqual(
    rankDisplay('failed', null, 0).tone,
    rankDisplay('not_found', null, 300).tone,
  );
});

test('네 자리 이상 순위·깊이는 천단위 구분', () => {
  assert.equal(rankDisplay('ok', 1050, null).text, '1,050위');
  assert.equal(rankDisplay('not_found', null, 1000).text, '1,000위 밖');
});
