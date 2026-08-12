// Meta Pixel 이벤트 발송 유틸리티
// 사용법: import { trackEvent } from '@/dev/lib/meta-pixel';

import { isTokenBearingPath } from '@/content/lib/clinic-site/third-party';

type MetaPixelEvent =
  | 'ViewContent'
  | 'CompleteRegistration'
  | 'Lead'
  | 'InitiateCheckout'
  | 'Subscribe'
  | 'Purchase'
  | 'AddToCart'
  | 'Search';

interface EventParams {
  content_name?: string;
  content_category?: string;
  content_ids?: string[];
  content_type?: string;
  value?: number;
  currency?: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * 실제 발송 — ★어떤 경우에도 예외를 밖으로 내보내지 않는다 (2026-08-12).
 *
 * 계측이 제품 흐름을 깨서는 안 된다. `typeof window.fbq === 'function'` 검사를
 * 통과해도 호출 자체가 던질 수 있다(확장 프로그램이 fbq 를 덮어썼거나, CSP·
 * 광고차단기가 중간에 개입한 경우). 그런데 호출부가 하필 다음 자리들이다:
 *   · 진단 조회 시작 직전 → 던지면 **진단이 아예 시작되지 않는다**
 *   · CTA 클릭 핸들러 맨 앞 → 던지면 **가입 모달이 안 뜬다**
 *   · 이메일 제출 성공 직후(try 블록 안) → 던지면 바깥 catch 가 잡아서
 *     **서버는 접수했는데 사용자에게는 실패로 보인다**
 * 셋 다 실제 매출 경로다. 그래서 헬퍼 한 곳에서 통째로 막는다.
 */
function send(mode: 'track' | 'trackCustom', eventName: string, params?: EventParams): boolean {
  // ★토큰이 실린 주소에서는 아무것도 보내지 않는다 (2026-08-12).
  //   RootThirdPartyTags 가 그 경로에서 <MetaPixel> 을 렌더하지 않게 해 뒀지만,
  //   **렌더를 막는 것과 발송을 막는 것은 다르다.** SPA 로 /clinic-check →
  //   /clinic-check/r/{token} 으로 넘어오면 앞 페이지에서 이미 실행된 스크립트 때문에
  //   window.fbq 는 그대로 살아 있다. 그 상태로 이벤트를 보내면 fbq 가 현재 문서 주소를
  //   함께 실어 보내 **리포트 열쇠가 광고 플랫폼으로 넘어간다.**
  //   ⇒ 정책을 발송 지점에서 한 번 더 강제한다.
  //   ⚠️**fail-closed** — 경로를 읽지 못하면 보낸다가 아니라 **안 보낸다**.
  //     여기가 토큰 유출을 막는 마지막 경계라, 판단 불가일 때 통과시키면 경계가 아니다.
  //     잃는 건 비정상 상태에서의 계측 몇 건이고, 잃을 뻔한 건 리포트 접근 권한이다.
  const path = typeof window.location?.pathname === 'string' ? window.location.pathname : null;
  if (path === null || isTokenBearingPath(path)) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        `[MetaPixel] ${path === null ? '경로 판독 불가' : '토큰 경로'}라 발송하지 않음: ${eventName}`,
      );
    }
    return false;
  }
  try {
    window.fbq(mode, eventName, params);
    if (process.env.NODE_ENV === 'development') {
      console.log(`[MetaPixel] ${mode} sent: ${eventName}`, params);
    }
    return true;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[MetaPixel] ${mode} failed (무시): ${eventName}`, e);
    }
    return false;
  }
}

/**
 * `window.fbq` 를 직접 부르는 곳이 쓰는 안전 래퍼.
 * (MetaPixel 컴포넌트의 SPA PageView 처럼 이 모듈 밖에서 호출하는 경우)
 */
export function safePageView(): void {
  if (typeof window === 'undefined') return;
  if (typeof window.fbq !== 'function') return;
  send('track', 'PageView');
}

/**
 * Meta Pixel 표준 이벤트 발송
 * 브라우저에서만 작동 (서버사이드에서는 무시됨)
 */
export function trackEvent(eventName: MetaPixelEvent, params?: EventParams): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.fbq !== 'function') {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[MetaPixel] fbq not loaded. Event skipped: ${eventName}`, params);
    }
    return false;
  }

  return send('track', eventName, params);
}

/**
 * Meta Pixel 커스텀 이벤트 발송 (표준 이벤트에 없는 경우)
 */
export function trackCustomEvent(eventName: string, params?: EventParams): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.fbq !== 'function') return false;

  return send('trackCustom', eventName, params);
}

/**
 * 무료진단 퍼널 이벤트 — ★표준 이벤트를 쓰지 않고 전용 커스텀 이벤트로 뺀다 (2026-08-12).
 *
 * 왜 커스텀인가:
 *   표준 이벤트는 이미 다른 뜻으로 쓰이고 있어서 섞으면 최적화가 오염된다.
 *     · `InitiateCheckout` = 실제 결제 시작(BillingButton). 진단 CTA 클릭을 여기 얹으면
 *       구매 가능성이 전혀 다른 두 행동이 한 지표가 되고 결제 퍼널 수치가 깨진다.
 *     · `Lead` = /sample 결과 노출 + 회원가입. "샘플을 봤다"는 연락처 제출도 아니라
 *       진단 이메일 제출과 품질 차이가 크다.
 *   ⇒ 진단 퍼널은 통째로 분리해 두고, 광고 최적화는 이 커스텀 이벤트로 만든
 *     **맞춤 전환**을 목표로 잡는다.
 *
 * ⚠️코드만 바꾼다고 최적화에 쓰이지 않는다. Meta Events Manager 에서
 *   맞춤 전환을 만들고 광고 세트의 최적화 목표로 지정해야 한다.
 *
 * ⚠️파라미터에 개인정보를 넣지 않는다 — 이메일·병원명·공유 토큰 전부 금지.
 *   "이 일이 일어났다"는 사실만 보낸다.
 */
export const DIAGNOSIS_PIXEL_EVENT = {
  started: 'ClinicDiagnosisStarted',
  reportViewed: 'ClinicDiagnosisReportViewed',
  ctaClicked: 'ClinicDiagnosisCtaClicked',
  emailSubmitted: 'ClinicDiagnosisEmailSubmitted',
} as const;

/** 한 번만 보내야 하는 이벤트의 발사 기록 (탭 수명 기준). */
const firedOnce = new Set<string>();

/**
 * 진단 퍼널 이벤트를 **한 번만** 보낸다.
 *
 * 같은 방문자가 블로그 후보를 바꾸거나 상세 진단을 다시 제출하면 결과 화면이 다시
 * 그려지고, 이메일 폼은 리포트에 두 군데 있어 각각 제출될 수 있다. 그대로 두면
 * 진단 옵션을 여러 번 만지는 적극 사용자 한 명이 여러 명처럼 잡혀 광고 학습이 틀어진다.
 *
 * @param key 중복 판정 단위. 같은 key 는 이 탭에서 다시 보내지 않는다.
 */
export function trackDiagnosisOnce(
  eventName: string,
  key: string,
  params?: EventParams,
): void {
  if (typeof window === 'undefined') return;
  const slot = `${eventName}:${key}`;
  if (firedOnce.has(slot)) return;
  // ★보내기 전에 기록하면 안 된다 (2026-08-12 Codex 지적).
  //   픽셀은 afterInteractive 로 로드된다. 진단 시작이 그보다 먼저 일어나면
  //   fbq 가 아직 없어 아무것도 안 나가는데, 먼저 기록해 두면 그 이벤트는
  //   이 탭에서 영원히 소비된 것이 된다 — 실제 전환 0건인데 '보냈다'가 된다.
  if (trackCustomEvent(eventName, params)) firedOnce.add(slot);
}
