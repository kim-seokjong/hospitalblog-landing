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
