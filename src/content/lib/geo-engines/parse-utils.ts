/**
 * 엔진 응답 파싱용 런타임 타입 가드.
 *
 * 어댑터가 타입 단언(as)만으로 외부 JSON 을 다루면 스키마가 바뀌었을 때
 * 반복문이나 .trim() 에서 "Cannot read properties of undefined" 같은
 * 무의미한 예외가 난다. 캐시 레이어가 실패로 격리해 크래시는 없지만
 * failures[] 에 남는 사유로는 원인을 알 수 없다.
 * → 파서 입구에서 형태를 확인하고 "무엇이 예상과 달랐는지"를 담은 에러를 던진다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지).
 */

export type JsonRecord = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 객체가 아니면 빈 객체 — 선택 필드 탐색용(에러를 던지지 않는다) */
export function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

/** 배열이 아니면 빈 배열 — 선택 필드 탐색용 */
export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 문자열이 아니면 빈 문자열 */
export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 점 표기 경로로 중첩 값 탐색 (배열 인덱스는 지원하지 않는다) */
export function pick(source: unknown, key: string): unknown {
  return asRecord(source)[key];
}

/**
 * 파서 입구 검증 — payload 가 객체가 아니면 즉시 실패시킨다.
 * label 은 실패 사유에 그대로 실려 어느 엔진의 무엇이 깨졌는지 드러난다.
 */
export function requireRecord(payload: unknown, label: string): JsonRecord {
  if (!isRecord(payload)) {
    throw new Error(`${label} 응답 형식 오류: 최상위가 객체가 아닙니다 (${describeType(payload)}).`);
  }
  return payload;
}

/** 필수 배열 필드 검증 — 없거나 배열이 아니면 어느 필드인지 밝히고 실패 */
export function requireArray(value: unknown, label: string, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} 응답 형식 오류: ${field} 가 배열이 아닙니다 (${describeType(value)}).`);
  }
  return value;
}

/** 에러 메시지에 넣을 짧은 타입 설명 — 응답 원문은 절대 싣지 않는다 */
export function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
