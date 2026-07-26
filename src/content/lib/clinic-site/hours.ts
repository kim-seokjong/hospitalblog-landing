/**
 * 병원 진료시간 — 검증 · 표시 · 구조화 데이터 (순수 로직 모듈).
 *
 * 왜 자유 텍스트가 아니라 구조인가:
 *  - 진료시간은 "지금 문 열었나"를 묻는 AI 검색·지도 검색이 실제로 읽는 정보다.
 *    schema.org OpeningHoursSpecification 으로 내보내려면 요일·시각이 분리돼야 한다.
 *  - 반대로 요일 7개를 전부 따로 받으면 입력이 길어져 아무도 안 채운다.
 *    → 평일(월~금) · 토요일 · 일요일 · 공휴일 4구간 + 점심시간 + 안내문구로 절충한다.
 *
 * 값의 의미 (세 상태를 구분한다):
 *  - { open, close } : 진료함
 *  - 'closed'        : 휴진 (화면에 "휴진"으로 표시 — 유용한 정보다)
 *  - null            : 미설정 (화면에서 그 줄 자체가 사라진다)
 *
 * ⚠️ 러너 제약(slug.ts / romanize.ts 패턴): node --experimental-strip-types
 *    테스트 러너가 로드할 수 있도록 값 import 없이 자립 모듈로 유지한다.
 */

/** 'HH:MM' 24시간 표기. */
export interface ClinicHoursRange {
  open: string;
  close: string;
}

/** 진료함 | 휴진 | 미설정 */
export type ClinicHoursValue = ClinicHoursRange | 'closed' | null;

export interface ClinicHours {
  /** 평일(월~금) */
  weekday: ClinicHoursValue;
  saturday: ClinicHoursValue;
  sunday: ClinicHoursValue;
  /** 공휴일 */
  holiday: ClinicHoursValue;
  /** 점심시간(휴진 구간) — 'closed' 는 의미가 없어 범위 또는 null 만 쓴다. */
  lunch: ClinicHoursRange | null;
  /** 안내 문구(예: 전화 예약 후 방문). 빈 문자열이면 표시하지 않는다. */
  note: string;
}

export type ClinicHoursDayKey = 'weekday' | 'saturday' | 'sunday' | 'holiday';

/** 요일 구간 키 — 표시 순서를 이 배열이 정한다. */
export const CLINIC_HOURS_DAY_KEYS: readonly ClinicHoursDayKey[] = [
  'weekday',
  'saturday',
  'sunday',
  'holiday',
];

const DAY_LABELS: Readonly<Record<ClinicHoursDayKey, string>> = {
  weekday: '평일',
  saturday: '토요일',
  sunday: '일요일',
  holiday: '공휴일',
};

/** schema.org dayOfWeek 매핑 — 평일은 월~금 5일로 펼친다. */
const SCHEMA_DAYS: Readonly<Record<ClinicHoursDayKey, readonly string[]>> = {
  weekday: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  saturday: ['Saturday'],
  sunday: ['Sunday'],
  holiday: ['PublicHolidays'],
};

/** 안내 문구 길이 상한 — 공개 페이지에 그대로 나가므로 경계에서 자른다. */
export const CLINIC_HOURS_NOTE_MAX_LENGTH = 200;

const TIME_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

/** 빈 진료시간(모두 미설정) — 저장·표시 판정의 기준값. */
export const EMPTY_CLINIC_HOURS: ClinicHours = {
  weekday: null,
  saturday: null,
  sunday: null,
  holiday: null,
  lunch: null,
  note: '',
};

/** 'HH:MM' 형식인지. ('9:00' 처럼 앞자리가 빠진 값은 정규화 후 판정한다) */
export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

/** '9:5' → '09:05' 같은 축약 입력을 정규화한다. 불가하면 null. */
function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const match = /^(\d{1,2}):(\d{1,2})$/.exec(trimmed);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 'HH:MM' → 분. 형식 검증을 통과한 값만 넣는다. */
function toMinutes(time: string): number {
  const [hour, minute] = time.split(':');
  return Number(hour) * 60 + Number(minute);
}

/**
 * 시간 범위를 검증·정규화한다. 시작이 끝보다 늦거나 같으면 null
 * (자정을 넘기는 진료시간은 지원하지 않는다 — 병원 운영 현실에 없다).
 */
export function parseRange(raw: unknown): ClinicHoursRange | null {
  if (raw === null || typeof raw !== 'object') return null;
  const source = raw as { open?: unknown; close?: unknown };

  const open = normalizeTime(source.open);
  const close = normalizeTime(source.close);
  if (open === null || close === null) return null;
  if (toMinutes(open) >= toMinutes(close)) return null;

  return { open, close };
}

function parseValue(raw: unknown): ClinicHoursValue {
  if (raw === 'closed') return 'closed';
  return parseRange(raw);
}

/**
 * 외부 입력(요청 본문 · DB jsonb)을 ClinicHours 로 검증한다.
 * 형태가 아니거나 쓸 내용이 하나도 없으면 null (저장 시 컬럼을 null 로 비운다).
 */
export function parseClinicHours(raw: unknown): ClinicHours | null {
  if (raw === null || raw === undefined) return null;

  // DB jsonb 가 문자열로 오는 경우(드라이버·마이그레이션 차이)까지 방어한다.
  let source: unknown = raw;
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (trimmed === '') return null;
    try {
      source = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (source === null || typeof source !== 'object' || Array.isArray(source)) return null;
  const input = source as Record<string, unknown>;

  const noteRaw = typeof input.note === 'string' ? input.note.trim() : '';
  const hours: ClinicHours = {
    weekday: parseValue(input.weekday),
    saturday: parseValue(input.saturday),
    sunday: parseValue(input.sunday),
    holiday: parseValue(input.holiday),
    lunch: parseRange(input.lunch),
    note: noteRaw.slice(0, CLINIC_HOURS_NOTE_MAX_LENGTH),
  };

  return isEmptyClinicHours(hours) ? null : hours;
}

export type ClinicHoursValidation =
  /** hours 가 null 이면 "미설정"(컬럼을 비운다) */
  | { ok: true; hours: ClinicHours | null }
  | { ok: false; reason: string };

const DAY_INPUT_LABELS: Readonly<Record<ClinicHoursDayKey, string>> = DAY_LABELS;

/**
 * 사용자 입력(요청 본문)을 검증한다.
 *
 * parseClinicHours 와 다른 점: 형식이 깨진 값을 **조용히 버리지 않고** 사유를 돌려준다.
 * 저장 경로에서는 이 함수를 써야 한다 — "저장했는데 진료시간이 사라졌다"는
 * 사용자가 원인을 알 수 없는 최악의 실패다.
 * (반대로 DB 를 읽을 때는 관대한 parseClinicHours 를 쓴다. 이미 저장된 값 하나 때문에
 *  공개 페이지 전체가 죽으면 안 된다.)
 */
export function validateClinicHoursInput(raw: unknown): ClinicHoursValidation {
  if (raw === null || raw === undefined) return { ok: true, hours: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: '진료시간 형식이 올바르지 않습니다.' };
  }

  const input = raw as Record<string, unknown>;
  const days: Record<ClinicHoursDayKey, ClinicHoursValue> = {
    weekday: null,
    saturday: null,
    sunday: null,
    holiday: null,
  };

  for (const key of CLINIC_HOURS_DAY_KEYS) {
    const value = input[key];
    if (value === null || value === undefined) continue;
    if (value === 'closed') {
      days[key] = 'closed';
      continue;
    }
    const range = parseRange(value);
    if (range === null) {
      return {
        ok: false,
        reason: `${DAY_INPUT_LABELS[key]} 진료시간이 올바르지 않습니다. 시작 시각이 종료 시각보다 빨라야 합니다.`,
      };
    }
    days[key] = range;
  }

  let lunch: ClinicHoursRange | null = null;
  if (input.lunch !== null && input.lunch !== undefined) {
    lunch = parseRange(input.lunch);
    if (lunch === null) {
      return {
        ok: false,
        reason: '점심시간이 올바르지 않습니다. 시작 시각이 종료 시각보다 빨라야 합니다.',
      };
    }
  }

  const noteRaw = typeof input.note === 'string' ? input.note.trim() : '';
  const hours: ClinicHours = {
    ...days,
    lunch,
    note: noteRaw.slice(0, CLINIC_HOURS_NOTE_MAX_LENGTH),
  };

  return { ok: true, hours: isEmptyClinicHours(hours) ? null : hours };
}

/** 표시할 내용이 하나도 없는지. */
export function isEmptyClinicHours(hours: ClinicHours | null | undefined): boolean {
  if (!hours) return true;
  const hasDay = CLINIC_HOURS_DAY_KEYS.some((key) => hours[key] !== null);
  return !hasDay && hours.lunch === null && hours.note.trim() === '';
}

export interface ClinicHoursRow {
  label: string;
  value: string;
}

/** 'HH:MM ~ HH:MM' */
function formatRange(range: ClinicHoursRange): string {
  return `${range.open} ~ ${range.close}`;
}

/**
 * 화면에 그릴 줄 목록을 만든다(미설정 구간은 빠진다).
 * 점심시간은 마지막에 붙인다 — 요일 정보를 읽은 뒤 보는 부가 정보다.
 */
export function formatClinicHoursRows(hours: ClinicHours | null | undefined): ClinicHoursRow[] {
  if (!hours) return [];

  const rows: ClinicHoursRow[] = [];
  for (const key of CLINIC_HOURS_DAY_KEYS) {
    const value = hours[key];
    if (value === null) continue;
    rows.push({
      label: DAY_LABELS[key],
      value: value === 'closed' ? '휴진' : formatRange(value),
    });
  }
  if (hours.lunch) {
    rows.push({ label: '점심시간', value: formatRange(hours.lunch) });
  }
  return rows;
}

/** JSON-LD 노드(geo-schema 의 JsonLdObject 와 같은 형태 — 값 import 없이 재정의). */
export type ClinicHoursSchemaNode = Record<string, unknown>;

/**
 * schema.org OpeningHoursSpecification 배열을 만든다.
 *
 * 휴진('closed')은 항목을 아예 만들지 않는다 — opens/closes 를 '00:00' 으로 같게 넣는
 * 표현은 크롤러마다 해석이 갈려 "0시부터 0시까지 영업"으로 읽힐 위험이 있다.
 * 사람에게 보이는 화면에는 "휴진"으로 그대로 표시된다(formatClinicHoursRows).
 */
export function buildOpeningHoursSpecification(
  hours: ClinicHours | null | undefined,
): ClinicHoursSchemaNode[] {
  if (!hours) return [];

  const nodes: ClinicHoursSchemaNode[] = [];
  for (const key of CLINIC_HOURS_DAY_KEYS) {
    const value = hours[key];
    if (value === null || value === 'closed') continue;
    nodes.push({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: [...SCHEMA_DAYS[key]],
      opens: value.open,
      closes: value.close,
    });
  }
  return nodes;
}
