// 매주 월요일 1회 실행 — AI 검색(GEO) 인용 추적 샘플링. (주기는 주 1회 유지)
// ★ 겸업: 같은 주간 슬롯에 **Resend 발송 도메인 점검**을 얹었다(src/payment/email/domain-health.ts).
//    "메일 도메인 점검이 어디서 도는가"를 찾는 사람은 여기다.
// 유료 플랜 회원별로 프로필(지역·진료과·키워드) 기반 질문 최대 5개를 생성해
// 설정된 AI 검색 엔진(OpenAI · Perplexity)에 각각 질의하고,
// 병원명/블로그 URL 인용 여부를 geo_citations 에 기록한다(engine 컬럼에 엔진 식별자).
// 샘플링 결과이며 실제 사용자 노출과 다를 수 있다(UI에 동일 면책 표기).
// 인증: Authorization: Bearer ${CRON_SECRET} (기존 cron 패턴 동일). service role로 insert(RLS 우회).
//
// ⚠️ Gemini 는 구글 약관(Grounded Results 의 analyze/cache 금지)으로 기본 비활성이다.
//    상세 근거는 src/content/lib/geo-engines/gemini.ts 상단 참조.
//
// 이 파일은 **얇은 어댑터**다. 실행 로직·시간 마감은 전부
// src/content/lib/geo-engines/run-tracking.ts 의 runGeoTracking 에 있고,
// 여기서는 Supabase 호출을 게이트웨이 인터페이스에 맞춰 넘기기만 한다.
// (그렇게 해야 "최악의 경우에도 300초 이내"를 가상 시계로 실제 제어 흐름에서 검증할 수 있다)
//
// 안전장치 요약:
//  · 키 없는 엔진은 조용히 skip, 전부 없으면 mode:'disabled'
//  · 외부 API 호출 전에 geo_tracking_runs(week_start PK) 로 동시 실행 원자적 차단(마이그 048)
//  · 구간별 절대 마감: 준비 20s → 질의 200s → 판정 210s → 저장 285s → 마무리 288s
//  · 회원 단위 "전부 아니면 전무", 완전 성공이 아니면 status='failed' 로 재실행 허용

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/dev/lib/cron-auth';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { PAID_PLAN_IDS } from '@/payment/lib/plans';
import { getEnabledEngines } from '@/content/lib/geo-engines';
import { runGeoTracking } from '@/content/lib/geo-engines/run-tracking';
import type {
  FinalizeLockInput,
  GeoCitationInsertRow,
  GeoProfileRow,
  GeoTrackingGateway,
} from '@/content/lib/geo-engines/run-tracking';
import type { DbErrorLike } from '@/content/lib/geo-engines/run-lock';
import { mondayOfWeek } from '@/content/lib/geo-tracking';
import { runResendDomainCheck } from '@/payment/email/domain-health';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type AdminClient = ReturnType<typeof createAdminClient>;

/** 게이트웨이 계약: 모든 호출은 timeoutMs 안에 끝나야 한다 → AbortSignal.timeout 부착 */
function timeoutSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, timeoutMs));
}

function toDbError(error: { code?: string; message?: string } | null): DbErrorLike | null {
  if (!error) return null;
  return { code: error.code, message: error.message };
}

/**
 * Supabase 게이트웨이. 로직은 없고 쿼리만 있다 —
 * 시간 마감·상태 판정은 전부 runGeoTracking 이 담당한다.
 *
 * engineIds: 이 cron 이 관리하는 엔진 식별자 목록. 중복 확인을 이 엔진들의 행으로
 * 한정한다 — 로컬 수집기가 같은 주에 engine='naver' 행을 먼저 넣어도(브라우저 기반이라
 * 서버 cron 에 못 얹는다) 그 회원의 API 엔진 질의가 건너뛰어지지 않게 하기 위해서다.
 */
function createSupabaseGateway(admin: AdminClient, engineIds: readonly string[]): GeoTrackingGateway {
  return {
    async acquireLock(weekStart, timeoutMs) {
      const { error } = await admin
        .from('geo_tracking_runs')
        .insert({ week_start: weekStart, status: 'running' })
        .abortSignal(timeoutSignal(timeoutMs));
      return { error: toDbError(error) };
    },

    async takeoverLock(weekStart, staleBeforeIso, timeoutMs) {
      // 인계 대상: 비정상 종료로 남은 running, 또는 재실행이 허용된 failed.
      // 조건부 update 가 행을 돌려주는 순간이 소유권 획득이라 경쟁이 없다.
      const { data, error } = await admin
        .from('geo_tracking_runs')
        .update({ started_at: new Date().toISOString(), status: 'running' })
        .eq('week_start', weekStart)
        .or(`status.eq.failed,and(status.eq.running,started_at.lt.${staleBeforeIso})`)
        .select('week_start')
        .abortSignal(timeoutSignal(timeoutMs));
      return { takenOver: (data ?? []).length > 0, error: toDbError(error) };
    },

    async finalizeLock(input: FinalizeLockInput, timeoutMs) {
      const { error } = await admin
        .from('geo_tracking_runs')
        .update({
          finished_at: new Date().toISOString(),
          status: input.status,
          users: input.users,
          inserted: input.inserted,
          http_attempts: input.httpAttempts,
          note: input.note,
        })
        .eq('week_start', input.weekStart)
        .abortSignal(timeoutSignal(timeoutMs));
      return { error: toDbError(error) };
    },

    async countPaidProfiles(timeoutMs) {
      const { count, error } = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .in('plan', PAID_PLAN_IDS)
        .abortSignal(timeoutSignal(timeoutMs));
      return { count: count ?? null, error: toDbError(error) };
    },

    async listPaidProfiles(limit, timeoutMs) {
      const { data, error } = await admin
        .from('profiles')
        .select('id, hospital_name, region, specialty, hospital_keywords, naver_blog_url')
        .in('plan', PAID_PLAN_IDS)
        .order('id', { ascending: true })
        .limit(limit)
        .abortSignal(timeoutSignal(timeoutMs));
      return { rows: (data ?? []) as GeoProfileRow[], error: toDbError(error) };
    },

    async listWeekCitationUserIds(weekStartIso, candidateIds, limit, timeoutMs) {
      if (candidateIds.length === 0) return { userIds: [], error: null };
      const { data, error } = await admin
        .from('geo_citations')
        .select('user_id')
        .in('user_id', candidateIds as string[])
        // 이 cron 소관 엔진의 행만 중복으로 본다 — 로컬 네이버 수집기 행과 분리
        .in('engine', engineIds as string[])
        .gte('checked_at', weekStartIso)
        .limit(limit)
        .abortSignal(timeoutSignal(timeoutMs));
      // 마이그 037 미적용이면 중복도 있을 수 없다 → 빈 목록으로 진행
      if (error?.code === '42P01') return { userIds: [], error: null };
      const rows = (data ?? []) as Array<{ user_id: string | null }>;
      return {
        userIds: rows.map((r) => r.user_id).filter((id): id is string => Boolean(id)),
        error: toDbError(error),
      };
    },

    async insertCitations(rows: readonly GeoCitationInsertRow[], timeoutMs) {
      const { error } = await admin
        .from('geo_citations')
        .insert(rows as GeoCitationInsertRow[])
        .abortSignal(timeoutSignal(timeoutMs));
      return { error: toDbError(error) };
    },
  };
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ★ 주간 점검 편승 (2026-07-27) — 이 크론이 코드베이스에서 유일한 "매주 월요일" 파이프라인이라
  //   추가 인프라 없이 여기 얹는다. Resend 발송 도메인이 미검증이면 메일이 전건 실패하는데,
  //   그 주에 메일이 한 통도 안 나가면 발송 실패 알림조차 울리지 않는다(그래서 못 잡았다).
  //   계약: 최대 8초, throw 없음, 문제일 때만 텔레그램. GEO 시간 예산을 건드리지 않도록
  //   모든 절대 마감의 기준점(startedAt)을 잡기 **전에** 끝낸다.
  await runResendDomainCheck();

  // 요청 진입 시각을 고정한다 — 모든 절대 마감의 기준점
  const startedAt = Date.now();
  const engines = getEnabledEngines(process.env);

  if (engines.length === 0) {
    return NextResponse.json({
      ok: true,
      mode: 'disabled',
      message:
        'GEO 라이브 질의가 비활성 상태입니다 (GEO_LIVE_QUERY=off 또는 엔진 API 키 미설정). 준비도 점수 모드만 운영됩니다.',
    });
  }

  const weekStart = mondayOfWeek(new Date(startedAt).toISOString());
  if (!weekStart) {
    return NextResponse.json({ ok: false, error: '주차 계산에 실패했습니다.' }, { status: 500 });
  }

  const result = await runGeoTracking({
    gateway: createSupabaseGateway(createAdminClient(), engines.map((e) => e.id)),
    engines,
    env: process.env,
    weekStart,
    startedAt,
    now: Date.now,
    logger: {
      warn: (message) => console.warn(message),
      error: (message) => console.error(message),
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
