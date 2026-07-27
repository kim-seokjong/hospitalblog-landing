import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFailureAlertText,
  createAlertGate,
  featureLabel,
  notifyEmailFailure,
  redactPersonal,
  MAX_ALERTS_PER_WINDOW,
  type AlertGate,
} from '../failure-alert.ts';
import { runSendPipeline } from '../send-pipeline.ts';
import { readTelegramConfig, sendTelegram, type TelegramSendResult } from '../../../dev/lib/telegram.ts';

/**
 * 메일 발송 실패 알림 회귀 테스트.
 *
 * ★ 왜 이 파일이 있나 (2026-07-27 실측 사고).
 *   Resend 도메인이 미검증 상태로 방치돼 **모든 메일이 실패하는 동안 아무도 몰랐다.**
 *   8월 1일 월간 리포트가 실패해도 똑같이 조용히 넘어갈 구조였다.
 *
 * ⚠️ 이 테스트는 **실제 텔레그램을 쏘지 않는다.** 전송 함수는 전부 주입한다.
 */

/** 목 전송기 — 보낸 문구를 모아 둔다. */
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

function fixedGate(): AlertGate {
  return createAlertGate({ dedupeWindowMs: 1000, windowMs: 10_000, maxPerWindow: 3 });
}

// ───────────────────────── 실패하면 알림이 시도된다 ─────────────────────────

test('발송이 실패하면 알림이 시도된다', async () => {
  const mock = mockSender();
  const outcome = await notifyEmailFailure(
    { feature: 'monthly-report', error: 'The hospitalblog.kr domain is not verified.' },
    { send: mock.send, gate: fixedGate(), now: () => 0 },
  );

  assert.equal(outcome, 'sent');
  assert.equal(mock.sent.length, 1);
  assert.match(mock.sent[0], /월간 리포트/, '어떤 기능의 메일인지가 알림에 있어야 한다');
  assert.match(mock.sent[0], /not verified/, '오류 사유가 알림에 있어야 한다');
});

test('발송이 성공하면 알림을 보내지 않는다', async () => {
  const notified: unknown[] = [];
  const result = await runSendPipeline(
    { to: 'a@b.com', subject: 's', html: 'h', feature: 'billing-charge' },
    {
      attempt: async () => ({ success: true, id: 'x' }),
      notify: async (input) => {
        notified.push(input);
      },
    },
  );

  assert.equal(result.success, true);
  assert.equal(notified.length, 0);
});

test('파이프라인 실패 시 기능명과 사유가 알림으로 넘어간다', async () => {
  const notified: Array<{ feature?: string; error: string }> = [];
  const result = await runSendPipeline(
    { to: 'a@b.com', subject: 's', html: 'h', feature: 'trial-digest' },
    {
      attempt: async () => ({ success: false, error: 'domain not verified' }),
      notify: async (input) => {
        notified.push(input);
      },
    },
  );

  assert.equal(result.success, false);
  assert.deepEqual(notified, [{ feature: 'trial-digest', error: 'domain not verified' }]);
});

// ───────────────────────── 알림 실패가 메일 흐름을 깨지 않는다 ─────────────────────────

test('알림이 예외를 던져도 발송 결과는 그대로 반환된다', async () => {
  const result = await runSendPipeline(
    { to: 'a@b.com', subject: 's', html: 'h' },
    {
      attempt: async () => ({ success: false, error: '실패 사유' }),
      notify: async () => {
        throw new Error('텔레그램 폭발');
      },
    },
  );

  assert.equal(result.success, false);
  assert.equal(result.error, '실패 사유');
});

test('발송 시도가 예외를 던져도 파이프라인은 실패 결과로 흡수하고 알린다', async () => {
  const notified: string[] = [];
  const result = await runSendPipeline(
    { to: 'a@b.com', subject: 's', html: 'h' },
    {
      attempt: async () => {
        throw new Error('네트워크 끊김');
      },
      notify: async (input) => {
        notified.push(input.error);
      },
    },
  );

  assert.equal(result.success, false);
  assert.equal(result.error, '네트워크 끊김');
  assert.deepEqual(notified, ['네트워크 끊김']);
});

test('알림 전송기가 예외를 던져도 notifyEmailFailure 는 throw 하지 않는다', async () => {
  const outcome = await notifyEmailFailure(
    { feature: 'billing-notify', error: 'x' },
    {
      send: async () => {
        throw new Error('전송기 폭발');
      },
      gate: fixedGate(),
      now: () => 0,
    },
  );
  assert.equal(outcome, 'failed');
});

// ───────────────────────── 환경변수가 없으면 건너뛴다 ─────────────────────────

test('텔레그램 환경변수가 없으면 설정을 읽지 못한다', () => {
  assert.equal(readTelegramConfig({}), null);
  assert.equal(readTelegramConfig({ TELEGRAM_BOT_TOKEN: 'a' }), null, '채팅 ID 만 없어도 skip');
  assert.equal(readTelegramConfig({ TELEGRAM_CHAT_ID: 'b' }), null, '토큰만 없어도 skip');
  assert.equal(readTelegramConfig({ TELEGRAM_BOT_TOKEN: ' ', TELEGRAM_CHAT_ID: ' ' }), null, '공백은 미설정');
  assert.deepEqual(readTelegramConfig({ TELEGRAM_BOT_TOKEN: 'a', TELEGRAM_CHAT_ID: 'b' }), {
    botToken: 'a',
    chatId: 'b',
  });
});

test('환경변수가 없으면 네트워크를 타지 않고 조용히 건너뛴다', async () => {
  // 빈 env 를 넘긴다 → fetch 자체가 호출되지 않아야 한다(실제 텔레그램 금지).
  const original = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => {
    called += 1;
    throw new Error('테스트에서 실제 전송이 일어났다');
  }) as typeof fetch;
  try {
    assert.equal(await sendTelegram('무시될 메시지', {}), 'skipped');
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('설정이 없으면 notifyEmailFailure 결과가 skipped 다', async () => {
  const outcome = await notifyEmailFailure(
    { feature: 'monthly-report', error: 'x' },
    { send: async () => 'skipped', gate: fixedGate(), now: () => 0 },
  );
  assert.equal(outcome, 'skipped');
});

// ───────────────────────── 폭주 상한 ─────────────────────────

test('같은 오류가 100건 쏟아져도 알림은 1통이다', async () => {
  const mock = mockSender();
  const gate = fixedGate();
  let now = 0;
  for (let i = 0; i < 100; i += 1) {
    now += 1; // 같은 dedupe 창(1000ms) 안
    await notifyEmailFailure(
      { feature: 'monthly-report', error: 'The hospitalblog.kr domain is not verified.' },
      { send: mock.send, gate, now: () => now },
    );
  }
  assert.equal(mock.sent.length, 1, '크론이 100명에게 보내다 전부 실패해도 1통');
});

test('묶인 건수는 다음 알림에 함께 실린다', async () => {
  const mock = mockSender();
  const gate = fixedGate();
  let now = 0;
  const fire = () =>
    notifyEmailFailure({ feature: 'monthly-report', error: '같은 오류' }, { send: mock.send, gate, now: () => now });

  await fire(); // 1통째
  now = 100;
  await fire(); // 묶임
  now = 200;
  await fire(); // 묶임
  now = 5000; // dedupe 창을 지났다
  await fire(); // 2통째

  assert.equal(mock.sent.length, 2);
  assert.match(mock.sent[1], /같은 오류 2건/, '조용히 묶인 건수를 알려야 한다');
});

test('서로 다른 오류가 쏟아져도 창당 상한에서 끊긴다', async () => {
  const mock = mockSender();
  const gate = createAlertGate({ dedupeWindowMs: 1000, windowMs: 10_000, maxPerWindow: 3 });
  for (let i = 0; i < 50; i += 1) {
    await notifyEmailFailure(
      { feature: 'monthly-report', error: `서로 다른 오류 ${i}` },
      { send: mock.send, gate, now: () => 1 },
    );
  }
  assert.equal(mock.sent.length, 3, '상한(3)을 넘겨 보내지 않는다');
});

test('기본 상한은 24시간 창에서 5통이다 — "10통 이상은 안 온다"', () => {
  assert.ok(MAX_ALERTS_PER_WINDOW <= 10);
  const gate = createAlertGate();
  let sent = 0;
  for (let i = 0; i < 500; i += 1) {
    // 모두 다른 키 + 같은 시각 = 최악의 폭주
    if (gate.decide(`key-${i}`, 1_000).send) sent += 1;
  }
  assert.equal(sent, MAX_ALERTS_PER_WINDOW);
});

test('상한 창이 지나면 다시 알린다 — 영구 침묵은 사고다', () => {
  const gate = createAlertGate({ dedupeWindowMs: 1000, windowMs: 10_000, maxPerWindow: 2 });
  assert.equal(gate.decide('a', 0).send, true);
  assert.equal(gate.decide('b', 0).send, true);
  assert.equal(gate.decide('c', 0).send, false, '상한 도달');
  assert.equal(gate.decide('c', 20_000).send, true, '창이 지나면 복구된다');
});

test('키가 무한히 늘어나지 않는다', () => {
  const gate = createAlertGate({ dedupeWindowMs: 1, windowMs: 1, maxPerWindow: 10, maxKeys: 5 });
  for (let i = 0; i < 1000; i += 1) gate.decide(`key-${i}`, i * 10);
  // 오래된 키가 버려졌으므로 초기 키는 dedupe 이력 없이 다시 보낼 수 있어야 한다
  assert.equal(gate.decide('key-0', 100_000).send, true);
});

// ───────────────────────── 개인정보 금지 ─────────────────────────

test('알림에 수신 주소·식별자가 실리지 않는다', () => {
  const raw =
    'Invalid `to` field: wonjang@clinic.co.kr (user 3f8a1c2d-1111-2222-3333-444455556666, tel 01012345678)';
  const cleaned = redactPersonal(raw);
  assert.ok(!cleaned.includes('wonjang@clinic.co.kr'), '수신 주소 금지');
  assert.ok(!cleaned.includes('3f8a1c2d-1111-2222-3333-444455556666'), '회원 식별자 금지');
  assert.ok(!cleaned.includes('01012345678'), '전화번호 금지');
  assert.match(cleaned, /주소생략/);
});

test('완성된 알림 문구에도 개인정보가 없다', async () => {
  const mock = mockSender();
  await notifyEmailFailure(
    { feature: 'clinic-diagnosis', error: 'send failed for wonjang@clinic.co.kr at 서울숲의원' },
    { send: mock.send, gate: fixedGate(), now: () => 0 },
  );
  assert.equal(mock.sent.length, 1);
  assert.ok(!mock.sent[0].includes('wonjang@clinic.co.kr'));
  assert.match(mock.sent[0], /무료 진단 결과 메일/);
});

test('오류 사유는 200자에서 잘린다', () => {
  const cleaned = redactPersonal('가'.repeat(1000));
  assert.ok(cleaned.length <= 201, `실제 ${cleaned.length}자`);
});

test('사유가 비어도 문구가 만들어진다', () => {
  const text = buildFailureAlertText({ feature: 'other', reason: '', at: new Date(0), foldedCount: 0 });
  assert.match(text, /사유 없음/);
  assert.match(text, /미지정/);
});

test('모든 기능 라벨이 한국어로 존재한다', () => {
  const features = [
    'clinic-diagnosis',
    'billing-charge',
    'billing-retry',
    'billing-cancel',
    'billing-notify',
    'monthly-report',
    'trial-report',
    'trial-digest',
    'registry-health',
    'other',
  ] as const;
  for (const f of features) {
    assert.ok(featureLabel(f).length > 0, `${f} 라벨 누락`);
  }
});
