import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alertSubject,
  judgeRegistryHealth,
  REGISTRY_CANARIES,
  shouldAlert,
  type CanaryProbe,
} from '../registry-health.ts';

function probe(over: Partial<CanaryProbe>): CanaryProbe {
  return { name: '미소치과의원', ok: true, totalCount: 1230, items: 100, failure: null, ...over };
}

test('카나리는 전국에 흔한 이름으로 2개 이상 둔다', () => {
  assert.ok(REGISTRY_CANARIES.length >= 2);
  assert.ok(REGISTRY_CANARIES.includes('미소치과의원'));
});

test('전 카나리 정상이면 ok', () => {
  const v = judgeRegistryHealth([probe({}), probe({ name: '연세이비인후과의원' })]);
  assert.equal(v.status, 'ok');
  assert.equal(v.healthy, 2);
});

test('★정상 응답인데 전건 0건이면 down — 이번 장애의 지문을 그대로 잡는다', () => {
  const v = judgeRegistryHealth([
    probe({ items: 0, totalCount: 0 }),
    probe({ name: '연세이비인후과의원', items: 0, totalCount: 0 }),
  ]);
  assert.equal(v.status, 'down');
  assert.equal(v.zero, 2);
  assert.equal(v.failed, 0);
  // "병원이 없는 것이 아니다"를 판정문에 남긴다 — 원인을 오해하면 조치가 늦어진다.
  assert.match(v.note, /0건/);
});

test('호출 자체가 실패한 경우와 0건은 다르게 설명한다', () => {
  const v = judgeRegistryHealth([
    probe({ ok: false, items: 0, totalCount: -1, failure: 'network: timeout' }),
    probe({ name: '연세이비인후과의원', ok: false, items: 0, totalCount: -1, failure: 'network: timeout' }),
  ]);
  assert.equal(v.status, 'down');
  assert.equal(v.failed, 2);
  assert.match(v.note, /호출 자체가 실패/);
});

test('일부만 정상이면 degraded', () => {
  const v = judgeRegistryHealth([probe({}), probe({ name: '연세이비인후과의원', items: 0 })]);
  assert.equal(v.status, 'degraded');
});

test('카나리를 하나도 못 돌렸으면 down', () => {
  assert.equal(judgeRegistryHealth([]).status, 'down');
});

test('알림은 상태가 바뀔 때만 — 장애 중 매시간 메일이 쌓이지 않는다', () => {
  assert.equal(shouldAlert('down', null), true);
  assert.equal(shouldAlert('down', 'ok'), true);
  assert.equal(shouldAlert('down', 'down'), false);
  assert.equal(shouldAlert('degraded', 'down'), true);
});

test('복구도 알린다 — 다만 처음부터 정상이었으면 보내지 않는다', () => {
  assert.equal(shouldAlert('ok', 'down'), true);
  assert.equal(shouldAlert('ok', 'ok'), false);
  assert.equal(shouldAlert('ok', null), false);
});

test('제목만 보고 심각도를 알 수 있다', () => {
  assert.match(alertSubject('down'), /무료진단/);
  assert.match(alertSubject('ok'), /복구/);
});
