import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeClinicLookupQuota,
  consumeEbookLeadQuota,
  DEFAULT_CLINIC_LOOKUP_IP_LIMIT,
  DEFAULT_EBOOK_LEAD_GLOBAL_LIMIT,
  DEFAULT_EBOOK_LEAD_IP_LIMIT,
  publicLimitMessage,
  readClinicLookupLimits,
  readEbookLeadLimits,
  __resetPublicEndpointLimits,
} from '../public-endpoint-limits.ts';

/**
 * 회귀 고정 — 2026-08-03 주간점검.
 *
 * `/api/ebook-lead`(공개 쓰기)와 `/api/clinic/lookup`(네이버 쿼터 프록시)만
 * 캡이 없었다. 여기서 지키는 것:
 *   · 캡이 실제로 걸린다 (IP·전체 각각)
 *   · 두 엔드포인트의 사용량이 **서로를 잠식하지 않는다**
 *   · 전체 캡에 걸린 사람에게 "네가 많이 눌렀다" 고 하지 않는다
 */

test('IP 캡을 넘으면 거부한다', () => {
  __resetPublicEndpointLimits();
  for (let i = 0; i < DEFAULT_EBOOK_LEAD_IP_LIMIT; i += 1) {
    assert.equal(consumeEbookLeadQuota('1.1.1.1').allowed, true, `${i + 1}번째는 통과해야 한다`);
  }
  const blocked = consumeEbookLeadQuota('1.1.1.1');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.allowed === false && blocked.reason, 'ip_limit');
});

test('다른 IP 는 서로의 캡에 영향받지 않는다', () => {
  __resetPublicEndpointLimits();
  for (let i = 0; i < DEFAULT_EBOOK_LEAD_IP_LIMIT; i += 1) consumeEbookLeadQuota('1.1.1.1');
  assert.equal(consumeEbookLeadQuota('2.2.2.2').allowed, true);
});

test('전체 캡을 넘으면 거부한다 — IP 를 바꿔도 소용없다', () => {
  __resetPublicEndpointLimits();
  let allowed = 0;
  for (let i = 0; i < DEFAULT_EBOOK_LEAD_GLOBAL_LIMIT + 10; i += 1) {
    if (consumeEbookLeadQuota(`10.0.${Math.floor(i / 250)}.${i % 250}`).allowed) allowed += 1;
  }
  assert.equal(allowed, DEFAULT_EBOOK_LEAD_GLOBAL_LIMIT);
  const blocked = consumeEbookLeadQuota('9.9.9.9');
  assert.equal(blocked.allowed === false && blocked.reason, 'global_limit');
});

/**
 * ⚠️ 저장소를 공유하면 한쪽 사용량이 다른 쪽 캡을 잠식한다.
 *    전자책 리드를 많이 받았다고 가입 자동완성이 막히면 안 된다.
 */
test('두 엔드포인트의 캡은 서로 독립이다', () => {
  __resetPublicEndpointLimits();
  for (let i = 0; i < DEFAULT_EBOOK_LEAD_IP_LIMIT; i += 1) consumeEbookLeadQuota('3.3.3.3');
  assert.equal(consumeEbookLeadQuota('3.3.3.3').allowed, false);
  // 같은 IP 라도 자동완성 캡은 아직 그대로다
  assert.equal(consumeClinicLookupQuota('3.3.3.3').allowed, true);
});

test('자동완성 캡이 가입 흐름을 쉽게 막지 않는다 — 오타 몇 번은 견딘다', () => {
  __resetPublicEndpointLimits();
  for (let i = 0; i < 10; i += 1) {
    assert.equal(consumeClinicLookupQuota('4.4.4.4').allowed, true);
  }
  assert.ok(DEFAULT_CLINIC_LOOKUP_IP_LIMIT >= 30, '가입 화면 캡은 넉넉해야 한다');
});

test('전체 캡 문구는 사용자를 탓하지 않는다', () => {
  assert.match(publicLimitMessage('ip_limit'), /요청이 너무 잦/);
  assert.match(publicLimitMessage('global_limit'), /요청이 몰려/);
  assert.doesNotMatch(publicLimitMessage('global_limit'), /너무 잦/);
});

test('env 로 캡을 조정할 수 있고, 잘못된 값은 기본값으로 떨어진다', () => {
  assert.equal(readEbookLeadLimits({ EBOOK_LEAD_IP_DAILY_LIMIT: '9' } as NodeJS.ProcessEnv).ipDaily, 9);
  assert.equal(
    readEbookLeadLimits({ EBOOK_LEAD_IP_DAILY_LIMIT: '0' } as NodeJS.ProcessEnv).ipDaily,
    DEFAULT_EBOOK_LEAD_IP_LIMIT,
  );
  assert.equal(
    readEbookLeadLimits({ EBOOK_LEAD_IP_DAILY_LIMIT: 'abc' } as NodeJS.ProcessEnv).ipDaily,
    DEFAULT_EBOOK_LEAD_IP_LIMIT,
  );
  assert.equal(
    readClinicLookupLimits({ CLINIC_LOOKUP_AUTOFILL_IP_DAILY_LIMIT: '100' } as NodeJS.ProcessEnv)
      .ipDaily,
    100,
  );
});

/**
 * 네이버 지역검색 일일 쿼터(25,000)를 이 엔드포인트 혼자 태우면
 * 진단의 폴백 검색까지 함께 죽는다 — 전체 캡은 그보다 충분히 낮아야 한다.
 */
test('자동완성 전체 캡은 네이버 일일 쿼터보다 충분히 낮다', () => {
  const { globalDaily } = readClinicLookupLimits({} as NodeJS.ProcessEnv);
  assert.ok(globalDaily <= 5_000, `전체 캡(${globalDaily})이 네이버 쿼터 대비 너무 높다`);
});
