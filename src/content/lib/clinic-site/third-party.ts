/**
 * 고객 병원 블로그({slug}.hospitalblog.kr)에서 허용/차단하는 루트 레이아웃 태그 정책.
 *
 * 왜 필요한가:
 *  루트 레이아웃은 메인 사이트와 고객 병원 블로그를 "같은 트리"로 렌더한다. 그래서
 *  우리 마케팅·결제용 서드파티 스크립트가 아무 관계 없는 병원 환자의 브라우저에까지
 *  실려 나간다. 특히 메타 픽셀은 그 환자를 우리 광고 리타게팅 대상으로 수집하는데,
 *  환자도 병원도 동의한 적이 없다(개인정보보호법·병원과의 신뢰 양쪽 문제).
 *
 *  조건을 JSX 여기저기에 흩뿌리면 새 스크립트가 추가될 때마다 조용히 새어나가므로,
 *  "무엇을 왜 허용/차단하는지"를 이 한 곳의 데이터로 못박고 레이아웃은 이 정책만 읽는다.
 *
 * ⚠️ 러너 제약(slug.ts / auto-publish.ts 패턴): node --experimental-strip-types
 *    테스트 러너가 별칭·상대 경로 해석 없이 로드할 수 있도록 값 import 없이
 *    자립 모듈로 유지한다.
 */

/** 루트 레이아웃이 조건부로 렌더하는 태그 식별자. */
export type RootLayoutTag =
  | 'saas-json-ld'
  | 'meta-pixel'
  | 'portone-browser-sdk'
  | 'vercel-analytics'
  | 'notification-bell';

export interface RootLayoutTagPolicy {
  /** 고객 병원 블로그에서도 렌더할지 여부. */
  readonly allowedOnClinicSite: boolean;
  /** 판단 근거 — 정책을 바꿀 때 반드시 함께 갱신한다. */
  readonly reason: string;
}

const POLICY: Readonly<Record<RootLayoutTag, RootLayoutTagPolicy>> = {
  'saas-json-ld': {
    allowedOnClinicSite: false,
    reason:
      '닥터포스트 SaaS 의 Organization·SoftwareApplication 구조화 데이터(회사명·상품·가격). ' +
      '병원 블로그에는 그 병원의 MedicalClinic·Article 스키마만 있어야 한다. ' +
      '★ 이 태그는 이제 조건 분기가 아니라 **구조**로 지켜진다 — 스키마 출력을 ' +
      '루트 레이아웃에서 홈(app/page.tsx)으로 옮겨, 병원 블로그 트리에는 애초에 ' +
      '들어가지 않는다(회귀 테스트가 레이아웃·병원 페이지에 없음을 검사한다).',
  },
  'meta-pixel': {
    allowedOnClinicSite: false,
    reason:
      '메타(페이스북) 광고 픽셀. 병원 블로그를 읽었을 뿐인 환자가 우리 광고 리타게팅 ' +
      '대상으로 수집되고 _fbp 쿠키가 심긴다. 환자·병원 어느 쪽의 동의도 없다.',
  },
  'portone-browser-sdk': {
    allowedOnClinicSite: false,
    reason:
      '결제(빌링키 발급) 전용 SDK. 병원 블로그에는 결제 UI 가 없어 기능 손실이 0 이고, ' +
      '쓰지도 않는 외부 스크립트를 환자 브라우저에서 실행할 이유가 없다. ' +
      '실제 소비처는 BillingButton → PlanCard → PricingSection → /pricing 뿐이며, ' +
      '/pricing 은 자기 페이지에서 같은 SDK 를 따로 로드한다.',
  },
  'vercel-analytics': {
    allowedOnClinicSite: true,
    reason:
      '우리가 호스팅하는 사이트의 트래픽 측정(쿠키 없음·개인 식별 없음·광고 프로파일링 없음). ' +
      '병원에 "블로그에 방문자가 들어온다"를 보여주는 제품 지표라 유지한다. ' +
      '차단이 필요하면 이 값만 false 로 바꾸면 된다.',
  },
  'notification-bell': {
    allowedOnClinicSite: false,
    reason:
      '로그인한 회원에게만 뜨는 닥터포스트 제품 UI. 고객 병원의 공개 블로그 화면에 ' +
      '우리 서비스 UI 가 겹쳐 보이면 안 된다(공개 페이지 = 환자가 보는 화면).',
  },
};

/** 그 태그가 고객 병원 블로그에서도 렌더 가능한지. */
export function isAllowedOnClinicSite(tag: RootLayoutTag): boolean {
  return POLICY[tag].allowedOnClinicSite;
}

/** 정책 근거 문자열 (문서화·리뷰용). */
export function tagPolicyReason(tag: RootLayoutTag): string {
  return POLICY[tag].reason;
}

/**
 * 루트 레이아웃 렌더 판정.
 *  - 메인 사이트(isClinicSite=false) → 항상 렌더 (기존 동작 100% 유지)
 *  - 고객 병원 블로그(isClinicSite=true) → 정책이 허용한 태그만 렌더
 */
export function shouldRenderTag(tag: RootLayoutTag, isClinicSite: boolean): boolean {
  return isClinicSite ? isAllowedOnClinicSite(tag) : true;
}

/** 고객 병원 블로그에서 차단되는 태그 목록 (테스트·감사용). */
export function clinicSiteBlockedTags(): RootLayoutTag[] {
  return (Object.keys(POLICY) as RootLayoutTag[]).filter((tag) => !POLICY[tag].allowedOnClinicSite);
}

/** 정책에 등록된 전체 태그 목록 (신규 태그 누락 감지용). */
export function allRootLayoutTags(): RootLayoutTag[] {
  return Object.keys(POLICY) as RootLayoutTag[];
}
