/**
 * 유료 결제 시점의 병원 블로그 자동 개설 (서버 전용 · service role).
 *
 * 왜 "결제 시점"인가:
 *  - 가입 시점에 만들면 무료 2편만 쓰고 이탈하는 계정의 빈 블로그가 사이트맵에
 *    쌓인다. 빈 서브도메인이 늘어나면 색인 품질(그리고 도메인 전체 평판)이 떨어진다.
 *  - 결제 완료는 "이 병원은 실제로 운영된다"는 가장 강한 신호이고, 그때 만들면
 *    첫 글이 곧바로 이어진다.
 *
 * 실행 규약:
 *  - 절대 throw 하지 않는다. 결제 응답을 이 작업이 망가뜨리면 안 된다.
 *  - 회원당 최대 1회만 동작한다(site_provisioned_at 마커). 갱신 결제마다 다시
 *    돌면 고객이 꺼둔 자동발행을 매달 되살리게 된다.
 *  - 이미 site_slug 가 있으면 절대 덮어쓰지 않는다(고객이 직접 정한 주소 존중).
 *  - hospital_name 이 비면 슬러그를 만들지 않는다 — getClinicBySlug 가 병원명 없는
 *    행을 404 로 처리하므로 죽은 주소가 생긴다. 이 경우 마커도 남기지 않아
 *    다음 결제(갱신)나 병원명 입력 후 재시도가 가능하다.
 *
 * 마이그 052 미적용 환경에서도 죽지 않는다:
 *  - 마커 컬럼이 없으면(42703) "site_slug 가 비어 있을 때만" 1회 동작하는
 *    폴백으로 축소된다(그 자체가 멱등 조건).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { RESERVED_SLUGS, validateSlug } from './slug';
import { buildSlugCandidates } from './romanize';

type Admin = SupabaseClient;

interface PostgrestErrorLike {
  code?: string;
  message?: string;
}

/** 컬럼 없음 — 마이그레이션 미적용. */
function isMissingColumn(error: PostgrestErrorLike | null): boolean {
  return error?.code === '42703';
}

/** unique 위반 — 슬러그 중복. */
function isUniqueViolation(error: PostgrestErrorLike | null): boolean {
  return error?.code === '23505';
}

/** check 제약 위반 — 마이그 048(cadence 'auto') 미적용 등. */
function isCheckViolation(error: PostgrestErrorLike | null): boolean {
  return error?.code === '23514';
}

export type ProvisionOutcome =
  /** 이미 처리된 회원 — 아무것도 하지 않았다. */
  | { status: 'skipped'; reason: 'already_provisioned' | 'profile_missing' }
  /** 병원명이 없어 주소를 만들지 못했다(마커도 남기지 않음 → 다음 기회에 재시도). */
  | { status: 'skipped'; reason: 'no_hospital_name' }
  /** 슬러그 후보가 모두 충돌·형식 위반 — 고객이 직접 정하게 둔다. */
  | { status: 'skipped'; reason: 'slug_unavailable' }
  /** 새 주소를 만들고 자동발행을 켰다. */
  | { status: 'provisioned'; slug: string; created: boolean; cadence: string }
  /** DB 오류 — 결제는 정상, 개설만 실패(다음 결제/갱신에 재시도). */
  | { status: 'failed'; reason: string };

interface ProfileRow {
  site_slug: string | null;
  site_publish_cadence: string | null;
  hospital_name: string | null;
  site_provisioned_at?: string | null;
  site_auto_publish_since?: string | null;
}

const PROFILE_COLS_FULL =
  'site_slug, site_publish_cadence, hospital_name, site_provisioned_at, site_auto_publish_since';
const PROFILE_COLS_LEGACY = 'site_slug, site_publish_cadence, hospital_name';

interface LoadedProfile {
  row: ProfileRow;
  /** 마이그 052(마커 컬럼) 적용 여부. */
  markerAvailable: boolean;
}

async function loadProfile(admin: Admin, userId: string): Promise<LoadedProfile | null> {
  const full = await admin
    .from('profiles')
    .select(PROFILE_COLS_FULL)
    .eq('id', userId)
    .maybeSingle<ProfileRow>();

  if (!isMissingColumn(full.error)) {
    if (full.error || !full.data) return null;
    return { row: full.data, markerAvailable: true };
  }

  const legacy = await admin
    .from('profiles')
    .select(PROFILE_COLS_LEGACY)
    .eq('id', userId)
    .maybeSingle<ProfileRow>();

  if (legacy.error || !legacy.data) return null;
  return { row: legacy.data, markerAvailable: false };
}

/** 자동발행을 켤 값. 고객이 이미 다른 주기를 골랐다면 존중한다. */
function resolveCadence(current: string | null): 'auto' | null {
  // 'off'(기본값) 또는 미설정일 때만 'auto' 로 켠다.
  // weekly/biweekly 를 고른 고객의 선택을 결제가 덮어쓰면 안 된다.
  if (current === null || current === '' || current === 'off') return 'auto';
  return null;
}

type UpdatePatch = Record<string, unknown>;

/**
 * 슬러그·자동발행 설정을 저장한다. 42703(마커 컬럼 없음)·23514(cadence 'auto'
 * 미허용)는 해당 필드를 빼고 재시도한다. 반환값은 실제 갱신 행 수(0 = 경합).
 */
async function applyPatch(
  admin: Admin,
  userId: string,
  patch: UpdatePatch,
  slugGuard: { column: 'site_slug'; expected: string | null },
): Promise<{ ok: true; rows: number } | { ok: false; error: PostgrestErrorLike }> {
  const MARKER_COLS = ['site_provisioned_at', 'site_auto_publish_since'] as const;

  let payload: UpdatePatch = patch;
  for (let attempt = 0; attempt < 3; attempt++) {
    const query = admin.from('profiles').update(payload).eq('id', userId);
    const guarded =
      slugGuard.expected === null
        ? query.is(slugGuard.column, null)
        : query.eq(slugGuard.column, slugGuard.expected);

    const { data, error } = await guarded.select('id');
    if (!error) return { ok: true, rows: data?.length ?? 0 };

    if (isMissingColumn(error) && MARKER_COLS.some((col) => col in payload)) {
      const next: UpdatePatch = { ...payload };
      for (const col of MARKER_COLS) delete next[col];
      payload = next;
      continue;
    }
    if (isCheckViolation(error) && 'site_publish_cadence' in payload) {
      const next: UpdatePatch = { ...payload };
      delete next.site_publish_cadence;
      payload = next;
      continue;
    }
    return { ok: false, error };
  }

  return { ok: false, error: { message: '프로필 저장 재시도 한도 초과' } };
}

/**
 * 결제 완료 회원의 병원 블로그를 개설한다(멱등).
 * 어떤 경우에도 예외를 던지지 않는다 — 결과는 반환값으로만 알린다.
 */
export async function provisionClinicSite(
  admin: Admin,
  userId: string,
): Promise<ProvisionOutcome> {
  try {
    const loaded = await loadProfile(admin, userId);
    if (!loaded) return { status: 'skipped', reason: 'profile_missing' };

    const { row, markerAvailable } = loaded;

    // ① 이미 처리한 회원인가.
    if (markerAvailable) {
      if (row.site_provisioned_at) return { status: 'skipped', reason: 'already_provisioned' };
    } else if (row.site_slug) {
      // 마커 컬럼이 없는 환경의 멱등 조건 — 주소가 이미 있으면 손대지 않는다.
      return { status: 'skipped', reason: 'already_provisioned' };
    }

    const nowIso = new Date().toISOString();
    const cadence = resolveCadence(row.site_publish_cadence);

    // ② 주소가 이미 있으면 그대로 두고 자동발행만 켠다.
    if (row.site_slug) {
      const patch: UpdatePatch = { updated_at: nowIso, site_provisioned_at: nowIso };
      if (cadence) {
        patch.site_publish_cadence = cadence;
        // 소급 발행 차단 기준 시각 — 이미 값이 있으면 앞당기지 않는다.
        if (!row.site_auto_publish_since) patch.site_auto_publish_since = nowIso;
      }
      const applied = await applyPatch(admin, userId, patch, {
        column: 'site_slug',
        expected: row.site_slug,
      });
      if (!applied.ok) {
        return { status: 'failed', reason: applied.error.message ?? '프로필 저장 실패' };
      }
      return {
        status: 'provisioned',
        slug: row.site_slug,
        created: false,
        cadence: cadence ?? row.site_publish_cadence ?? 'off',
      };
    }

    // ③ 병원명이 없으면 주소를 만들지 않는다(죽은 주소 방지). 마커도 남기지 않는다.
    const hospitalName = (row.hospital_name ?? '').trim();
    if (hospitalName === '') {
      console.error('[clinic-site/provision] 병원명이 비어 블로그 주소를 만들지 못했습니다:', userId);
      return { status: 'skipped', reason: 'no_hospital_name' };
    }

    // ④ 후보를 순서대로 저장 시도 — unique 충돌이면 다음 후보로.
    const candidates = buildSlugCandidates(hospitalName, {
      isReserved: (slug) => RESERVED_SLUGS.has(slug),
    }).filter((slug) => validateSlug(slug).ok);

    if (candidates.length === 0) {
      console.error(
        '[clinic-site/provision] 병원명에서 유효한 주소 후보를 만들지 못했습니다:',
        userId,
      );
      return { status: 'skipped', reason: 'slug_unavailable' };
    }

    for (const slug of candidates) {
      const patch: UpdatePatch = {
        site_slug: slug,
        updated_at: nowIso,
        site_provisioned_at: nowIso,
      };
      if (cadence) {
        patch.site_publish_cadence = cadence;
        if (!row.site_auto_publish_since) patch.site_auto_publish_since = nowIso;
      }

      const applied = await applyPatch(admin, userId, patch, {
        column: 'site_slug',
        expected: null,
      });

      if (applied.ok) {
        if (applied.rows === 0) {
          // 그 사이 다른 요청이 주소를 정했다 — 덮어쓰지 않고 끝낸다.
          return { status: 'skipped', reason: 'already_provisioned' };
        }
        return {
          status: 'provisioned',
          slug,
          created: true,
          cadence: cadence ?? row.site_publish_cadence ?? 'off',
        };
      }

      if (isUniqueViolation(applied.error)) continue; // 다음 후보
      return { status: 'failed', reason: applied.error.message ?? '프로필 저장 실패' };
    }

    // 후보를 모두 소진했다 — 고객이 마이페이지에서 직접 정하게 둔다(마커 미기록).
    console.error(
      '[clinic-site/provision] 주소 후보가 모두 중복이라 개설하지 못했습니다:',
      userId,
      hospitalName,
    );
    return { status: 'skipped', reason: 'slug_unavailable' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : '블로그 개설 중 알 수 없는 오류';
    console.error('[clinic-site/provision] 예외:', userId, reason);
    return { status: 'failed', reason };
  }
}
