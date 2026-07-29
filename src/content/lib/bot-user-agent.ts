/**
 * 퍼널 계측용 봇 User-Agent 판정 — **순수 로직 모듈** (외부 의존 없음).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ 왜 만들었나 (2026-07-29 실측 근거 — 이 숫자를 지우지 마라)
 *
 * 최근 7일 funnel_events 를 세면 고유 방문자(anon_id)가 49개인데, **사람은 사실상
 * 1명**이었다. 근거:
 *   - 서로 다른 anon_id 가 **같은 분(分)에 무더기로** 생겼다: 07/27 14:38 에 6개,
 *     07/27 19:44 에 3개, 07/26 20:55 에 3개, 07/29 10:15 에 3개 — 13개 시점에서
 *     30개 ID 가 이렇게 발생했다.
 *   - 49개 중 **42개가 이벤트 1건뿐**이고 대부분 `/` 에 landing_view 한 번 찍고 끝.
 *   - 리퍼러가 남은 건 7일 통틀어 search.naver.com **1건**뿐.
 *
 * 원인은 anon_id 설계가 아니라 **쿠키를 저장하지 않는 클라이언트**다. 크롤러·링크
 * 스캐너는 Set-Cookie 를 버리므로 매 요청마다 새 anon_id 를 발급받는다. 그래서 봇
 * 1~2개가 방문자 30명으로 부풀었다.
 *
 * 특히 07/29 10:15 의 3건은 meta.source="email" 인데 하필 콜드메일 발송 창
 * (10:04~10:19)에 들어와 1건씩 찍고 끝났다 — **회사 메일 보안 링크스캐너**로 본다.
 * 이게 가장 위험하다: 앞으로 콜드메일·릴스 성과를 이 지표로 판단하는데, 스캐너가
 * 유입으로 잡히면 "메일이 먹혔다"는 정반대 결론을 내리게 된다.
 *
 * ⚠️ **2026-07-29 이전 funnel_events 데이터는 오염돼 있다.** 이 필터는 앞으로 들어오는
 *    것만 막는다(소급 정리는 하지 않았다). 7월 방문자·유입 수치를 그대로 인용하지 마라.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 판정 방식: 소문자 변환 후 **부분 문자열 매칭**만 쓴다(정규식 없음 = ReDoS 없음).
 *
 * ★ 오판 비용의 비대칭성: 봇을 놓치면 지표가 조금 부풀지만, **사람을 봇으로 오판하면
 *   지표가 0 이 된다**(그 방문은 영영 기록되지 않는다). 그래서 마커는 정상 브라우저
 *   UA 에 절대 나타나지 않는 것만 고른다. 특히 "safari"(모든 크롬·사파리 UA 에 있음)와
 *   "safelinks"(Microsoft 메일 링크스캐너)를 혼동하지 않도록 마커는 항상 긴 쪽을 쓴다.
 *   같은 이유로 in-app 브라우저(카카오톡·네이버앱)는 사람이므로 "kakaotalk" 이 아니라
 *   스크래퍼 전용인 "kakaotalk-scrap" 만 마커로 둔다.
 *
 * ※ src/content/lib/ai-referral/request.ts 의 isLikelyBotUserAgent 와 목적이 다르다:
 *   그쪽은 AI 크롤러 제외가 목적이고 'preview'·'monitoring' 같은 넓은 마커를 쓴다.
 *   합치면 그 기능의 기존 집계가 바뀌므로(이번 범위 밖) 별도 목록으로 둔다.
 */

/** 일반 크롤러·자동화 도구·HTTP 클라이언트. */
const GENERIC_BOT_MARKERS: readonly string[] = [
  'bot',
  'crawler',
  'crawling',
  'spider',
  'slurp',
  'headless',
  'phantom',
  'puppeteer',
  'playwright',
  'selenium',
  'lighthouse',
  'curl',
  'wget',
  'python-requests',
  'go-http-client',
  'java/',
  'okhttp',
  'axios',
  'node-fetch',
];

/**
 * 국내 검색 크롤러 — 이름에 'bot' 이 없어서 일반 마커로는 안 잡힌다.
 * 우리 유입의 주 검색엔진이 네이버라 이 둘은 실제로 랜딩을 자주 긁는다.
 * 슬래시를 붙여 UA 의 제품 토큰 형태로만 매칭한다(우연한 부분 일치 방지).
 */
const KOREAN_CRAWLER_MARKERS: readonly string[] = [
  'yeti/', // 네이버 검색 크롤러
  'daumoa', // 다음 검색 크롤러
];

/**
 * 이름에 'bot' 이 없는 구글 계열 수집기 — 일반 마커로는 통과해 버린다.
 */
const SEARCH_CRAWLER_MARKERS: readonly string[] = [
  'googleother',
  'google-inspectiontool',
  'bingpreview',
];

/**
 * 링크 미리보기 봇 (메신저·SNS 가 URL 카드를 만들려고 긁는다).
 * 사람의 방문이 아니라 **사람이 링크를 붙여넣은 흔적**이므로 유입으로 세면 안 된다.
 */
const PREVIEW_BOT_MARKERS: readonly string[] = [
  'facebookexternalhit',
  'twitterbot',
  'slackbot',
  'discordbot',
  'telegrambot',
  // WhatsApp 은 미리보기 봇과 in-app WebView 가 같은 'WhatsApp/x.y' 토큰을 쓸 수 있어
  // 사람 클릭이 섞여 들어갈 여지가 있다. 국내 병의원 대상 채널에서 WhatsApp 유입은
  // 사실상 0 이라 (놓치는 사람 ≈ 0) < (섞이는 미리보기 봇) 으로 보고 봇으로 둔다.
  'whatsapp',
  'linkedinbot',
  // ⚠️ 'kakaotalk' 이 아니다 — 카카오톡 in-app 브라우저(사람)의 UA 에 'KAKAOTALK' 이
  //    들어 있어서 그걸로 막으면 실제 방문자를 통째로 날린다.
  'kakaotalk-scrap',
  'embedly',
  'quora link preview',
];

/**
 * ★ 메일 보안 링크스캐너 — **이번 필터의 핵심**.
 * 수신 병원의 메일 게이트웨이가 콜드메일 안의 링크를 자동으로 열어 본다. 발송 직후
 * 1건씩 찍히고 끝나는 07/29 10:15 패턴이 정확히 이것이다. 이걸 못 걸러내면 콜드메일
 * 성과가 스캐너 수만큼 부풀어 잘못된 채널 판단으로 이어진다.
 */
const MAIL_SCANNER_MARKERS: readonly string[] = [
  'proofpoint',
  'barracuda',
  'mimecast',
  'symantec',
  'forcepoint',
  'trendmicro',
  // Microsoft Defender for Office 365 의 링크 재작성. 'safari' 와 겹치지 않는다.
  'safelinks',
  'microsoft office',
  'outlook',
  // Proofpoint URL Defense 재작성 링크를 따라오는 클라이언트.
  'urldefense',
  'cloudmark',
  'messagelabs',
  'bitdefender',
];

/** 가동 모니터링 — 우리(또는 제3자)가 띄우는 헬스체크. 사람 방문이 아니다. */
const MONITORING_MARKERS: readonly string[] = [
  'uptimerobot',
  'pingdom',
  'statuscake',
  'datadog',
  'newrelic',
  'betteruptime',
];

/** 전체 마커 (읽기 전용 — 테스트가 이 목록을 그대로 검증한다). */
export const BOT_UA_MARKERS: readonly string[] = Object.freeze([
  ...GENERIC_BOT_MARKERS,
  ...KOREAN_CRAWLER_MARKERS,
  ...SEARCH_CRAWLER_MARKERS,
  ...PREVIEW_BOT_MARKERS,
  ...MAIL_SCANNER_MARKERS,
  ...MONITORING_MARKERS,
]);

/**
 * ★ 사람 UA 인데 봇 마커를 **부분 문자열로 품고 있는** 토큰들.
 * 판정 전에 이 토큰들을 잘라내고 매칭한다 — 마커를 지우는 대신 예외만 도려내는 방식이라
 * 봇 탐지 범위는 그대로 두면서 오판만 제거한다.
 *
 *  - cubot   : 실존하는 안드로이드 단말 제조사(CUBOT X19 등). 소문자로 'cubot' 이라
 *              generic 마커 'bot' 에 걸린다 → 그 기종 사용자의 모든 이벤트가 영구 폐기된다.
 *              (2026-07-29 Codex 교차검증에서 잡힌 실제 오판)
 *  - outlook-ios / outlook-android
 *            : Outlook **모바일 앱의 in-app 브라우저 = 사람의 클릭**이다. 우리는
 *              콜드메일로 유입을 만들므로 이걸 막으면 정작 재려던 전환을 지워버린다.
 *              반면 데스크톱 클라이언트가 스스로 긁는 'Microsoft Outlook 16.0' 형태는
 *              사람의 페이지 방문이 아니므로 마커 'outlook' 으로 계속 걸린다.
 */
const HUMAN_UA_EXCEPTIONS: readonly string[] = ['cubot', 'outlook-ios', 'outlook-android'];

/**
 * UA 최소 길이. 이보다 짧으면 봇으로 본다.
 * 통상적인 브라우저 UA 는 "Mozilla/5.0 (...)" 형태라 가장 짧은 구형 모바일도 50자를
 * 넘는다. 10자는 그 아래로 한참 여유를 둔 값이라 실질적으로는 UA 를 아예 안 보내거나
 * "-"·"none" 같은 값을 보내는 스크립트만 걸린다.
 * ⚠️ 다만 "사람은 절대 안 걸린다"는 보장은 아니다 — UA 를 극단적으로 축약하는
 *    프라이버시 클라이언트/WebView 는 여기서 함께 잘린다(수용한 트레이드오프).
 */
export const MIN_HUMAN_UA_LENGTH = 10;

/**
 * 봇/스캐너로 볼 User-Agent 인가.
 * **판정에만 쓰고 UA 문자열은 DB 로 내보내지 않는다**(PII 미저장 원칙).
 *
 * ⚠️ 이것은 증명이 아니라 **휴리스틱**이다. UA 를 브라우저처럼 위장한 스캐너는 통과하고,
 *    반대로 자기를 봇이라 칭하면 계측에서 빠진다. 목적은 "정직한 봇"이 만들던 대규모
 *    오염(방문자 49 vs 사람 1)을 걷어내는 것이지 완전한 봇 차단이 아니다.
 *
 * @param ua 요청의 user-agent 헤더 값 (없으면 null)
 * @returns true 면 계측에서 제외한다
 */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (typeof ua !== 'string') return true;
  const normalized = ua.trim().toLowerCase();
  // 빈 UA·지나치게 짧은 UA = 정상 브라우저가 아니다.
  if (normalized.length < MIN_HUMAN_UA_LENGTH) return true;
  // 사람 UA 안에 우연히 박힌 마커(cubot 의 'bot' 등)를 먼저 도려낸다.
  const candidate = HUMAN_UA_EXCEPTIONS.reduce(
    (acc, token) => acc.split(token).join(' '),
    normalized,
  );
  return BOT_UA_MARKERS.some((marker) => candidate.includes(marker));
}
