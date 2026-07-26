/**
 * 컴플라이언스 증빙 스냅샷 — 서버측 재산정 게이트.
 *
 * compliance_report 는 클라이언트가 계산해 보낸다. 그대로 저장하면 위반 글에
 * `grade:"PASS"` / `needsManualReview:false` 를 실어 발행 게이트(site-publish·
 * GEO export·auto-publish)를 우회할 수 있다. 증빙이 USP 인 제품에서 증빙 자체가
 * 조작 가능하면 의미가 없다.
 *
 * 따라서 A층(키워드/상품명)은 **서버가 저장될 본문으로 다시 검사**하고, 등급과
 * 검수 권고를 재산정한다. B층(LLM 심의)은 재호출 비용이 커서 클라이언트 보고분을
 * 쓰되, 그 값은 표시 전용이며 A층 재검사 결과가 항상 등급의 하한을 결정한다.
 *
 * ⚠️ compliance-report.ts 는 테스트 러너 제약(값 import 금지)으로 checkCompliance 를
 *    부를 수 없어, 조합은 이 서버 전용 모듈에서 한다.
 */
import { checkCompliance } from '@/content/lib/medical-compliance';
import {
  buildComplianceReport,
  validateComplianceReport,
  type ComplianceReportSnapshot,
} from '@/content/lib/compliance-report';

/**
 * 클라이언트 리포트를 검증한 뒤 A층을 서버 재검사로 대체한 스냅샷을 만든다.
 *
 * - 리포트 미전송·형태 불일치 → null(컬럼 미설정, 글 저장 자체는 막지 않는 방침)
 * - 본문이 비어 있으면 → null(재검사 불가 — 검증만 통과한 값을 믿지 않는다)
 */
export function buildServerComplianceReport(
  rawReport: unknown,
  content: unknown,
): ComplianceReportSnapshot | null {
  const validated = validateComplianceReport(rawReport);
  if (!validated) return null;

  const body = typeof content === 'string' ? content.trim() : '';
  if (body === '') return null;

  const serverCheck = checkCompliance(body);

  return buildComplianceReport({
    compliance: {
      isCompliant: serverCheck.isCompliant,
      violations: serverCheck.violations,
      warnings: serverCheck.warnings,
    },
    // B층 결과·자동교정 이력은 클라이언트 보고분을 보존한다(재현 비용 방어).
    // 둘 다 등급·게이트 판정에는 관여하지 않는다.
    aiReview: validated.aiReview,
    autoFixed: validated.keyword.autoFixed,
    checkedAt: validated.checkedAt,
  });
}
