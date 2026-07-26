/**
 * 병원 서브도메인 블로그 — 발행 게이트 (순수 로직 모듈).
 *
 * geo-export(/api/mypage/geo-export) 검수 게이트와 "동일 기준":
 *  - 검사 스냅샷(saved_posts.compliance_report) 없음 → 차단
 *  - needsManualReview=true 또는 grade HIGH/CRITICAL → 차단
 *
 * 스냅샷 파싱·검증(validateComplianceReport)은 호출부(API 라우트)가 수행하고,
 * 이 모듈은 검증 완료된 형태(또는 null)를 받아 판정만 한다 — 러너 제약
 * (node --experimental-strip-types, 상대 값 import 불가) 때문에 값 import 없이
 * 자립 모듈로 유지한다 (compliance-report.ts 패턴).
 */

/** 판정에 필요한 최소 형태 — ComplianceReportSnapshot 의 부분집합. */
export interface PublishGateReport {
  grade: string;
  needsManualReview: boolean;
}

/**
 * 내 블로그 발행 차단 사유를 반환한다. 통과 시 null.
 * (문구는 geo-export 의 exportBlockReason 과 같은 기준·톤, 발행 문맥으로 조정)
 */
export function publishBlockReason(report: PublishGateReport | null | undefined): string | null {
  if (!report) {
    return '의료광고법 검사 기록이 아직 없는 글입니다. 콘텐츠 보관함의 "검사 리포트"에서 검사를 먼저 완료한 뒤 다시 시도해주세요.';
  }
  if (report.needsManualReview || report.grade === 'HIGH' || report.grade === 'CRITICAL') {
    return '의료광고법 검수가 필요한 글은 내 블로그에 발행할 수 없습니다. 지적된 표현을 수정하고 재검사를 통과한 후 다시 시도해주세요.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// 저장 즉시 자동 발행 판정 (순수 함수)
// ---------------------------------------------------------------------------

/** 저장 즉시 자동 발행을 하지 않은 이유 (사용자에게 노출하지 않는 내부 값). */
export type AutoPublishSkipReason =
  | 'cadence_not_auto'   // 자동발행 주기가 'auto' 가 아님(기본 off / weekly / biweekly)
  | 'no_slug'            // 블로그 주소 미설정
  | 'subscription_inactive' // 무료·만료 회원 — 신규 자동발행 중단(기존 글은 유지)
  | 'review_blocked'     // 의료광고법 검수 게이트 차단
  | 'empty_content';     // 본문 없음

export interface AutoPublishOnSaveInput {
  /** profiles.site_publish_cadence */
  cadence: string | null | undefined;
  /** profiles.site_slug */
  siteSlug: string | null | undefined;
  /** 유료 플랜이 살아 있는지 (isActivePlan 결과) */
  subscriptionActive: boolean;
  /** publishBlockReason 결과 — 절대 이 모듈에서 다시 계산하지 않는다(게이트 우회 방지). */
  blockReason: string | null;
  /** saved_posts.content */
  content: string;
}

export type AutoPublishOnSaveDecision =
  | { publish: true }
  | { publish: false; reason: AutoPublishSkipReason };

/**
 * 글이 저장되는 순간 곧바로 내 블로그에 발행할지 판정한다.
 *
 * ★ 검수 게이트는 여기서 다시 판정하지 않는다 — 호출부가 수동 발행과 "완전히 같은"
 *   publishBlockReason 결과를 넘겨야 한다. 게이트 로직이 두 벌이 되는 순간
 *   한쪽만 고쳐져 검수 미통과 글이 새어 나간다.
 *
 * 차단 사유는 사용자 플로우를 막는 데 쓰지 않는다(글 저장은 항상 성공).
 */
export function decideAutoPublishOnSave(
  input: AutoPublishOnSaveInput,
): AutoPublishOnSaveDecision {
  if (input.cadence !== 'auto') return { publish: false, reason: 'cadence_not_auto' };

  const slug = (input.siteSlug ?? '').trim();
  if (slug === '') return { publish: false, reason: 'no_slug' };

  // 구독 해지·만료: 기존 글은 그대로 두고 "새 글 자동 발행"만 멈춘다.
  if (!input.subscriptionActive) return { publish: false, reason: 'subscription_inactive' };

  if (input.blockReason !== null) return { publish: false, reason: 'review_blocked' };
  if ((input.content ?? '').trim() === '') return { publish: false, reason: 'empty_content' };

  return { publish: true };
}
