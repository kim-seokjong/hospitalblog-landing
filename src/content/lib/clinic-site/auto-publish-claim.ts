/**
 * 자동발행 원자적 선점 (서버 전용).
 *
 * 왜 DB 함수인가 (Codex 교차검증 지적):
 *  - "오늘 몇 편 발행됐나" 집계와 실제 선점 update 가 별도 요청이면, 두 실행이
 *    같은 카운트를 읽고 서로 다른 글을 선점해 하루 상한을 넘길 수 있다.
 *    published_to_site=false 조건은 "같은 글"의 이중 선점만 막는다.
 *  - weekly/biweekly 의 isDue 도 앱 판정이라 동시 실행 시 각각 1편씩 나간다.
 *  → 마이그 050 의 RPC 가 advisory lock + 단일 트랜잭션으로 두 경쟁을 모두 없앤다.
 *
 * 마이그 미적용 환경에서도 죽지 않는다: RPC 가 없으면 기존 앱 레벨 경로로 폴백하고
 * (원자성은 약해지지만 순차 실행에서는 동일하게 동작), 폴백을 썼다는 사실을 반환한다.
 */

import type { createAdminClient } from '@/dev/lib/supabase/server';
import { remainingDailyQuota, type SitePublishCadence } from './auto-publish';

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
  cadence: SitePublishCadence;
  /** KST 오늘 00:00 (ISO) — 일일 집계 경계 */
  dayStartIso: string;
  /** 검수 게이트를 통과한 후보 id (오래된 순) */
  candidateIds: readonly string[];
  /** 이번 실행에서 이 회원에게 허용할 최대 편수 (전체 상한 반영 후) */
  limit: number;
  /** 주기별 하루 상한 */
  dailyCap: number;
}

/**
 * 일일 상한을 강제하며 글을 선점한다. 반환된 id 만 "실제로 발행된 글"이다.
 * 후보를 limit 개로 먼저 잘라 넘기므로 전체 실행 상한도 함께 지켜진다.
 */
export async function claimAutoPublishPosts(
  admin: Admin,
  input: ClaimPostsInput,
): Promise<ClaimPostsResult> {
  const ids = input.candidateIds.slice(0, Math.max(0, input.limit));
  if (ids.length === 0) return { ok: true, claimedIds: [], atomic: true };

  const { data, error } = await admin.rpc('claim_auto_publish_posts', {
    p_user_id: input.userId,
    // 하루 상한은 RPC 가 강제한다. 이번 실행 허용치(limit)는 위에서 후보를 잘라 반영했다.
    p_daily_cap: input.dailyCap,
    p_day_start: input.dayStartIso,
    p_post_ids: ids,
  });

  if (error) {
    if (!isMissingRoutine(error)) return { ok: false, reason: error.message };
    return legacyClaimPosts(admin, input, ids);
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
 * 마이그 050 미적용 폴백 — 집계 후 조건부 update 로 한 편씩 선점한다.
 * 같은 글의 이중 선점은 막지만 일일 총량 경쟁은 완전히는 못 막는다(순차 실행 기준 정확).
 */
async function legacyClaimPosts(
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
  | { ok: true; claimed: true; previousLastRun: string | null; atomic: boolean }
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
    return { ok: true, claimed: true, previousLastRun: null, atomic: false };
  }

  const rows = (data ?? []) as Array<{ previous_last_run?: string | null }>;
  if (rows.length === 0) return { ok: true, claimed: false };
  return { ok: true, claimed: true, previousLastRun: rows[0]?.previous_last_run ?? null, atomic: true };
}

/**
 * 주기를 선점했지만 결국 한 편도 발행하지 못했을 때 되돌린다.
 * 되돌리지 않으면 회원이 이유 없이 한 주기를 통째로 잃는다.
 */
export async function restoreAutoPublishCycle(
  admin: Admin,
  userId: string,
  previousLastRun: string | null,
): Promise<void> {
  try {
    await admin
      .from('profiles')
      .update({ site_publish_last_run: previousLastRun })
      .eq('id', userId);
  } catch (err) {
    console.error('[auto-publish] 주기 되돌리기 실패:', err instanceof Error ? err.message : err);
  }
}

/** 순회 커서 테이블 이름 (마이그 050). */
const CURSOR_TABLE = 'clinic_auto_publish_state';

/**
 * 마지막으로 검사한 회원 id. 테이블이 없으면(마이그 미적용) undefined 를 돌려
 * 호출부가 날짜 기반 회전으로 폴백하게 한다(null 은 "커서 없음 = 처음부터").
 */
export async function readAutoPublishCursor(admin: Admin): Promise<string | null | undefined> {
  const { data, error } = await admin
    .from(CURSOR_TABLE)
    .select('last_profile_id')
    .eq('id', true)
    .maybeSingle<{ last_profile_id: string | null }>();

  if (error) return undefined;
  return data?.last_profile_id ?? null;
}

/** 다음 실행이 이어받을 위치를 남긴다. 실패해도 발행 자체에는 영향이 없다. */
export async function writeAutoPublishCursor(admin: Admin, lastProfileId: string): Promise<void> {
  try {
    await admin
      .from(CURSOR_TABLE)
      .update({ last_profile_id: lastProfileId, updated_at: new Date().toISOString() })
      .eq('id', true);
  } catch (err) {
    console.error('[auto-publish] 커서 저장 실패:', err instanceof Error ? err.message : err);
  }
}
