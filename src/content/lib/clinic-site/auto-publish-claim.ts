/**
 * 자동발행 원자적 선점 (서버 전용).
 *
 * ★ 주기별로 경로가 완전히 다르다 — 섞으면 안 된다.
 *
 *  auto: "하루 N편" 이 유일한 상한이라 집계와 선점이 한 트랜잭션이어야 한다.
 *        (별도 요청이면 두 실행이 같은 카운트를 읽고 서로 다른 글을 선점해 상한을 넘긴다.
 *         published_to_site=false 조건은 "같은 글"의 이중 선점만 막는다.)
 *        → 마이그 050 의 claim_auto_publish_posts (advisory lock + 단일 트랜잭션).
 *
 *  weekly/biweekly: 간격은 claim_auto_publish_cycle(주기 실행권 선점)이 이미 보장한다.
 *        ⚠️ 여기에 "오늘 몇 편 나갔나" 집계를 걸면 회원이 그날 마이페이지에서 수동
 *        발행했을 때 cron 이 0편을 내고 주기가 밀린다 — 원래 없던 동작이다.
 *        → 일일 집계 없이 조건부 UPDATE 한 방으로 글만 원자적으로 선점한다.
 *          (단일 문장 UPDATE 는 그 자체로 원자적이라 RPC 가 필요 없다.)
 *
 * 마이그 미적용 환경에서도 죽지 않는다: RPC 가 없으면 앱 레벨 경로로 폴백하고
 * (원자성은 약해지지만 순차 실행에서는 동일하게 동작), 폴백을 썼다는 사실을 반환한다.
 * ★ 폴백 경로도 위의 주기별 구분을 똑같이 지켜야 한다.
 */

import type { createAdminClient } from '@/dev/lib/supabase/server';
import {
  maxPostsPerRun,
  needsDailyQuotaCheck,
  remainingDailyQuota,
  type SitePublishCadence,
} from './auto-publish';

type Admin = ReturnType<typeof createAdminClient>;

interface PostgrestErrorLike {
  code?: string;
  message?: string;
}

/** RPC/테이블이 아직 없는 환경인지 (마이그 050 미적용). */
function isMissingRoutine(error: PostgrestErrorLike | null): boolean {
  if (!error) return false;
  // 42883 undefined_function, 42P01 undefined_table,
  // PGRST202 = PostgREST 스키마 캐시에 함수 없음
  if (error.code === '42883' || error.code === '42P01') return true;
  if (typeof error.code === 'string' && error.code.startsWith('PGRST2')) return true;
  return typeof error.message === 'string' && error.message.includes('Could not find the function');
}

export type ClaimPostsResult =
  | { ok: true; claimedIds: string[]; atomic: boolean }
  | { ok: false; reason: string };

interface ClaimPostsInput {
  userId: string;
  /** ★ 경로 분기의 유일한 기준. 일일 상한 여부·값은 이 모듈이 여기서 파생한다. */
  cadence: SitePublishCadence;
  /** KST 오늘 00:00 (ISO) — auto 경로의 일일 집계 경계 (다른 주기에서는 쓰이지 않는다) */
  dayStartIso: string;
  /** 검수 게이트를 통과한 후보 id (오래된 순) */
  candidateIds: readonly string[];
  /** 이번 실행에서 이 회원에게 허용할 최대 편수 (전체 상한 반영 후) */
  limit: number;
  // ⚠️ dailyCap 을 호출부에서 받지 않는다.
  //    예전에 라우트가 주기와 무관하게 dailyCap 을 넘기는 바람에 weekly/biweekly 까지
  //    일일 집계·차감을 당했다(그날 수동 발행하면 cron 이 밀리는 회귀).
  //    상한 값은 maxPostsPerRun(cadence) 로 이 모듈 안에서만 만든다.
}

/**
 * 글을 선점한다. 반환된 id 만 "실제로 발행된 글"이다.
 * 후보를 limit 개로 먼저 잘라 넘기므로 전체 실행 상한도 함께 지켜진다.
 *
 * ★ 주기에 따라 경로가 갈린다 — needsDailyQuotaCheck 가 유일한 분기점이다.
 *   auto 만 일일 집계·차감을 하고, weekly/biweekly 는 집계 없이 글만 선점한다.
 */
export async function claimPostsForPublish(
  admin: Admin,
  input: ClaimPostsInput,
): Promise<ClaimPostsResult> {
  const ids = input.candidateIds.slice(0, Math.max(0, input.limit));
  if (ids.length === 0) return { ok: true, claimedIds: [], atomic: true };

  // weekly/biweekly — 간격은 주기 선점(claim_auto_publish_cycle)이 보장하므로
  // 일일 집계를 하지 않는다. 하면 "그날 수동 발행한 회원"의 cron 이 밀린다.
  if (!needsDailyQuotaCheck(input.cadence)) {
    return claimWithoutDailyCap(admin, input.userId, ids);
  }

  return claimWithDailyCap(admin, input, ids);
}

/**
 * 일일 집계 없이 조건부 UPDATE 로 글만 선점한다 (weekly/biweekly).
 * 단일 문장 UPDATE 라 그 자체로 원자적이다 — 같은 글의 이중 선점은 0행 반환으로 걸러진다.
 */
async function claimWithoutDailyCap(
  admin: Admin,
  userId: string,
  ids: readonly string[],
): Promise<ClaimPostsResult> {
  const claimedIds: string[] = [];

  for (const id of ids) {
    const { data: claimed, error } = await admin
      .from('saved_posts')
      .update({ published_to_site: true, site_published_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('published_to_site', false)
      .select('id');

    if (error) return { ok: false, reason: error.message };
    if (claimed && claimed.length > 0) claimedIds.push(id);
  }

  return { ok: true, claimedIds, atomic: true };
}

/** auto 전용 — 일일 상한을 원자적으로 강제하며 선점한다. */
async function claimWithDailyCap(
  admin: Admin,
  input: ClaimPostsInput,
  ids: readonly string[],
): Promise<ClaimPostsResult> {
  const { data, error } = await admin.rpc('claim_auto_publish_posts', {
    p_user_id: input.userId,
    // 하루 상한은 RPC 가 강제한다. 이번 실행 허용치(limit)는 위에서 후보를 잘라 반영했다.
    // 값은 주기에서 파생한다 — 호출부가 임의로 정할 수 없다.
    p_daily_cap: maxPostsPerRun(input.cadence),
    p_day_start: input.dayStartIso,
    p_post_ids: ids,
  });

  if (error) {
    if (!isMissingRoutine(error)) return { ok: false, reason: error.message };
    return legacyClaimWithDailyCap(admin, input, ids);
  }

  const rows = (data ?? []) as Array<{ claimed_id?: string }>;
  return {
    ok: true,
    claimedIds: rows
      .map((row) => row.claimed_id)
      .filter((id): id is string => typeof id === 'string'),
    atomic: true,
  };
}

/**
 * 마이그 050 미적용 폴백 (auto 전용) — 집계 후 조건부 update 로 한 편씩 선점한다.
 * 같은 글의 이중 선점은 막지만 일일 총량 경쟁은 완전히는 못 막는다(순차 실행 기준 정확).
 * ⚠️ weekly/biweekly 는 이 경로에 절대 오면 안 된다(claimPostsForPublish 가 분기).
 */
async function legacyClaimWithDailyCap(
  admin: Admin,
  input: ClaimPostsInput,
  ids: readonly string[],
): Promise<ClaimPostsResult> {
  const { count, error } = await admin
    .from('saved_posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', input.userId)
    .eq('published_to_site', true)
    .gte('site_published_at', input.dayStartIso);

  if (error || typeof count !== 'number') {
    return { ok: false, reason: '오늘 발행 수 조회 실패' };
  }

  const quota = Math.min(remainingDailyQuota(input.cadence, count), ids.length);
  const claimedIds: string[] = [];

  for (const id of ids.slice(0, quota)) {
    const { data: claimed, error: updateErr } = await admin
      .from('saved_posts')
      .update({ published_to_site: true, site_published_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', input.userId)
      .eq('published_to_site', false)
      .select('id');

    if (updateErr) return { ok: false, reason: updateErr.message };
    if (claimed && claimed.length > 0) claimedIds.push(id);
  }

  return { ok: true, claimedIds, atomic: false };
}

export type CycleClaimResult =
  | { ok: true; claimed: false }
  | {
      ok: true;
      claimed: true;
      previousLastRun: string | null;
      /** 이번 선점이 찍은 last_run — 되돌릴 때 compare-and-set 조건으로 쓴다. */
      claimedAt: string | null;
      atomic: boolean;
    }
  | { ok: false; reason: string };

/**
 * weekly/biweekly 의 "이번 주기 실행권"을 원자적으로 선점한다.
 * claimed=false 면 다른 실행이 이미 가져간 것이므로 이 회원은 건너뛴다.
 *
 * ⚠️ 발행 후보가 있는지 확인한 "뒤에" 호출해야 한다. 후보가 없는데 선점하면
 *    발행 없이 주기만 소진돼 "대상이 생기는 즉시 발행" 규칙이 깨진다.
 */
export async function claimAutoPublishCycle(
  admin: Admin,
  userId: string,
  thresholdIso: string,
): Promise<CycleClaimResult> {
  const { data, error } = await admin.rpc('claim_auto_publish_cycle', {
    p_user_id: userId,
    p_threshold: thresholdIso,
  });

  if (error) {
    if (!isMissingRoutine(error)) return { ok: false, reason: error.message };
    // 마이그 미적용 폴백 — 기존 동작(앱 isDue 판정)을 그대로 유지한다.
    // claimedAt 이 없으므로 되돌리기도 하지 않는다(무엇을 찍었는지 모르는 값을
    // 덮어쓰면 남의 갱신을 과거로 밀 수 있다).
    return { ok: true, claimed: true, previousLastRun: null, claimedAt: null, atomic: false };
  }

  const rows = (data ?? []) as Array<{ previous_last_run?: string | null; claimed_at?: string | null }>;
  if (rows.length === 0) return { ok: true, claimed: false };
  return {
    ok: true,
    claimed: true,
    previousLastRun: rows[0]?.previous_last_run ?? null,
    claimedAt: rows[0]?.claimed_at ?? null,
    atomic: true,
  };
}

/**
 * 주기를 선점했지만 결국 한 편도 발행하지 못했을 때 되돌린다.
 * 되돌리지 않으면 회원이 이유 없이 한 주기를 통째로 잃는다.
 *
 * ★ compare-and-set: "내가 찍은 값(claimedAt)일 때만" 되돌린다.
 *   조건이 없으면, 이 실행이 지연·재시도되는 사이 다른 실행이 갱신한 더 최신
 *   last_run 을 과거로 되돌려 그 회원이 즉시 due 가 되고 주기가 중복 발행된다.
 */
export async function restoreAutoPublishCycle(
  admin: Admin,
  userId: string,
  previousLastRun: string | null,
  claimedAt: string | null,
): Promise<void> {
  if (!claimedAt) {
    // 내가 찍은 값을 모르면 건드리지 않는다(남의 갱신을 덮어쓰는 것보다 안전).
    console.error('[auto-publish] 주기 되돌리기 생략: 선점 시각 미상', userId);
    return;
  }

  try {
    const { data, error } = await admin
      .from('profiles')
      .update({ site_publish_last_run: previousLastRun })
      .eq('id', userId)
      .eq('site_publish_last_run', claimedAt)
      .select('id');

    if (error) {
      console.error('[auto-publish] 주기 되돌리기 실패:', error.message);
      return;
    }
    if (!data || data.length === 0) {
      // 다른 실행이 그 사이 갱신했다 → 그대로 둔다(더 최신 값을 과거로 밀지 않는다).
      console.error('[auto-publish] 주기 되돌리기 생략: 다른 실행이 갱신함', userId);
    }
  } catch (err) {
    console.error('[auto-publish] 주기 되돌리기 예외:', err instanceof Error ? err.message : err);
  }
}

/** 순회 커서 테이블 이름 (마이그 050). */
const CURSOR_TABLE = 'clinic_auto_publish_state';

/**
 * 마지막으로 검사한 회원 id. 테이블이 없으면(마이그 미적용) undefined 를 돌려
 * 호출부가 날짜 기반 회전으로 폴백하게 한다(null 은 "커서 없음 = 처음부터").
 */
export async function readAutoPublishCursor(admin: Admin): Promise<string | null | undefined> {
  try {
    const { data, error } = await admin
      .from(CURSOR_TABLE)
      .select('last_profile_id')
      .eq('id', true)
      .maybeSingle<{ last_profile_id: string | null }>();

    if (error) return undefined;
    return data?.last_profile_id ?? null;
  } catch {
    return undefined;
  }
}

export type CursorWriteResult = { ok: true } | { ok: false; reason: string };

/**
 * 다음 실행이 이어받을 위치를 남긴다.
 *
 * ★ 조용히 실패하면 안 된다. 쓰기만 계속 실패하면 매 실행이 같은 지점에서 시작해
 *   뒤쪽 회원이 다시 영구 기아에 빠지는데, 겉으로는 정상처럼 보인다.
 *   Supabase 는 쿼리 오류를 throw 하지 않고 { error } 로 돌려주므로 반드시 검사하고,
 *   변경된 행이 실제로 있는지까지 확인한다.
 *   singleton 행이 삭제된 경우까지 자동 복구되도록 update 가 아니라 upsert 를 쓴다.
 */
export async function writeAutoPublishCursor(
  admin: Admin,
  lastProfileId: string,
): Promise<CursorWriteResult> {
  try {
    const { data, error } = await admin
      .from(CURSOR_TABLE)
      .upsert(
        { id: true, last_profile_id: lastProfileId, updated_at: new Date().toISOString() },
        { onConflict: 'id' },
      )
      .select('id');

    if (error) {
      console.error('[auto-publish] 커서 저장 실패:', error.message);
      return { ok: false, reason: error.message };
    }
    if (!data || data.length === 0) {
      console.error('[auto-publish] 커서 저장 실패: 갱신된 행 없음');
      return { ok: false, reason: '커서 행이 갱신되지 않았습니다' };
    }
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : '커서 저장 중 알 수 없는 오류';
    console.error('[auto-publish] 커서 저장 예외:', reason);
    return { ok: false, reason };
  }
}
