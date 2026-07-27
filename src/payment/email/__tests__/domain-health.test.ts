import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDomainAlertText,
  evaluateDomains,
  runResendDomainCheck,
} from '../domain-health.ts';
import type { TelegramSendResult } from '../../../dev/lib/telegram.ts';

/**
 * Resend 발송 도메인 주간 점검 회귀 테스트.
 *
 * ★ 왜 이 파일이 있나 (2026-07-27 실측 사고).
 *   hospitalblog.kr 이 Resend 에서 미검증(failed)으로 방치돼 모든 메일이 실패했다.
 *   발송 실패 알림은 "메일을 한 통이라도 보내야" 울린다. 이 점검은 **메일이 한 통도
 *   없는 주에도** 울린다 — 그게 이 코드가 존재하는 유일한 이유다.
 *
 * ⚠️ 실제 Resend·텔레그램을 호출하지 않는다. 둘 다 주입한다.
 */

const ENV = { RESEND_API_KEY: 'test-key' } as const;

function mockSender(result: TelegramSendResult = 'sent') {
  const sent: string[] = [];
  return {
    sent,
    send: async (text: string): Promise<TelegramSendResult> => {
      sent.push(text);
      return result;
    },
  };
}

test('전부 verified 면 정상으로 본다', () => {
  const verdict = evaluateDomains({ data: [{ name: 'hospitalblog.kr', status: 'verified' }] });
  assert.equal(verdict.healthy, true);
  assert.equal(verdict.checked, 1);
});

test('미검증 도메인이 하나라도 있으면 경고다', () => {
  const verdict = evaluateDomains({
    data: [
      { name: 'hospitalblog.kr', status: 'failed' },
      { name: 'other.kr', status: 'verified' },
    ],
  });
  assert.equal(verdict.healthy, false);
  assert.deepEqual(verdict.problems, [{ name: 'hospitalblog.kr', status: 'failed' }]);
});

test('pending·not_started 도 경고다 — verified 가 아니면 전부 발송 불가로 본다', () => {
  for (const status of ['pending', 'not_started', 'temporary_failure']) {
    const verdict = evaluateDomains({ data: [{ name: 'hospitalblog.kr', status }] });
    assert.equal(verdict.healthy, false, `${status} 를 정상으로 보면 안 된다`);
  }
});

test('등록된 도메인이 0개면 경고다', () => {
  assert.equal(evaluateDomains({ data: [] }).healthy, false);
});

test('알 수 없는 응답 형식이면 경고다 — 조용히 넘어가지 않는다', () => {
  assert.equal(evaluateDomains(null).healthy, false);
  assert.equal(evaluateDomains({ error: 'unauthorized' }).healthy, false);
  assert.equal(evaluateDomains('nonsense').healthy, false);
});

test('맨 배열 응답도 해석한다', () => {
  assert.equal(evaluateDomains([{ name: 'hospitalblog.kr', status: 'verified' }]).healthy, true);
});

test('RESEND_API_KEY 가 없으면 건너뛴다', async () => {
  let fetched = 0;
  const outcome = await runResendDomainCheck({
    env: {},
    fetchDomains: async () => {
      fetched += 1;
      return { data: [] };
    },
    send: async () => 'sent',
  });
  assert.deepEqual(outcome, { ran: false, skipped: 'no-api-key' });
  assert.equal(fetched, 0);
});

test('정상이면 텔레그램을 보내지 않는다 — 조용한 쪽이 낫다', async () => {
  const mock = mockSender();
  const outcome = await runResendDomainCheck({
    env: ENV,
    fetchDomains: async () => ({ data: [{ name: 'hospitalblog.kr', status: 'verified' }] }),
    send: mock.send,
  });
  assert.equal(outcome.ran, true);
  assert.equal(mock.sent.length, 0);
});

test('미검증이면 텔레그램으로 알린다', async () => {
  const mock = mockSender();
  const outcome = await runResendDomainCheck({
    env: ENV,
    fetchDomains: async () => ({ data: [{ name: 'hospitalblog.kr', status: 'failed' }] }),
    send: mock.send,
    now: () => 0,
  });
  assert.equal(outcome.ran && outcome.alerted, true);
  assert.equal(mock.sent.length, 1);
  assert.match(mock.sent[0], /hospitalblog\.kr/);
  assert.match(mock.sent[0], /failed/);
});

test('Resend 호출이 실패해도 throw 하지 않고 알린다', async () => {
  const mock = mockSender();
  const outcome = await runResendDomainCheck({
    env: ENV,
    fetchDomains: async () => {
      throw new Error('HTTP 401');
    },
    send: mock.send,
  });
  assert.equal(outcome.ran, true);
  assert.equal(mock.sent.length, 1);
  assert.match(mock.sent[0], /401/);
});

test('알림 전송이 예외를 던져도 점검은 throw 하지 않는다 — 크론 본업을 막으면 안 된다', async () => {
  const outcome = await runResendDomainCheck({
    env: ENV,
    fetchDomains: async () => ({ data: [{ name: 'hospitalblog.kr', status: 'failed' }] }),
    send: async () => {
      throw new Error('텔레그램 폭발');
    },
  });
  assert.equal(outcome.ran, true);
  assert.equal(outcome.ran && outcome.alerted, false);
});

test('알림 문구에 개인정보가 없다 — 도메인과 상태만', () => {
  const text = buildDomainAlertText(
    { healthy: false, checked: 1, problems: [{ name: 'hospitalblog.kr', status: 'failed' }], note: '미검증 도메인 1개' },
    new Date(0),
  );
  assert.ok(!text.includes('@'), '메일 주소가 들어가면 안 된다');
  assert.match(text, /resend\.com\/domains/, '무엇을 해야 하는지가 있어야 한다');
});
