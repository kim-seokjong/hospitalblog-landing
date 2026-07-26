import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractHost,
  hostMatches,
  classifyReferrerHost,
  classifyUtmSource,
  readUtmSource,
  detectAiReferral,
} from '../detect.ts';
import {
  AI_REFERRAL_SOURCES,
  AI_REFERRAL_SOURCE_IDS,
  isAiReferralSourceId,
  aiReferralSourceLabel,
} from '../sources.ts';

// ---------------------------------------------------------------------------
// 출처 목록 자체의 건전성 — 데이터 파일 하나만 고치면 되게 유지하기 위한 계약
// ---------------------------------------------------------------------------

test('출처 목록: id 가 중복되지 않고 형식 제약(DB check)과 일치한다', () => {
  const ids = new Set<string>();
  for (const source of AI_REFERRAL_SOURCES) {
    assert.equal(ids.has(source.id), false, `중복 id: ${source.id}`);
    ids.add(source.id);
    // 마이그 048 의 check (source ~ '^[a-z0-9_]{1,32}$') 와 동일 제약
    assert.match(source.id, /^[a-z0-9_]{1,32}$/);
    assert.ok(source.label.length > 0);
    assert.ok(source.hosts.length > 0, `${source.id} 는 호스트가 최소 1개 필요`);
    assert.ok(source.note.length > 0, `${source.id} 는 판정 근거 주석이 필요`);
  }
  assert.equal(AI_REFERRAL_SOURCE_IDS.length, AI_REFERRAL_SOURCES.length);
});

test('출처 목록: 호스트에 검색엔진·소셜 도메인이 섞이지 않는다', () => {
  // 이 기능의 범위는 AI 유입뿐 — 검색·소셜이 섞이면 지표가 곧바로 오염된다.
  const forbidden = [
    'google.com', 'www.google.com', 'naver.com', 'search.naver.com',
    'bing.com', 'www.bing.com', 'daum.net', 'yahoo.com', 'duckduckgo.com',
    'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'youtube.com',
    'kakao.com', 't.co', 'linkedin.com',
  ];
  for (const source of AI_REFERRAL_SOURCES) {
    for (const host of source.hosts) {
      assert.equal(forbidden.includes(host), false, `${source.id} 에 비-AI 도메인: ${host}`);
    }
  }
});

test('isAiReferralSourceId: 화이트리스트 밖 값은 거부한다', () => {
  assert.equal(isAiReferralSourceId('chatgpt'), true);
  assert.equal(isAiReferralSourceId('perplexity'), true);
  for (const bad of ['google', 'naver', '', 'CHATGPT', 'chatgpt; drop', 123, null, undefined, {}]) {
    assert.equal(isAiReferralSourceId(bad), false, `거부해야 함: ${String(bad)}`);
  }
});

test('aiReferralSourceLabel: 모르는 id 는 그대로 돌려줘 화면이 깨지지 않는다', () => {
  assert.equal(aiReferralSourceLabel('chatgpt'), 'ChatGPT');
  assert.equal(aiReferralSourceLabel('legacy_engine'), 'legacy_engine');
});

// ---------------------------------------------------------------------------
// 호스트 파싱·매칭
// ---------------------------------------------------------------------------

test('extractHost: 절대 URL 에서 소문자 호스트만 뽑고 경로·쿼리는 버린다', () => {
  assert.equal(extractHost('https://ChatGPT.com/c/abc?x=1#y'), 'chatgpt.com');
  assert.equal(extractHost('https://www.perplexity.ai/search/foo'), 'www.perplexity.ai');
  assert.equal(extractHost('http://claude.ai'), 'claude.ai');
});

test('extractHost: 빈 값·상대경로·잘못된 URL 은 null', () => {
  for (const bad of ['', '   ', '/posts/1', 'not a url', null, undefined]) {
    assert.equal(extractHost(bad), null, `null 이어야 함: ${String(bad)}`);
  }
});

test('hostMatches: 점 경계를 지켜 접미사 우연 일치를 막는다', () => {
  assert.equal(hostMatches('perplexity.ai', 'perplexity.ai'), true);
  assert.equal(hostMatches('www.perplexity.ai', 'perplexity.ai'), true);
  assert.equal(hostMatches('notperplexity.ai', 'perplexity.ai'), false);
  assert.equal(hostMatches('perplexity.ai.evil.com', 'perplexity.ai'), false);
});

// ---------------------------------------------------------------------------
// 리퍼러 판정
// ---------------------------------------------------------------------------

test('classifyReferrerHost: 알려진 AI 호스트와 서브도메인을 판정한다', () => {
  const cases: Array<[string, string]> = [
    ['chatgpt.com', 'chatgpt'],
    ['chat.openai.com', 'chatgpt'],
    ['perplexity.ai', 'perplexity'],
    ['www.perplexity.ai', 'perplexity'],
    ['copilot.microsoft.com', 'copilot'],
    ['gemini.google.com', 'gemini'],
    ['claude.ai', 'claude'],
    ['grok.com', 'grok'],
    ['chat.deepseek.com', 'deepseek'],
    ['meta.ai', 'meta_ai'],
    ['wrtn.ai', 'wrtn'],
  ];
  for (const [host, expected] of cases) {
    assert.equal(classifyReferrerHost(host), expected, `${host} → ${expected}`);
  }
});

test('classifyReferrerHost: 검색엔진·소셜·자기 도메인은 AI 유입이 아니다', () => {
  const notAi = [
    'www.google.com', 'google.com', 'search.naver.com', 'm.search.naver.com',
    'www.bing.com', 'duckduckgo.com', 'x.com', 'twitter.com',
    'www.facebook.com', 'instagram.com', 'blog.naver.com',
    'hospitalblog.kr', 'myclinic.hospitalblog.kr', 'example.com',
  ];
  for (const host of notAi) {
    assert.equal(classifyReferrerHost(host), null, `AI 아님이어야 함: ${host}`);
  }
  assert.equal(classifyReferrerHost(null), null);
});

// ---------------------------------------------------------------------------
// utm_source 판정
// ---------------------------------------------------------------------------

test('readUtmSource: ? 유무·다중 파라미터 모두 처리한다', () => {
  assert.equal(readUtmSource('?utm_source=chatgpt.com'), 'chatgpt.com');
  assert.equal(readUtmSource('utm_source=chatgpt.com&utm_medium=ai'), 'chatgpt.com');
  assert.equal(readUtmSource('?a=1&utm_source=perplexity&b=2'), 'perplexity');
  assert.equal(readUtmSource('?a=1'), null);
  assert.equal(readUtmSource(''), null);
  assert.equal(readUtmSource(null), null);
});

test('classifyUtmSource: OpenAI 가 붙이는 chatgpt.com 을 대소문자·공백 무관하게 판정한다', () => {
  assert.equal(classifyUtmSource('chatgpt.com'), 'chatgpt');
  assert.equal(classifyUtmSource('ChatGPT.com'), 'chatgpt');
  assert.equal(classifyUtmSource(' chatgpt '), 'chatgpt');
  assert.equal(classifyUtmSource('perplexity'), 'perplexity');
});

test('classifyUtmSource: 자체 캠페인·모르는 값은 AI 유입이 아니다', () => {
  for (const bad of ['ebook', 'newsletter', 'google', 'naver', '', null, undefined]) {
    assert.equal(classifyUtmSource(bad), null, `AI 아님이어야 함: ${String(bad)}`);
  }
});

// ---------------------------------------------------------------------------
// 통합 판정
// ---------------------------------------------------------------------------

test('detectAiReferral: 리퍼러가 제거돼도 utm_source 로 ChatGPT 유입을 잡는다', () => {
  assert.equal(
    detectAiReferral({ referrer: '', search: '?utm_source=chatgpt.com' }),
    'chatgpt',
  );
  assert.equal(
    detectAiReferral({ referrer: null, search: '?utm_source=chatgpt.com' }),
    'chatgpt',
  );
});

test('detectAiReferral: utm 이 없으면 리퍼러 호스트로 판정한다', () => {
  assert.equal(
    detectAiReferral({ referrer: 'https://www.perplexity.ai/search/x', search: '' }),
    'perplexity',
  );
});

test('detectAiReferral: utm 이 리퍼러보다 우선한다', () => {
  // ChatGPT 링크를 열면 utm 이 붙고 리퍼러는 없거나 다른 값일 수 있다.
  assert.equal(
    detectAiReferral({
      referrer: 'https://www.perplexity.ai/',
      search: '?utm_source=chatgpt.com',
    }),
    'chatgpt',
  );
});

test('detectAiReferral: AI 유입이 아니면 null (검색·소셜·직접 방문·자체 캠페인)', () => {
  const notAi = [
    { referrer: 'https://www.google.com/', search: '' },
    { referrer: 'https://search.naver.com/search.naver?query=x', search: '' },
    { referrer: 'https://www.facebook.com/', search: '' },
    { referrer: '', search: '' },
    { referrer: '', search: '?utm_source=ebook&utm_medium=referral' },
    { referrer: 'https://myclinic.hospitalblog.kr/', search: '' },
  ];
  for (const signals of notAi) {
    assert.equal(detectAiReferral(signals), null, JSON.stringify(signals));
  }
});
