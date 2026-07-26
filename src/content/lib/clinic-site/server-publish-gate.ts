/**
 * 서버 전용 발행 게이트 — 저장된 검사 스냅샷 + 서버가 직접 수행하는 A층 재검사.
 *
 * 왜 스냅샷만으로는 부족한가:
 *  - saved_posts.compliance_report 는 클라이언트가 POST /api/posts 본문에 담아 보낸 값이다
 *    (validateComplianceReport 는 "형태"만 정규화할 뿐 서버가 만든 결과인지 확인하지 않는다).
 *    즉 인증된 회원이 grade:'PASS' / needsManualReview:false 스냅샷을 직접 만들어 보내면
 *    게이트를 그대로 통과한다.
 *  - 사람이 발행 버튼을 누르던 시절에는 그 위험이 "본인 블로그에 본인이 올린다"였지만,
 *    자동 발행은 무인이라 아무도 중간에서 눈치채지 못한 채 공개된다.
 *
 * 그래서 자동 경로에서는 서버가 본문을 직접 A층(키워드·상품명) 재검사한다.
 * 네트워크·LLM 호출이 없는 순수 함수(checkCompliance)라 비용도 지연도 없다.
 *
 * ⚠️ 차단 기준은 스냅샷 게이트(publishBlockReason)와 정확히 같은 선을 쓴다 —
 *    HIGH/CRITICAL 만 차단한다. 기준을 다르게 잡으면 "수동은 되는데 자동만 안 되는 글"이
 *    생겨 고객이 원인을 알 수 없다.
 *
 * B층(LLM 심의)은 재수행하지 않는다 — 호출당 비용·지연이 붙고 저장 시점 결과와
 * 달라질 수 있다. 위조 스냅샷의 대부분을 A층이 잡아내며, 남는 구멍(A층에 없는 표현으로
 * 쓰인 위반)은 서명된 리포트 도입으로만 완전히 닫힌다(별도 과제).
 */

import { checkCompliance } from '@/content/lib/medical-compliance';
import { publishBlockReason } from './publish-gate';
import type { PublishGateReport } from './publish-gate';

/** 스냅샷 게이트와 동일한 차단선. */
const BLOCKING_SEVERITIES: ReadonlySet<string> = new Set(['HIGH', 'CRITICAL']);

const SERVER_RECHECK_BLOCK_MESSAGE =
  '본문에서 의료광고법 위반 소지 표현이 확인되어 발행할 수 없습니다. 재검사 후 다시 시도해주세요.';

/**
 * 발행 차단 사유. 통과 시 null.
 *
 * ① 저장된 검사 스냅샷 판정(수동 발행과 완전히 같은 함수)
 * ② 서버가 본문을 직접 A층 재검사 — 스냅샷이 위조·낡았어도 여기서 걸린다.
 */
export function serverPublishBlockReason(
  report: PublishGateReport | null | undefined,
  content: string,
): string | null {
  const snapshotReason = publishBlockReason(report);
  if (snapshotReason !== null) return snapshotReason;

  const body = typeof content === 'string' ? content : '';
  if (body.trim() === '') return null; // 본문 없음은 호출부가 별도로 판정한다

  try {
    const { violations } = checkCompliance(body);
    if (violations.some((v) => BLOCKING_SEVERITIES.has(v.severity))) {
      return SERVER_RECHECK_BLOCK_MESSAGE;
    }
  } catch (err) {
    // 재검사 자체가 실패하면 보수적으로 차단한다(공개보다 미공개가 안전하다).
    console.error(
      '[clinic-site/server-gate] A층 재검사 실패:',
      err instanceof Error ? err.message : err,
    );
    return SERVER_RECHECK_BLOCK_MESSAGE;
  }

  return null;
}
