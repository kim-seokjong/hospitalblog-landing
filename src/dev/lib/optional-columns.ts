/**
 * 아직 마이그레이션이 적용되지 않았을 수 있는 컬럼에 **안전하게** 쓰기.
 *
 * ★ 왜 필요한가.
 *   이 저장소의 마이그레이션은 자동 적용이 아니라 **대표가 Supabase SQL Editor 에서
 *   수동 실행**한다([[project_doctorpost_supabase_migration_manual]]). 그런데 배포는
 *   푸시하면 자동으로 나간다. 즉 **코드가 컬럼보다 먼저 도착하는 구간이 반드시 생긴다.**
 *   그 구간에서 새 컬럼에 쓰면 전부 실패하고, 기능이 통째로 죽는다.
 *
 *   그래서 새 컬럼은 "있으면 쓰고 없으면 뺀다". 마이그레이션 적용 전에는 예전과
 *   똑같이 동작하고, 적용된 순간부터 새 컬럼이 채워진다 — 배포 순서를 신경 쓸 필요가 없다.
 *
 * ⚠️ 이건 **부가 정보**에만 쓴다. 없으면 기능이 성립하지 않는 컬럼에는 쓰지 마라 —
 *    조용히 반쪽으로 동작하는 것이 대놓고 실패하는 것보다 나쁘다.
 */

/** PostgreSQL: 정의되지 않은 컬럼. */
export const UNDEFINED_COLUMN = '42703'
/** PostgreSQL: 정의되지 않은 테이블. */
export const UNDEFINED_TABLE = '42P01'

export interface PostgrestLikeError {
  readonly code?: string
  readonly message?: string
}

export function isUndefinedColumn(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false
  if (error.code === UNDEFINED_COLUMN) return true
  // PostgREST 는 스키마 캐시 기준으로 먼저 거르며, 이때 코드가 PGRST204 로 온다.
  if (error.code === 'PGRST204') return true
  return /column .* does not exist|Could not find the '.*' column/i.test(error.message ?? '')
}

/**
 * 테이블이 아직 없다.
 *
 * ⚠️ `42P01`(Postgres) 만 보면 놓친다 — PostgREST 는 **스키마 캐시**에서 먼저 걸러
 *    `PGRST205` 를 돌려준다(2026-08-03 지적). 이걸 놓치면 "테이블 없음" 이
 *    "알 수 없는 오류" 로 분류돼, 폴백해야 할 자리에서 기능이 통째로 막힌다.
 */
export function isUndefinedTable(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false
  if (error.code === UNDEFINED_TABLE) return true
  if (error.code === 'PGRST205') return true
  return /relation .* does not exist|Could not find the table/i.test(error.message ?? '')
}

/**
 * `extra` 컬럼을 포함해 실행하고, 그 컬럼이 없다는 오류면 **빼고 한 번 더** 실행한다.
 *
 * @returns 실행 결과 + 새 컬럼이 실제로 반영됐는지 여부
 */
export async function runWithOptionalColumns(
  base: Record<string, unknown>,
  extra: Record<string, unknown>,
  run: (row: Record<string, unknown>) => PromiseLike<{ error: PostgrestLikeError | null }>,
): Promise<{ error: PostgrestLikeError | null; extraApplied: boolean }> {
  const first = await run({ ...base, ...extra })
  if (!first.error) return { error: null, extraApplied: true }
  if (!isUndefinedColumn(first.error)) return { error: first.error, extraApplied: false }

  const retry = await run({ ...base })
  return { error: retry.error, extraApplied: false }
}
