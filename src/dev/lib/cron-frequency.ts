/**
 * cron 표현식이 하루에 몇 번 도는지 센다 — Vercel Hobby 플랜 한도 검사용.
 *
 * ★ 왜 필요한가 (2026-07-28).
 *   Vercel **Hobby** 는 cron 을 하루 1회만 허용한다. 하루 2회 이상이 되는 표현은
 *   실행 시점이 아니라 **배포 단계에서 실패**한다("Hobby accounts are limited to
 *   daily cron jobs"). 2026-07-27 에 `0 * * * *` 를 vercel.json 에 넣은 뒤
 *   그때부터 9개 커밋이 전부 배포 실패했고, 아무도 몰랐다 — 로컬 빌드·tsc·테스트가
 *   전부 통과했기 때문이다. 프로덕션만 조용히 멈춰 있었다.
 *   그래서 "사람이 기억해서 지키는 규칙" 대신 테스트로 막는다.
 *
 * 판정은 **보수적**이다: 분·시 필드만 본다. 일·월·요일 필드는 실행 횟수를 줄이기만
 * 하므로(예: `0 1 * * 1` = 주 1회) 무시해도 과소 판정이 나지 않는다.
 * 즉 여기서 1 이 나오면 실제로도 하루 1회 이하다.
 */

/** 표준 5필드 cron 표현식. */
const CRON_FIELD_COUNT = 5;

/**
 * 한 필드가 매칭하는 값의 개수를 센다.
 *
 * 지원 문법: `*`, `n`, `a,b,c`, `a-b`, `~/n`(step), `a-b/n`.
 * 파싱할 수 없는 필드는 **범위 전체**로 간주한다 — 모르는 문법을 "안전하다"고
 * 통과시키지 않기 위해서다(과대 판정은 배포를 막지 않지만, 과소 판정은 막는다).
 */
export function countFieldValues(field: string, min: number, max: number): number {
  const span = max - min + 1;
  const trimmed = field.trim();
  if (trimmed === '') return span;

  let total = 0;
  for (const part of trimmed.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart === undefined ? 1 : Number.parseInt(stepPart, 10);
    if (!Number.isInteger(step) || step < 1) return span; // 해석 불가 → 최대치

    let count: number;
    if (rangePart === '*') {
      count = span;
    } else if (rangePart.includes('-')) {
      const [rawStart, rawEnd] = rangePart.split('-');
      const start = Number.parseInt(rawStart, 10);
      const end = Number.parseInt(rawEnd, 10);
      if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return span;
      count = end - start + 1;
    } else {
      const single = Number.parseInt(rangePart, 10);
      if (!Number.isInteger(single)) return span;
      count = 1;
    }

    total += Math.ceil(count / step);
  }

  return total > 0 ? total : span;
}

/**
 * 하루 최대 실행 횟수. 필드 수가 5개가 아니면 해석을 포기하고 Infinity 를 돌려준다
 * (검사에서 반드시 걸리게 — 잘못된 표현식이 조용히 통과하는 쪽이 더 위험하다).
 */
export function runsPerDay(expression: string): number {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== CRON_FIELD_COUNT) return Number.POSITIVE_INFINITY;

  const [minute, hour] = fields;
  return countFieldValues(minute, 0, 59) * countFieldValues(hour, 0, 23);
}

/** Vercel Hobby 플랜에 올릴 수 있는 표현식인가 (하루 1회 이하). */
export function isHobbySafeCron(expression: string): boolean {
  return runsPerDay(expression) <= 1;
}
