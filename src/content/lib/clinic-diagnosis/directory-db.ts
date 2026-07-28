import { createAdminClient } from '@/dev/lib/supabase/server';
import {
  isDirectoryMngNo,
  toDirectoryCandidate,
  type DirectoryProbe,
  type DirectoryProbeResult,
  type DirectoryQuery,
  type DirectoryRow,
  type DirectorySearch,
  type DirectorySearchResult,
} from './directory';
import type { ClinicCandidate } from './types';

/**
 * 폴백 명부(clinic_directory)의 Supabase 어댑터.
 *
 * 로직은 전부 directory.ts(순수 모듈)에 있고 여기에는 **질의만** 있다.
 * 그래야 폴백 판정을 node:test 로 DB 없이 검증할 수 있다.
 *
 * 계약:
 *   · 절대 throw 하지 않는다. 실패는 { ok:false } 로 돌려준다.
 *   · 실패를 "0건"으로 뭉개지 않는다 — 그 혼동이 이번 장애의 본질이었다.
 *   · service role 로만 읽는다(테이블은 RLS 활성·정책 없음).
 */

/** 폴백 조회 타임아웃(ms) — 우리 DB라 짧게 잡는다. 여기서 늘어지면 첫 화면이 멈춘다. */
export const DIRECTORY_TIMEOUT_MS = 4_000;

const SELECT_COLUMNS =
  'mng_no,name,road_address,province,region,institution_type,specialty,subjects,phone,opened_on,source_version';

/** 테이블이 아직 없을 때 Postgres 가 주는 코드 — 마이그레이션 미적용 상황. */
const UNDEFINED_TABLE = '42P01';

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, ms));
}

/**
 * 폴백 명부 검색 어댑터를 만든다.
 * Supabase 설정이 없으면 null — 호출부는 폴백 없이 행안부 판정을 그대로 쓴다.
 */
export function createDirectorySearch(timeoutMs: number = DIRECTORY_TIMEOUT_MS): DirectorySearch | null {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error(
      '[clinic-diagnosis/directory] 폴백 명부 클라이언트 생성 실패:',
      e instanceof Error ? e.message : e,
    );
    return null;
  }

  return async (query: DirectoryQuery): Promise<DirectorySearchResult> => {
    const term = query.term.trim();
    if (term.length < 2) return { ok: true, rows: [], total: 0 };

    try {
      let builder = admin
        .from('clinic_directory')
        .select(SELECT_COLUMNS, { count: 'exact' })
        .ilike('name_norm', `%${term}%`);
      if (query.region) builder = builder.ilike('road_address', `%${query.region}%`);

      const { data, count, error } = await builder
        .limit(Math.max(1, query.limit))
        .abortSignal(timeoutSignal(timeoutMs));

      if (error) {
        const message =
          error.code === UNDEFINED_TABLE
            ? '폴백 명부 테이블이 아직 없습니다(마이그레이션 057 미적용).'
            : error.message;
        console.error('[clinic-diagnosis/directory] 폴백 조회 실패:', message);
        return { ok: false, message };
      }

      const rows = (data ?? []) as unknown as DirectoryRow[];
      return { ok: true, rows, total: typeof count === 'number' ? count : rows.length };
    } catch (e) {
      const message = e instanceof Error ? e.message : '알 수 없는 오류';
      console.error('[clinic-diagnosis/directory] 폴백 조회 예외:', message);
      return { ok: false, message };
    }
  };
}

/**
 * 폴백 명부가 **실제로 보이는가**를 1회 확인한다 (필터 없이 1건).
 *
 * ★ 2026-07-28. 폴백이 죽는 방식이 "오류"가 아니라 "조용한 0건"이었다.
 *   clinic_directory 는 RLS 가 켜져 있고 SELECT 정책이 없다 — service_role 키만
 *   RLS 를 우회해 79,562건을 본다. 프로덕션에 service_role 이 아닌 키가 들어가
 *   있으면 PostgREST 는 **오류 없이 200 + 빈 배열**을 돌려준다. 그래서 서버는
 *   "조회 성공, 결과 없음"으로 받아들이고 화면에 "그런 병원 없음"을 냈다.
 *   조회 실패 판정(ok:false)만으로는 이 상태를 절대 잡을 수 없다.
 *
 * 그래서 "이름으로 못 찾았다"와 "명부 자체가 안 보인다"를 가른다. 후자면 폴백은
 * 근거가 될 수 없으므로 not_found 를 그대로 내보내면 안 된다.
 *
 * 비용: 이름 검색이 전부 0건일 때만 1회 더 doubles. 정상 경로에는 영향이 없다.
 */
export function createDirectoryProbe(
  timeoutMs: number = DIRECTORY_TIMEOUT_MS,
): DirectoryProbe | null {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  return async (): Promise<DirectoryProbeResult> => {
    try {
      /**
       * ⚠️ limit(1) 로 "한 줄이라도 보이나"만 보면 안 된다 (2026-07-28 실패).
       *    권한이 정상인데 **명부가 거의 비어 있는** 상태(적재를 다른 Supabase
       *    프로젝트에 했다든지)를 "정상"으로 오판한다. 실제 건수를 센다.
       *    head:true 라 행을 실어 오지 않고 COUNT 만 받는다.
       */
      const { count, error } = await admin
        .from('clinic_directory')
        .select('mng_no', { count: 'exact', head: true })
        .abortSignal(timeoutSignal(timeoutMs));
      if (error) {
        console.error('[clinic-diagnosis/directory] 명부 가시성 확인 실패:', error.message);
        return { ok: false, visibleRows: 0 };
      }
      return { ok: true, visibleRows: typeof count === 'number' ? count : 0 };
    } catch (e) {
      console.error(
        '[clinic-diagnosis/directory] 명부 가시성 확인 예외:',
        e instanceof Error ? e.message : e,
      );
      return { ok: false, visibleRows: 0 };
    }
  };
}

/**
 * 폴백 식별자('hira:…')로 병원 1건을 다시 확정한다 — 진단 진입 전 서버 재검증용.
 *
 * ⚠️ 클라이언트가 보낸 mngNo 를 그대로 믿지 않는다는 원칙은 폴백에서도 같다.
 *    다만 여기서는 이름까지 대조한다 — 식별자만 맞고 이름이 전혀 다르면 거부한다.
 */
export async function findDirectoryClinic(mngNo: string): Promise<ClinicCandidate | null> {
  if (!isDirectoryMngNo(mngNo)) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('clinic_directory')
      .select(SELECT_COLUMNS)
      .eq('mng_no', mngNo)
      .abortSignal(timeoutSignal(DIRECTORY_TIMEOUT_MS))
      .maybeSingle();
    if (error) {
      console.error('[clinic-diagnosis/directory] 폴백 재확인 실패:', error.message);
      return null;
    }
    return toDirectoryCandidate(data);
  } catch (e) {
    console.error(
      '[clinic-diagnosis/directory] 폴백 재확인 예외:',
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
