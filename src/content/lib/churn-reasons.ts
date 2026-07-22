/**
 * 이탈 사유 수집 — 순수 검증 로직.
 *
 * 자동결제 취소·체험 만료 시 간단 사유 1문항을 수집한다(수집 경로만, 과설계 금지).
 * 사유 코드는 화이트리스트로 고정하고, 자유서술(detail)은 길이 제한만 둔다.
 */

/** 허용 이탈 사유 코드 (화이트리스트). */
export const CHURN_REASON_CODES = [
  'too_expensive', // 가격 부담
  'not_enough_time', // 쓸 시간이 없음
  'quality', // 결과물 품질 아쉬움
  'missing_feature', // 필요한 기능 부재
  'switched', // 다른 서비스로 이동
  'other', // 기타
] as const;

export type ChurnReasonCode = (typeof CHURN_REASON_CODES)[number];

/** 사유 코드가 화이트리스트에 속하는지 (타입 가드). */
export function isValidChurnReason(value: unknown): value is ChurnReasonCode {
  return typeof value === 'string' && (CHURN_REASON_CODES as readonly string[]).includes(value);
}

/** 자유서술 상한 길이. */
export const CHURN_DETAIL_MAX = 500;

/** 자유서술 정규화 — 제어문자 제거·공백 접기·길이 절단. 빈 값은 null. */
export function normalizeChurnDetail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, CHURN_DETAIL_MAX);
}

export type ChurnValidation =
  | { ok: true; reason: ChurnReasonCode; detail: string | null }
  | { ok: false };

/** 요청 본문 검증 (신뢰 불가 외부 입력 → 안전 좁힘). */
export function validateChurnBody(body: unknown): ChurnValidation {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  const { reason, detail } = body as { reason?: unknown; detail?: unknown };
  if (!isValidChurnReason(reason)) return { ok: false };
  return { ok: true, reason, detail: normalizeChurnDetail(detail) };
}
