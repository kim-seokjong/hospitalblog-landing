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

/**
 * 자동발행을 켤 값. 고객이 이미 다른 주기를 골랐다면 존중한다.
 *
 * ★ guardAvailable=false(마이그 052 미적용)면 절대 켜지 않는다.
 *   site_auto_publish_since 컬럼이 없으면 cron 의 소급 발행 차단 필터가 통째로
 *   꺼진다(sinceAvailable=false → 필터 없음). 그 상태에서 결제가 cadence 를 'auto'
 *   로 켜면 보관함의 과거 글이 하루 3편씩 순차 공개된다. 코드가 마이그보다 먼저
 *   배포되는 창(운영 마이그는 수동 적용)에서 실제로 발생할 수 있는 경로다.
 *   → 가드 컬럼이 없으면 주소만 만들고 자동발행은 켜지 않는다(마커도 남기지 않아
 *     마이그 적용 후 다음 결제·갱신에서 다시 시도된다).
 */
function resolveCadence(current: string | null, guardAvailable: boolean): 'auto' | null {
  if (!guardAvailable) return null;
  // 'off'(기본값) 또는 미설정일 때만 'auto' 로 켠다.
  // weekly/biweekly 를 고른 고객의 선택을 결제가 덮어쓰면 안 된다.
  if (current === null || current === '' || current === 'off') return 'auto';
  return null;
}

type UpdatePatch = Record<string, unknown>;

/**
 * 슬러그·자동발행 설정을 저장한다. 42703(마커 컬럼 없음)·23514(cadence 'auto'
 * 미허용)는 해당 필드를 빼고 재시도한다. 반환값은 실제 갱신 행 수(0 = 경합).
 *
 * ★ compare-and-set: 읽은 시점의 값(slug · cadence)이 그대로일 때만 쓴다.
 *   결제 경로에는 시간 예산(withProvisionBudget)이 걸려 있어, 예산을 넘긴 뒤에도
 *   이 UPDATE 가 뒤늦게 DB 에 도달할 수 있다. 그 사이 고객이 마이페이지에서
 *   자동발행을 꺼 두었다면 늦게 도착한 쓰기가 그 선택을 되살린다 —
 *   cadence 를 바꾸는 경우 "읽었을 때의 cadence 일 때만" 쓰도록 조건을 건다.
 */
async function applyPatch(
  admin: Admin,
  userId: string,
  patch: UpdatePatch,
  slugGuard: { column: 'site_slug'; expected: string | null },
  cadenceGuard?: { expected: string | null },
): Promise<{ ok: true; rows: number } | { ok: false; error: PostgrestErrorLike }> {
  const MARKER_COLS = ['site_provisioned_at', 'site_auto_publish_since'] as const;

  let payload: UpdatePatch = patch;
  for (let attempt = 0; attempt < 3; attempt++) {
    const query = admin.from('profiles').update(payload).eq('id', userId);
    const slugGuarded =
      slugGuard.expected === null
        ? query.is(slugGuard.column, null)
        : query.eq(slugGuard.column, slugGuard.expected);

    // cadence 를 바꾸지 않는 재시도(위에서 필드가 제거된 경우)에는 조건을 걸지 않는다.
    const guarded =
      cadenceGuard && 'site_publish_cadence' in payload
        ? cadenceGuard.expected === null
          ? slugGuarded.is('site_publish_cadence', null)
          : slugGuarded.eq('site_publish_cadence', cadenceGuard.expected)
        : slugGuarded;

    const { data, error } = await guarded.select('id');
    if (!error) return { ok: true, rows: data?.length ?? 0 };

    if (isMissingColumn(error) && MARKER_COLS.some((col) => col in payload)) {
      const next: UpdatePatch = { ...payload };
      for (const col of MARKER_COLS) delete next[col];
      // ★ 가드 컬럼(site_auto_publish_since)을 저장할 수 없으면 자동발행도 켜지 않는다.
      //   켜 두면 cron 의 소급 차단 필터가 없는 채로 과거 글이 공개된다.
      //   (resolveCadence 가 이미 막지만, 스키마 캐시 지연 등으로 여기까지 오는
      //    경우를 위한 2차 방어다.)
      delete next.site_publish_cadence;
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
    const cadence = resolveCadence(row.site_publish_cadence, markerAvailable);

    // ② 주소가 이미 있으면 그대로 두고 자동발행만 켠다.
    if (row.site_slug) {
      const patch: UpdatePatch = { updated_at: nowIso, site_provisioned_at: nowIso };
      if (cadence) {
        patch.site_publish_cadence = cadence;
        // ★ 소급 발행 차단 기준 시각은 "지금 켜는 순간"으로 항상 새로 찍는다.
        //   과거에 auto 를 켰다 껐던 회원은 오래된 값이 남아 있는데, 그 값을 그대로
        //   두면 껐던 기간에 쌓인 글이 전부 자동발행 대상이 된다(대량 소급 공개).
        //   resolveCadence 가 off/미설정에서만 'auto' 를 돌려주므로 여기는 항상
        //   "새로 켜는" 전환 시점이고, nowIso 는 기존 값보다 항상 미래다(앞당기지 않는다).
        patch.site_auto_publish_since = nowIso;
      }
      const applied = await applyPatch(
        admin,
        userId,
        patch,
        { column: 'site_slug', expected: row.site_slug },
        { expected: row.site_publish_cadence },
      );
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
        // 위 ②와 같은 이유 — 켜는 순간을 항상 새로 찍는다(과거 값 재사용 금지).
        patch.site_auto_publish_since = nowIso;
      }

      const applied = await applyPatch(
        admin,
        userId,
        patch,
        { column: 'site_slug', expected: null },
        { expected: row.site_publish_cadence },
      );

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
