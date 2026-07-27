import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EMAIL_ADDRESS_DAILY_LIMIT,
  DEFAULT_EMAIL_GLOBAL_DAILY_LIMIT,
  DEFAULT_EMAIL_IP_DAILY_LIMIT,
  DEFAULT_EMAIL_TOKEN_ADDRESS_LIMIT,
  DEFAULT_EMAIL_TOKEN_DAILY_LIMIT,
  buildDiagnosisEmail,
  buildEmailFactLines,
  emailLimitMessage,
  escapeHtml,
  evaluateEmailLeadQuota,
  extractLeadClinicFields,
  formatKstDate,
  hashClientIp,
  kstDayStartIso,
  normalizeDiagnosedAt,
  normalizeLeadEmail,
  readEmailLeadLimits,
  safeText,
  sanitizeSubjectText,
  type EmailLeadCounts,
  type EmailLeadLimitReason,
} from '../email-lead.ts';
import type { DiagnosisLeadSummary } from '../conversion.ts';

const SUMMARY: DiagnosisLeadSummary = {
  badCount: 3,
  improveCount: 2,
  goodCount: 4,
  unknownCount: 1,
  ourScopeCount: 2,
  topIssues: ['최근 발행', '의료광고법 표현'],
  daysSinceLatestPost: 208,
  postsPerWeek: 0.2,
  prohibitedCount: 11,
  cautionCount: 3,
  keywordsChecked: 5,
  keywordsTop10: 0,
  aiRecommendTotal: 3,
  aiRecommendMentioned: 0,
  blogId: 'myclinic',
  siteUrl: 'https://example.com',
};

/* ── 이메일 검증 ─────────────────────────────────────────── */

test('normalizeLeadEmail: 정상 주소는 소문자로 정규화한다', () => {
  assert.equal(normalizeLeadEmail('  Dr.Kim@Example.CO.KR '), 'dr.kim@example.co.kr');
  assert.equal(normalizeLeadEmail('a+tag@sub.domain.com'), 'a+tag@sub.domain.com');
});

test('normalizeLeadEmail: 명백히 잘못된 값은 거부한다', () => {
  const bad = [
    '',
    '   ',
    'no-at-sign',
    'a@b',
    'a@@b.com',
    'a b@c.com',
    'a..b@c.com',
    '@c.com',
    'a@.com',
    'a@c.',
    null,
    undefined,
    123,
    { email: 'a@b.com' },
  ];
  for (const value of bad) {
    assert.equal(normalizeLeadEmail(value), null, `${String(value)} 는 거부돼야 한다`);
  }
});

test('normalizeLeadEmail: 길이 상한을 넘으면 거부한다', () => {
  assert.equal(normalizeLeadEmail(`${'a'.repeat(250)}@example.com`), null);
  assert.equal(normalizeLeadEmail(`${'a'.repeat(65)}@example.com`), null);
});

/* ── 남용 방어 캡 (DB 집계 기반 판정) ────────────────────── */

const LIMITS = {
  ipDaily: 2,
  addressDaily: 1,
  globalDaily: 3,
  tokenDaily: 2,
  tokenAddresses: 2,
};

const ZERO: EmailLeadCounts = {
  globalToday: 0,
  ipToday: 0,
  addressToday: 0,
  tokenToday: 0,
  tokenOtherAddresses: 0,
};

test('evaluateEmailLeadQuota: 아무것도 안 쓴 상태면 통과한다', () => {
  assert.deepEqual(evaluateEmailLeadQuota(ZERO, LIMITS), { allowed: true });
});

test('evaluateEmailLeadQuota: 같은 수신 주소로 반복 발송을 막는다', () => {
  assert.deepEqual(evaluateEmailLeadQuota({ ...ZERO, addressToday: 1 }, LIMITS), {
    allowed: false,
    reason: 'address_limit',
  });
});

test('evaluateEmailLeadQuota: IP·전체·토큰 캡을 각각 막는다', () => {
  assert.deepEqual(evaluateEmailLeadQuota({ ...ZERO, ipToday: 2 }, LIMITS), {
    allowed: false,
    reason: 'ip_limit',
  });
  assert.deepEqual(evaluateEmailLeadQuota({ ...ZERO, globalToday: 3 }, LIMITS), {
    allowed: false,
    reason: 'global_limit',
  });
  assert.deepEqual(evaluateEmailLeadQuota({ ...ZERO, tokenToday: 2 }, LIMITS), {
    allowed: false,
    reason: 'token_limit',
  });
});

test('evaluateEmailLeadQuota: 토큰 하나로 뿌릴 수 있는 주소 수를 막는다(릴레이 방어)', () => {
  // 이미 다른 주소 2개로 나갔으면, 3번째 주소는 거부된다.
  assert.deepEqual(evaluateEmailLeadQuota({ ...ZERO, tokenOtherAddresses: 2 }, LIMITS), {
    allowed: false,
    reason: 'token_address_limit',
  });
  // 같은 주소로 다시 받는 것은 이 캡에 걸리지 않는다(주소 수가 늘지 않으므로).
  assert.deepEqual(evaluateEmailLeadQuota({ ...ZERO, tokenOtherAddresses: 1 }, LIMITS), {
    allowed: true,
  });
});

test('kstDayStartIso: KST 하루 경계를 UTC ISO 로 돌려준다', () => {
  // 2026-07-27 05:00 KST → 그날 KST 00:00 = 2026-07-26T15:00:00Z
  assert.equal(kstDayStartIso(Date.parse('2026-07-27T05:00:00+09:00')), '2026-07-26T15:00:00.000Z');
  // 자정 직후도 같은 날 경계.
  assert.equal(kstDayStartIso(Date.parse('2026-07-27T00:01:00+09:00')), '2026-07-26T15:00:00.000Z');
  // 하루가 바뀌면 경계도 바뀐다.
  assert.equal(kstDayStartIso(Date.parse('2026-07-28T05:00:00+09:00')), '2026-07-27T15:00:00.000Z');
});

test('hashClientIp: 원본 IP 를 남기지 않고 같은 IP 는 같은 값이 된다', () => {
  const a = hashClientIp('203.0.113.9', 'salt');
  const b = hashClientIp('203.0.113.9', 'salt');
  const c = hashClientIp('203.0.113.10', 'salt');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(!a.includes('203.0.113'));
  assert.match(a, /^[a-f0-9]{32}$/);
  // 솔트가 다르면 값도 다르다.
  assert.notEqual(a, hashClientIp('203.0.113.9', 'other'));
  // IP 를 못 읽었을 때도 throw 하지 않는다.
  assert.equal(hashClientIp('', 'salt'), 'unknown');
});

test('readEmailLeadLimits: 비정상 env 는 기본값으로 떨어진다', () => {
  assert.deepEqual(readEmailLeadLimits({} as NodeJS.ProcessEnv), {
    ipDaily: DEFAULT_EMAIL_IP_DAILY_LIMIT,
    addressDaily: DEFAULT_EMAIL_ADDRESS_DAILY_LIMIT,
    globalDaily: DEFAULT_EMAIL_GLOBAL_DAILY_LIMIT,
    tokenDaily: DEFAULT_EMAIL_TOKEN_DAILY_LIMIT,
    tokenAddresses: DEFAULT_EMAIL_TOKEN_ADDRESS_LIMIT,
  });
  assert.deepEqual(
    readEmailLeadLimits({
      DIAGNOSIS_EMAIL_IP_DAILY_LIMIT: 'abc',
      DIAGNOSIS_EMAIL_ADDRESS_DAILY_LIMIT: '-3',
      DIAGNOSIS_EMAIL_GLOBAL_DAILY_LIMIT: '50',
      DIAGNOSIS_EMAIL_TOKEN_DAILY_LIMIT: '0',
      DIAGNOSIS_EMAIL_TOKEN_ADDRESS_LIMIT: '1',
    } as NodeJS.ProcessEnv),
    {
      ipDaily: DEFAULT_EMAIL_IP_DAILY_LIMIT,
      addressDaily: DEFAULT_EMAIL_ADDRESS_DAILY_LIMIT,
      globalDaily: 50,
      tokenDaily: DEFAULT_EMAIL_TOKEN_DAILY_LIMIT,
      tokenAddresses: 1,
    },
  );
});

test('emailLimitMessage: 사유가 달라도 문구가 같다(주소 존재 오라클 차단)', () => {
  const reasons: readonly EmailLeadLimitReason[] = [
    'ip_limit',
    'address_limit',
    'global_limit',
    'token_limit',
    'token_address_limit',
  ];
  const messages = new Set(reasons.map((r) => emailLimitMessage(r)));
  assert.equal(messages.size, 1, '사유별로 다른 문구를 주면 주소 확인 오라클이 된다');
  const msg = emailLimitMessage('address_limit');
  assert.ok(msg.length > 0);
  // 캡 숫자를 문구에 박지 않는다.
  assert.doesNotMatch(msg, /\d+회/);
  // "이 주소로는 이미 보내드렸어요" 류의 주소 확인 단서를 남기지 않는다.
  assert.ok(!msg.includes('이미 보내'));
});

/* ── 저장된 리포트에서 값 꺼내기 (결측 방어) ─────────────── */

test('safeText: 문자열이 아니면 빈 문자열, 길면 자른다', () => {
  assert.equal(safeText(undefined, 10), '');
  assert.equal(safeText(null, 10), '');
  assert.equal(safeText(123, 10), '');
  assert.equal(safeText('  가나다  ', 10), '가나다');
  assert.equal(safeText('abcdefghijk', 5), 'abcde');
});

test('extractLeadClinicFields: 필드가 없는 옛 리포트에서도 throw 하지 않는다', () => {
  assert.deepEqual(extractLeadClinicFields(undefined), {
    mngNo: '',
    name: '',
    region: '',
    specialty: '',
    phone: '',
  });
  assert.deepEqual(extractLeadClinicFields({ name: '테스트의원' }), {
    mngNo: '',
    name: '테스트의원',
    region: '',
    specialty: '',
    phone: '',
  });
  assert.deepEqual(
    extractLeadClinicFields({
      mngNo: 'M1',
      name: '테스트의원',
      province: '대구광역시',
      region: '수성구',
      specialty: '피부과',
      phone: '053-000-0000',
    }),
    {
      mngNo: 'M1',
      name: '테스트의원',
      region: '대구광역시 수성구',
      specialty: '피부과',
      phone: '053-000-0000',
    },
  );
});

test('normalizeDiagnosedAt: 깨진 값은 null 로 떨어진다', () => {
  assert.equal(normalizeDiagnosedAt('2026-07-27T00:00:00.000Z'), '2026-07-27T00:00:00.000Z');
  assert.equal(normalizeDiagnosedAt('not-a-date'), null);
  assert.equal(normalizeDiagnosedAt(undefined), null);
  assert.equal(normalizeDiagnosedAt(1700000000000), null);
});

/* ── 메일 본문 ───────────────────────────────────────────── */

test('escapeHtml: HTML 특수문자를 이스케이프한다', () => {
  assert.equal(escapeHtml('<script>"x"&\'y\''), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');
});

test('buildEmailFactLines: 확인하지 못한 값은 줄 자체를 만들지 않는다', () => {
  const lines = buildEmailFactLines({
    ...SUMMARY,
    daysSinceLatestPost: null,
    prohibitedCount: null,
    cautionCount: null,
    keywordsChecked: null,
    aiRecommendTotal: null,
  });
  assert.deepEqual(lines, []);
});

test('buildEmailFactLines: 확인한 값만 사실 그대로 적는다', () => {
  const lines = buildEmailFactLines(SUMMARY);
  assert.ok(lines.some((l) => l.includes('208일 전')));
  assert.ok(lines.some((l) => l.includes('11건')));
  assert.ok(lines.some((l) => l.includes('상위권 0개')));
});

test('buildDiagnosisEmail: 제목에 병원명과 고쳐야 할 건수가 들어간다', () => {
  const { subject } = buildDiagnosisEmail({
    clinicName: '테스트의원',
    summary: SUMMARY,
    reportUrl: 'https://www.hospitalblog.kr/clinic-check/r/abc',
    runAt: '2026-07-27T00:00:00.000Z',
  });
  assert.ok(subject.includes('테스트의원'));
  assert.ok(subject.includes('3건'));
});

test('buildDiagnosisEmail: 병원명·주소를 이스케이프해 본문에 싣는다', () => {
  const { html } = buildDiagnosisEmail({
    clinicName: '<img src=x onerror=alert(1)>의원',
    summary: SUMMARY,
    reportUrl: 'https://www.hospitalblog.kr/clinic-check/r/abc?a=1&b=2',
    runAt: '2026-07-27T00:00:00.000Z',
  });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
  assert.ok(html.includes('a=1&amp;b=2'));
  assert.ok(html.includes('/clinic-check/r/abc'));
});

test('buildDiagnosisEmail: 의료광고법 면책 문구와 발송 근거 고지를 유지한다', () => {
  const { html } = buildDiagnosisEmail({
    clinicName: '테스트의원',
    summary: SUMMARY,
    reportUrl: 'https://www.hospitalblog.kr/clinic-check/r/abc',
    runAt: '2026-07-27T00:00:00.000Z',
  });
  // "위반입니다" 로 단정하지 않는다.
  assert.ok(html.includes('위반 여부를 판단한 것은 아닙니다'));
  assert.ok(!html.includes('위반입니다'));
  // 직접 요청해서 나간 메일이라는 근거 + 광고성 아님.
  assert.ok(html.includes('직접 요청'));
  assert.ok(html.includes('광고성 정보는 보내지 않습니다'));
});

test('buildDiagnosisEmail: 진단 시각이 깨져도 예외 없이 만들어진다', () => {
  const { html } = buildDiagnosisEmail({
    clinicName: '테스트의원',
    summary: SUMMARY,
    reportUrl: 'https://www.hospitalblog.kr/clinic-check/r/abc',
    runAt: 'not-a-date',
  });
  assert.ok(html.includes('테스트의원'));
});

test('sanitizeSubjectText: 제목에 줄바꿈·제어문자가 들어가지 않는다(헤더 주입 차단)', () => {
  const dirty = '테스트의원\r\nBcc: victim@example.com';
  const clean = sanitizeSubjectText(dirty);
  assert.ok(!clean.includes('\r'));
  assert.ok(!clean.includes('\n'));
  assert.equal(clean, '테스트의원 Bcc: victim@example.com');
  assert.equal(sanitizeSubjectText(undefined), '');
  // 길이 상한을 넘으면 자른다.
  assert.ok(sanitizeSubjectText('가'.repeat(200)).length <= 60);
});

test('buildDiagnosisEmail: 제목에도 제어문자가 실리지 않는다', () => {
  const { subject } = buildDiagnosisEmail({
    clinicName: '테스트의원\nSubject: 스팸',
    summary: SUMMARY,
    reportUrl: 'https://www.hospitalblog.kr/clinic-check/r/abc',
    runAt: '2026-07-27T00:00:00.000Z',
  });
  assert.ok(!subject.includes('\n'));
  assert.ok(!subject.includes('\r'));
});

test('formatKstDate: KST 09시 이전 진단도 그날 날짜로 찍힌다', () => {
  // UTC 로 찍으면 2026-07-26 이 되는 시각(=KST 27일 오전 8시).
  assert.equal(formatKstDate('2026-07-26T23:00:00.000Z'), '2026-07-27');
  assert.equal(formatKstDate('not-a-date'), '');
  assert.equal(formatKstDate(undefined), '');
});

test('buildDiagnosisEmail: 진단 날짜를 KST 로 적는다', () => {
  const { html } = buildDiagnosisEmail({
    clinicName: '테스트의원',
    summary: SUMMARY,
    reportUrl: 'https://www.hospitalblog.kr/clinic-check/r/abc',
    runAt: '2026-07-26T23:30:00.000Z', // KST 2026-07-27 08:30
  });
  assert.ok(html.includes('2026-07-27'));
  assert.ok(!html.includes('2026-07-26'));
});

test('buildDiagnosisEmail: 요약을 못 만든 옛 리포트면 링크만 담아 보낸다', () => {
  const { subject, html } = buildDiagnosisEmail({
    clinicName: '테스트의원',
    summary: null,
    reportUrl: 'https://www.hospitalblog.kr/clinic-check/r/abc',
    runAt: '2026-07-27T00:00:00.000Z',
  });
  assert.ok(subject.includes('테스트의원'));
  assert.ok(!subject.includes('건'));
  assert.ok(html.includes('/clinic-check/r/abc'));
  assert.ok(!html.includes('닥터포스트가 대신할 수 있는'));
});

test('buildDiagnosisEmail: 병원명을 못 읽어도 어색한 빈자리 없이 만들어진다', () => {
  const { subject, html } = buildDiagnosisEmail({
    clinicName: '',
    summary: SUMMARY,
    reportUrl: 'https://www.hospitalblog.kr/clinic-check/r/abc',
    runAt: '2026-07-27T00:00:00.000Z',
  });
  assert.ok(subject.startsWith('[닥터포스트] 온라인 노출 진단'));
  assert.ok(html.includes('>온라인 노출 진단 결과<'));
});
