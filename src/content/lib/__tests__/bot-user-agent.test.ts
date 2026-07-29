import test from 'node:test';
import assert from 'node:assert/strict';
import { isBotUserAgent, BOT_UA_MARKERS, MIN_HUMAN_UA_LENGTH } from '../bot-user-agent.ts';

// ── ★ 최우선: 실제 사람의 브라우저를 봇으로 오판하지 않는가 ──
// 오판 비용이 비대칭이다. 봇을 놓치면 지표가 조금 부풀 뿐이지만, 사람을 막으면
// 그 방문은 영영 기록되지 않아 지표가 0 이 된다.
const HUMAN_USER_AGENTS: readonly [string, string][] = [
  [
    'Chrome (Windows)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  ],
  [
    'Chrome (macOS)',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  ],
  [
    'Safari (macOS)',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  ],
  [
    'Safari (iPhone)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ],
  [
    'Chrome (Android)',
    'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
  ],
  [
    'Samsung Internet',
    'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  ],
  [
    'Edge (Windows)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  ],
  [
    'Whale (국내 브라우저)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Whale/3.26.244.21 Safari/537.36',
  ],
  [
    'Firefox (Windows)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  ],
  [
    // in-app 브라우저는 **사람**이다. 'kakaotalk-scrap'(스크래퍼)와 구분돼야 한다.
    '카카오톡 in-app 브라우저',
    'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.4.5',
  ],
  [
    '네이버 앱 in-app 브라우저',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.9.5)',
  ],
  [
    '인스타그램 in-app 브라우저',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.0.32.98',
  ],
];

test('isBotUserAgent: 실제 사람 브라우저는 전부 false (오판 시 지표가 0 이 된다)', () => {
  for (const [label, ua] of HUMAN_USER_AGENTS) {
    assert.equal(isBotUserAgent(ua), false, `사람 UA 를 봇으로 오판: ${label}`);
  }
});

// ★ 사람 UA 인데 봇 마커를 부분 문자열로 품고 있는 함정들 (2026-07-29 Codex 교차검증 산출).
//   단순 includes 만 했다면 이 사용자들의 이벤트가 통째로 사라졌다.
const HUMAN_UA_WITH_MARKER_SUBSTRING: readonly [string, string, string][] = [
  [
    'CUBOT 단말 (제조사명에 bot 포함)',
    'Mozilla/5.0 (Linux; Android 9; CUBOT X19 Build/PPR1.180610.011) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.210 Mobile Safari/537.36',
    'bot',
  ],
  [
    'Outlook iOS in-app 브라우저 (사람의 메일 링크 클릭)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Outlook-iOS/709.2144270.prod.iphone',
    'outlook',
  ],
  [
    'Outlook Android in-app 브라우저',
    'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Outlook-Android/2.1.0',
    'outlook',
  ],
];

test('isBotUserAgent: 마커를 부분 문자열로 품은 사람 UA 는 예외 처리로 통과', () => {
  for (const [label, ua, marker] of HUMAN_UA_WITH_MARKER_SUBSTRING) {
    // 전제 확인 — 이 UA 들은 실제로 마커를 문자열로 포함한다(그래서 위험하다).
    assert.ok(ua.toLowerCase().includes(marker), `전제 실패: ${label} 에 '${marker}' 가 없다`);
    assert.equal(isBotUserAgent(ua), false, `사람 UA 를 봇으로 오판: ${label}`);
  }
});

// 반대편 — 데스크톱 Outlook 이 스스로 긁는 요청은 사람의 방문이 아니므로 계속 잡혀야 한다.
test('isBotUserAgent: Outlook 예외가 데스크톱 클라이언트 스캔까지 풀어주지 않는다', () => {
  assert.equal(isBotUserAgent('Microsoft Outlook 16.0.17231; Windows NT 10.0'), true);
});

// ★ 이 저장소에서 가장 위험한 오판 후보 — "safari" ⊂ 모든 크롬/사파리 UA,
//   "safelinks" = Microsoft 메일 링크스캐너. 마커가 짧은 쪽으로 새면 전 방문자가 막힌다.
test('isBotUserAgent: safari 와 safelinks 를 혼동하지 않는다', () => {
  const chrome =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  assert.equal(isBotUserAgent(chrome), false);
  assert.ok(chrome.toLowerCase().includes('safari'), '전제 확인: 크롬 UA 에 safari 가 있다');
  assert.equal(BOT_UA_MARKERS.includes('safari'), false, "'safari' 는 마커가 되면 안 된다");

  // 실제 스캐너는 잡혀야 한다.
  assert.equal(
    isBotUserAgent('Mozilla/5.0 (compatible; Microsoft-SafeLinks/1.0; +https://aka.ms/safelinks)'),
    true,
  );
});

// 같은 원리: 'kakaotalk-scrap' 은 봇, 'KAKAOTALK' in-app 은 사람.
test('isBotUserAgent: kakaotalk 스크래퍼만 잡고 in-app 브라우저는 통과', () => {
  assert.equal(isBotUserAgent('kakaotalk-scrap/1.0'), true);
  assert.equal(BOT_UA_MARKERS.includes('kakaotalk'), false);
});

// ── 실제 봇 UA (대표 사례) ──
const BOT_USER_AGENTS: readonly [string, string][] = [
  ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  // 국내 크롤러는 이름에 'bot' 이 없다 — 전용 마커가 없으면 그대로 방문자로 샌다.
  ['네이버 Yeti', 'Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)'],
  ['다음 Daumoa', 'Mozilla/5.0 (compatible; Daumoa/4.0; +http://cs.daum.net/faq/15/4118.html)'],
  ['GoogleOther', 'Mozilla/5.0 (compatible; GoogleOther) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'],
  ['Google-InspectionTool', 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)'],
  ['BingPreview', 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 BingPreview/1.0b'],
  ['Bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
  ['Yahoo Slurp', 'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)'],
  ['GPTBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot'],
  ['AhrefsBot(crawler)', 'Mozilla/5.0 (compatible; SomeCrawler/3.0; +http://example.com/crawler)'],
  ['Spider', 'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)'],
  ['HeadlessChrome', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36'],
  ['PhantomJS', 'Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1'],
  ['Puppeteer', 'Mozilla/5.0 Puppeteer/22.0.0 HeadlessChrome/120.0.0.0'],
  ['Playwright', 'Mozilla/5.0 Playwright/1.44 (X11; Linux x86_64)'],
  ['Selenium', 'Mozilla/5.0 selenium/4.20.0 (java windows)'],
  ['Lighthouse', 'Mozilla/5.0 (X11; Linux x86_64) Chrome-Lighthouse/11.0.0'],
  ['curl', 'curl/8.4.0'],
  ['wget', 'Wget/1.21.4 (linux-gnu)'],
  ['python-requests', 'python-requests/2.32.3'],
  ['Go http client', 'Go-http-client/2.0'],
  ['Java', 'Java/17.0.11'],
  ['OkHttp', 'okhttp/4.12.0'],
  ['axios', 'axios/1.7.2'],
  ['node-fetch', 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)'],
  // 링크 미리보기
  ['Facebook 미리보기', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
  ['Twitterbot', 'Twitterbot/1.0'],
  ['Slackbot', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
  ['Discordbot', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
  ['TelegramBot', 'TelegramBot (like TwitterBot)'],
  ['WhatsApp', 'WhatsApp/2.23.20.0 A'],
  ['LinkedIn', 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)'],
  ['Embedly', 'Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)'],
  ['Quora', 'Mozilla/5.0 (compatible; Quora Link Preview/1.0; +http://www.quora.com)'],
  // ★ 메일 보안 링크스캐너 — 콜드메일 성과를 오염시키는 주범
  ['Proofpoint', 'Mozilla/5.0 (compatible; proofpoint-urldefense/1.0)'],
  ['URL Defense', 'Mozilla/5.0 (Windows NT 10.0) urldefense-scanner/2.0 checker'],
  ['Barracuda', 'Mozilla/5.0 (compatible; Barracuda Sentinel LinkProtect/1.0)'],
  ['Mimecast', 'Mozilla/5.0 (compatible; Mimecast Attachment Protect/2.0)'],
  ['Symantec', 'Mozilla/5.0 (compatible; Symantec Email Security.cloud Link Following)'],
  ['Forcepoint', 'Mozilla/5.0 (compatible; Forcepoint Email Security URL Analysis)'],
  ['TrendMicro', 'Mozilla/5.0 (compatible; TrendMicro Email Security Link Scan)'],
  ['SafeLinks', 'Mozilla/5.0 (compatible; Microsoft-SafeLinks/1.0; +https://aka.ms/safelinks)'],
  ['Microsoft Office', 'Mozilla/5.0 (Windows NT 10.0; Microsoft Outlook 16.0.17328; ms-office; MSOffcreator)'],
  ['Outlook', 'Microsoft Outlook 16.0.17231; Windows NT 10.0'],
  ['Cloudmark', 'Mozilla/5.0 (compatible; Cloudmark Authority Link Checker)'],
  ['MessageLabs', 'Mozilla/5.0 (compatible; MessageLabs Click-Time Link Protection)'],
  ['Bitdefender', 'Mozilla/5.0 (compatible; Bitdefender Link Scanner/1.0)'],
  // 모니터링
  ['UptimeRobot', 'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)'],
  ['Pingdom', 'Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)'],
  ['StatusCake', 'Mozilla/5.0 (compatible; StatusCake Uptime Monitor)'],
  ['Datadog', 'Mozilla/5.0 (compatible; Datadog Synthetics Monitoring)'],
  ['New Relic', 'Mozilla/5.0 (compatible; NewRelic Synthetics Monitor)'],
  ['BetterUptime', 'Mozilla/5.0 (compatible; BetterUptime Monitor/1.0)'],
];

test('isBotUserAgent: 실제 봇·스캐너 UA 는 전부 true', () => {
  for (const [label, ua] of BOT_USER_AGENTS) {
    assert.equal(isBotUserAgent(ua), true, `봇을 놓침: ${label}`);
  }
});

// ── 빈 UA / 짧은 UA ──
test('isBotUserAgent: 빈 UA·null·undefined 는 봇', () => {
  assert.equal(isBotUserAgent(null), true);
  assert.equal(isBotUserAgent(undefined), true);
  assert.equal(isBotUserAgent(''), true);
  assert.equal(isBotUserAgent('   '), true);
});

test(`isBotUserAgent: ${MIN_HUMAN_UA_LENGTH}자 미만 UA 는 봇 (정상 브라우저는 항상 길다)`, () => {
  assert.equal(isBotUserAgent('-'), true);
  assert.equal(isBotUserAgent('none'), true);
  assert.equal(isBotUserAgent('a'.repeat(MIN_HUMAN_UA_LENGTH - 1)), true);
  // 경계: 길이만 넘고 마커가 없으면 통과시킨다(사람 쪽으로 기운 판정).
  assert.equal(isBotUserAgent('x'.repeat(MIN_HUMAN_UA_LENGTH)), false);
  // 공백은 트림 후 길이로 잰다.
  assert.equal(isBotUserAgent(`  ${'x'.repeat(MIN_HUMAN_UA_LENGTH - 1)}  `), true);
});

// ── 판정 방식 불변식 ──
test('isBotUserAgent: 대소문자 무관 (소문자 정규화 후 매칭)', () => {
  assert.equal(isBotUserAgent('CURL/8.4.0 SOMETHING'), true);
  assert.equal(isBotUserAgent('Mozilla/5.0 (compatible; PROOFPOINT URL Defense)'), true);
});

test('BOT_UA_MARKERS: 전부 소문자·공백 없는 형태로 정규화돼 있다', () => {
  for (const marker of BOT_UA_MARKERS) {
    assert.equal(marker, marker.toLowerCase(), `마커가 소문자가 아니다: ${marker}`);
    assert.equal(marker.trim(), marker, `마커 앞뒤에 공백이 있다: ${marker}`);
    assert.ok(marker.length >= 3, `마커가 너무 짧아 오탐 위험: ${marker}`);
  }
  // 정상 브라우저 UA 에 흔한 조각은 마커가 되면 안 된다 (회귀 방지).
  for (const forbidden of ['safari', 'mozilla', 'chrome', 'gecko', 'mobile', 'applewebkit', 'kakaotalk', 'naver']) {
    assert.equal(BOT_UA_MARKERS.includes(forbidden), false, `위험한 마커: ${forbidden}`);
  }
});

test('BOT_UA_MARKERS: 어떤 마커도 사람 UA 목록에 등장하지 않는다', () => {
  for (const [label, ua] of HUMAN_USER_AGENTS) {
    const lower = ua.toLowerCase();
    for (const marker of BOT_UA_MARKERS) {
      assert.equal(lower.includes(marker), false, `${label} UA 에 마커 '${marker}' 가 들어 있다`);
    }
  }
});
