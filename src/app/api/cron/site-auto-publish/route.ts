// 매일 1회 실행 — 내 블로그(서브도메인) 정기 자동발행.
//
// 설계 대원칙(자동 "생성" 아님, 발행만 스케줄):
//  - site_publish_cadence != 'off' 이고 site_slug 가 설정된 회원만 대상(opt-in).
//  - 그 회원의 "검수 통과·미발행" 글 중 오래된 순으로 주기별 상한만큼 발행한다.
//      · weekly/biweekly → 회당 1편. 주기 실행권을 profiles 행에서 원자적으로
//        선점(claim_auto_publish_cycle)해 동시 실행이 각각 1편씩 내보내지 못하게 한다.
//      · auto → 하루 최대 3편. 집계와 선점을 한 트랜잭션(claim_auto_publish_posts,
//        advisory lock)에서 처리해 중복 전달·재시도·수동 재실행이 겹쳐도 상한을 넘지 않는다.
//  - ★ 순회는 영속 커서(clinic_auto_publish_state)로 이어달린다. 전체 발행 상한(100편)에
//    걸려 중간에 끊겨도 다음 실행이 "마지막으로 검사한 회원 다음"부터 이어받으므로
//    앞쪽 회원이 상한을 독식해도 뒤쪽 회원이 영구 기아되지 않는다.
//    커서 테이블이 없으면(마이그 050 미적용) 날짜 기반 회전으로 폴백한다.
//  - 검수 게이트는 수동 발행(/api/mypage/site-publish)과 "동일 기준"을 재사용한다
//    (compliance_report 없음 / needsManualReview / HIGH·CRITICAL → 제외).
//  - 발행 대상이 없으면 아무것도 하지 않는다(last_run 도 갱신하지 않음 → 대상이
//    생기는 즉시 다음 실행에서 발행). 실제 주기 간격은 isDue 가 제어하므로 매일 돌아도
//    weekly/biweekly 회원은 주1회/격주만 실제 발행된다.
//  - 발행 후 IndexNow 로 색인 요청을 보낸다(실패해도 발행은 성공 — 그레이스풀).
//
// 인증: Authorization: Bearer ${CRON_SECRET} (기존 cron 패턴 동일). service role 로
//       update(RLS 우회). 개별 회원 실패는 기록만 하고 전체는 계속 진행한다.

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { isAuthorizedCron } from '@/dev/lib/cron-auth';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { validateComplianceReport } from '@/content/lib/compliance-report';
import { serverPublishBlockReason } from '@/content/lib/clinic-site/server-publish-gate';
import {
  isDue,
  pickNextPosts,
  isValidCadence,
  maxPostsPerRun,
  needsDailyQuotaCheck,
  dueThresholdIso,
  mergeCursorWindow,
  rotationOffset,
  kstDayIndex,
  kstDayStartIso,
  type AutoPublishCandidate,
} from '@/content/lib/clinic-site/auto-publish';
import {
  claimPostsForPublish,
  claimAutoPublishCycle,
  restoreAutoPublishCycle,
  readAutoPublishCursor,
  writeAutoPublishCursor,
} from '@/content/lib/clinic-site/auto-publish-claim';
import { clinicSiteHost, clinicSiteUrl } from '@/content/lib/clinic-site/slug';
import { notifyIndexNow } from '@/content/lib/clinic-site/indexnow-submit';
import { isActivePlan } from '@/payment/lib/plans';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// 부하 방어 상한
const MAX_PROFILES = 200;      // 1회 실행 순회 회원 상한
const CANDIDATE_LIMIT = 50;    // 회원당 조회할 미발행 후보 상한(가장 오래된 것 우선 정렬 후 상한)
// 1회 실행 전체 발행 편수 상한. maxDuration(120초) 안에 끝나도록 하는 안전장치이며,
// 'auto' 회원이 늘어도 한 번에 색인 요청이 폭주하지 않게 한다.
const MAX_PUBLISH_PER_RUN = 100;
// IndexNow 색인 요청에 쓸 수 있는 총 시간 예산(ms). 호스트마다 1회 호출이 필요한데
// (서브도메인 = 별개 호스트라 묶을 수 없다) 회원 수가 많으면 maxDuration(120초)을
// 잠식할 수 있다 → 예산을 넘기면 색인 요청만 건너뛴다(발행은 계속 진행).
const INDEXNOW_BUDGET_MS = 30_000;
const INDEXNOW_CALL_TIMEOUT_MS = 3_000;

interface ScheduleProfileRow {
  id: string;
  site_slug: string | null;
  site_publish_cadence: string | null;
  site_publish_last_run: string | null;
  plan: string | null;
  plan_expires_at: string | null;
  /** 마이그 052 미적용 환경에서는 조회 자체를 하지 않는다(undefined). */
  site_auto_publish_since?: string | null;
}

/**
 * 조회 컬럼 — site_auto_publish_since(마이그 052)는 미적용 환경에서 빼고 조회한다.
 * plan / plan_expires_at 는 코어 컬럼(마이그 001)이라 항상 존재한다.
 */
const SCHEDULE_COLS_BASE =
  'id, site_slug, site_publish_cadence, site_publish_last_run, plan, plan_expires_at';
const SCHEDULE_COLS_WITH_SINCE = `${SCHEDULE_COLS_BASE}, site_auto_publish_since`;

interface CandidatePostRow {
  id: string;
  created_at: string;
  content: string | null;
  compliance_report: unknown;
}

/** 공개 페이지 ISR 재검증 — 실패해도 발행 자체는 성공 처리(최대 1시간 내 자연 갱신). */
function revalidateClinicPages(slug: string, postId: string): void {
  try {
    revalidatePath(`/clinic-site/${slug}`);
    revalidatePath(`/clinic-site/${slug}/posts/${postId}`);
  } catch (err) {
    console.error('[site-auto-publish] 재검증 실패:', err instanceof Error ? err.message : err);
  }
}

/**
 * 'auto' 회원의 소급 발행 차단 기준 시각을 확정한다.
 *
 * 반환값이 null 이면 필터를 걸지 않는다(= 기존 동작):
 *  - weekly/biweekly — 회원이 명시적으로 고른 주기이고 회당 1편이라 기존 동작을 바꾸지 않는다.
 *  - 마이그 052 미적용 — 저장할 컬럼이 없다.
 *
 * 값이 비어 있는 'auto' 회원은 "지금"으로 확정해 기록한다(경합 안전: 아직 null 일 때만 기록).
 */
async function resolveAutoPublishSince(
  admin: ReturnType<typeof createAdminClient>,
  profile: ScheduleProfileRow,
  cadence: string,
  sinceAvailable: boolean,
): Promise<string | null> {
  if (cadence !== 'auto' || !sinceAvailable) return null;

  const existing = profile.site_auto_publish_since ?? null;
  if (existing) return existing;

  const stamped = new Date().toISOString();
  const { error } = await admin
    .from('profiles')
    .update({ site_auto_publish_since: stamped })
    .eq('id', profile.id)
    .is('site_auto_publish_since', null);

  if (error) {
    // 기록에 실패하면 이번 실행은 보수적으로 건너뛴다(과거 글 대량 공개 방지).
    console.error('[site-auto-publish] 자동발행 시작시각 기록 실패:', profile.id, error.message);
    return stamped;
  }
  return stamped;
}

/** 스케줄 조회 오류 → 마이그 미적용이면 비활성 안내, 그 외는 500. */
function scheduleQueryError(error: { code?: string; message?: string }): NextResponse {
  if (error.code === '42703') {
    return NextResponse.json({
      ok: true,
      mode: 'disabled',
      message: '자동발행 스케줄 컬럼이 아직 적용되지 않았습니다(마이그 044 미적용).',
    });
  }
  return NextResponse.json({ ok: false, error: error.message ?? 'schedule query failed' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const startedAt = Date.now();
  const dayStartIso = kstDayStartIso(now);

  let scanned = 0;           // isDue 통과해 후보를 조회한 회원 수
  let published = 0;         // 실제 발행된 글 수
  let inactiveSkipped = 0;   // 구독 해지·만료로 건너뛴 회원 수(기존 글은 그대로 유지)
  let indexNowFailures = 0;  // 색인 요청 실패 수(발행 성공과 무관 — 모니터링용)
  let indexNowSkipped = 0;   // 시간 예산 초과로 색인 요청을 건너뛴 회원 수
  let atomicFallbacks = 0;   // 마이그 050 미적용으로 비원자 경로를 탄 회원 수(모니터링)
  const failures: Array<{ userId: string; reason: string }> = [];

  try {
    // 자동발행을 켠 회원 총수 — 회전 창 계산용.
    // 컬럼 미적용(42703) 환경에서는 기능 비활성 상태로 graceful 반환.
    const { count: totalProfiles, error: countError } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .neq('site_publish_cadence', 'off')
      .not('site_slug', 'is', null);

    if (countError) return scheduleQueryError(countError);

    const total = totalProfiles ?? 0;

    // ★ 순회 위치 결정.
    //   1순위: 영속 커서 — 마지막으로 "검사한" 회원 다음부터 이어받는다.
    //          전체 발행 상한에 걸려 끊겨도 커서가 최소 1칸 전진하므로
    //          모든 회원이 최대 total 회 실행 안에 반드시 검사된다.
    //   폴백: 커서 테이블이 없으면(마이그 050 미적용) 날짜 기반 회전 창.
    const cursor = await readAutoPublishCursor(admin);
    const useCursor = cursor !== undefined;

    // 마이그 052(site_auto_publish_since) 적용 여부를 한 번만 확인한다.
    // 미적용이면 소급 방지 필터 없이 기존 동작을 유지한다(배포가 깨지지 않게).
    const sinceProbe = await admin.from('profiles').select('site_auto_publish_since').limit(1);
    const sinceAvailable = sinceProbe.error?.code !== '42703';

    // 제네릭으로 행 타입을 고정한다 — 조회 컬럼이 실행 시점에 갈리므로
    // (마이그 052 적용 여부) PostgREST 의 문자열 파싱 타입을 쓸 수 없다.
    const baseQuery = () =>
      admin
        .from('profiles')
        .select<string, ScheduleProfileRow>(
          sinceAvailable ? SCHEDULE_COLS_WITH_SINCE : SCHEDULE_COLS_BASE,
        )
        .neq('site_publish_cadence', 'off')
        .not('site_slug', 'is', null)
        .order('id', { ascending: true });

    let profiles: ScheduleProfileRow[] = [];

    if (useCursor) {
      // ① 커서 이후 페이지
      const after = cursor
        ? await baseQuery().gt('id', cursor).limit(MAX_PROFILES)
        : await baseQuery().limit(MAX_PROFILES);
      if (after.error) return scheduleQueryError(after.error);

      const afterRows = (after.data ?? []) as ScheduleProfileRow[];

      // ② 부족분은 처음부터 채운다(wrap-around) — 커서가 끝에 닿아도 멈추지 않는다.
      let wrappedRows: ScheduleProfileRow[] = [];
      if (afterRows.length < MAX_PROFILES) {
        const wrapped = await baseQuery().limit(MAX_PROFILES - afterRows.length);
        if (wrapped.error) return scheduleQueryError(wrapped.error);
        wrappedRows = (wrapped.data ?? []) as ScheduleProfileRow[];
      }

      profiles = mergeCursorWindow(afterRows, wrappedRows, MAX_PROFILES);
    } else {
      const offset = rotationOffset(total, MAX_PROFILES, kstDayIndex(now));
      const res = await baseQuery().range(offset, offset + MAX_PROFILES - 1);
      if (res.error) return scheduleQueryError(res.error);
      profiles = (res.data ?? []) as ScheduleProfileRow[];
    }

    // 커서는 "마지막으로 검사한 회원"을 가리킨다(발행 여부와 무관).
    let lastExaminedId: string | null = null;

    for (const profile of profiles) {
      if (published >= MAX_PUBLISH_PER_RUN) break;

      // 이 회원을 "검사했다"는 사실을 먼저 기록한다 — 다음 실행이 여기 다음부터 이어받는다.
      lastExaminedId = profile.id;

      const slug = profile.site_slug;
      const cadence = profile.site_publish_cadence;
      if (!slug || !isValidCadence(cadence)) continue;

      // 구독 해지·만료 회원: 새 글 자동 발행만 멈춘다.
      // (이미 발행된 글은 내리지 않는다 — 색인 자산 보존 + 재구독 유인)
      if (!isActivePlan(profile.plan, profile.plan_expires_at)) {
        inactiveSkipped++;
        continue;
      }

      if (!isDue(cadence, profile.site_publish_last_run, now)) continue;

      scanned++;

      try {
        // ★ 소급 발행 차단 — 'auto' 는 "자동발행을 켠 시점 이후에 만들어진 글"만 대상이다.
        //   이 기준이 없으면 자동발행을 켜는 순간 보관함의 과거 글이 한꺼번에 공개된다.
        //   값이 없으면(기존 auto 회원) 지금 시각으로 확정한다 — 과거 글은 영구 제외되고
        //   앞으로 쓰는 글만 나간다. 마이그 미적용(sinceAvailable=false)이면 기존 동작 유지.
        const autoSince = await resolveAutoPublishSince(admin, profile, cadence, sinceAvailable);

        // 그 회원의 미발행 글 후보(가장 오래된 순). 검수 게이트는 아래에서 재검증한다.
        let candidateQuery = admin
          .from('saved_posts')
          .select('id, created_at, content, compliance_report')
          .eq('user_id', profile.id)
          .eq('published_to_site', false);
        if (autoSince) candidateQuery = candidateQuery.gte('created_at', autoSince);

        const { data: postRows, error: postErr } = await candidateQuery
          .order('created_at', { ascending: true })
          .limit(CANDIDATE_LIMIT);

        if (postErr) {
          failures.push({ userId: profile.id, reason: postErr.message });
          continue;
        }

        // 검수 게이트 통과 + 본문 비어있지 않은 글만 후보로 남긴다(수동 발행과 동일 기준).
        // ★ 무인 경로라 저장 스냅샷만 믿지 않고 서버가 본문을 직접 A층 재검사한다
        //   (server-publish-gate.ts — 스냅샷은 클라이언트가 보낸 값이라 위조 가능).
        const candidates: AutoPublishCandidate[] = ((postRows ?? []) as CandidatePostRow[])
          .filter((row) => {
            const content = typeof row.content === 'string' ? row.content : '';
            if (content.trim() === '') return false;
            return serverPublishBlockReason(
              validateComplianceReport(row.compliance_report),
              content,
            ) === null;
          })
          .map((row) => ({ id: row.id, createdAt: row.created_at }));

        // 이번 실행에서 이 회원에게 허용할 편수 (주기 상한 ∩ 전체 실행 잔여).
        const runLimit = Math.min(maxPostsPerRun(cadence), MAX_PUBLISH_PER_RUN - published);
        const picked = pickNextPosts(candidates, runLimit);
        if (picked.length === 0) continue; // 발행 대상 없음 → last_run 갱신 없이 다음 회원

        // ★ weekly/biweekly: 주기 실행권을 먼저 원자적으로 선점한다.
        //   isDue 는 앱 판정이라 두 실행이 같은 오래된 last_run 을 읽으면 각각 1편씩 나간다.
        //   후보가 있는 것을 확인한 "뒤"에 선점해야 발행 없이 주기만 소진되지 않는다.
        const threshold = dueThresholdIso(cadence, now);
        let cycle: Awaited<ReturnType<typeof claimAutoPublishCycle>> | null = null;
        if (!needsDailyQuotaCheck(cadence) && threshold) {
          cycle = await claimAutoPublishCycle(admin, profile.id, threshold);
          if (!cycle.ok) {
            failures.push({ userId: profile.id, reason: `주기 선점 실패: ${cycle.reason}` });
            continue;
          }
          if (!cycle.claimed) continue; // 다른 실행이 이번 주기를 이미 가져갔다
        }

        // 글 선점. 주기별로 경로가 갈린다(claimPostsForPublish 내부 분기):
        //  · auto            → 일일 상한 강제 RPC (advisory lock + 단일 트랜잭션)
        //  · weekly/biweekly → 일일 집계 없이 조건부 UPDATE 로 글만 원자 선점
        //    (간격은 위의 주기 선점이 이미 보장한다. 여기서 일일 집계를 하면
        //     그날 수동 발행한 회원의 cron 이 밀려 기존 동작이 깨진다.)
        const claim = await claimPostsForPublish(admin, {
          userId: profile.id,
          cadence,
          dayStartIso,
          candidateIds: picked.map((post) => post.id),
          limit: runLimit,
        });

        if (!claim.ok) {
          failures.push({ userId: profile.id, reason: claim.reason });
          if (cycle?.ok && cycle.claimed && cycle.atomic) {
            await restoreAutoPublishCycle(admin, profile.id, cycle.previousLastRun, cycle.claimedAt);
          }
          continue;
        }

        const publishedIds = claim.claimedIds;
        if (!claim.atomic) atomicFallbacks++;

        if (publishedIds.length === 0) {
          // 한 편도 못 가져갔다(상한 소진·다른 실행이 선점) → 주기를 낭비시키지 않는다.
          if (cycle?.ok && cycle.claimed && cycle.atomic) {
            await restoreAutoPublishCycle(admin, profile.id, cycle.previousLastRun, cycle.claimedAt);
          }
          continue;
        }

        published += publishedIds.length;
        for (const postId of publishedIds) revalidateClinicPages(slug, postId);

        // last_run 갱신.
        //  - 주기를 "원자적으로" 선점한 경우: RPC 가 이미 now() 로 갱신했다 → 건너뛴다.
        //  - auto: 주기 선점을 쓰지 않으므로 여기서 남긴다(관측용).
        //  - ⚠️ 마이그 050 미적용 폴백(cycle.atomic === false): 여기서 갱신하지 않으면
        //    weekly/biweekly 의 last_run 이 영영 안 바뀌어 매일 발행된다.
        const cycleAlreadyStamped = cycle?.ok === true && cycle.claimed && cycle.atomic;
        if (!cycleAlreadyStamped) {
          const { error: updateProfileErr } = await admin
            .from('profiles')
            .update({ site_publish_last_run: new Date().toISOString() })
            .eq('id', profile.id);
          if (updateProfileErr) {
            failures.push({ userId: profile.id, reason: `last_run 갱신 실패: ${updateProfileErr.message}` });
          }
        }

        // IndexNow — 발행된 글 + 목록이 바뀐 홈. 실패해도 발행은 이미 성공 상태다.
        // 남은 예산이 호출 타임아웃보다 작으면 아예 시작하지 않는다
        // (예산 직전에 시작하면 타임아웃만큼 초과되므로 엄격하게 판정).
        if (Date.now() - startedAt + INDEXNOW_CALL_TIMEOUT_MS <= INDEXNOW_BUDGET_MS) {
          const outcome = await notifyIndexNow(
            clinicSiteHost(slug),
            [clinicSiteUrl(slug), ...publishedIds.map((id) => clinicSiteUrl(slug, `/posts/${id}`))],
            { timeoutMs: INDEXNOW_CALL_TIMEOUT_MS },
          );
          if (outcome.status === 'failed') {
            indexNowFailures++;
          }
        } else {
          indexNowSkipped++;
        }
      } catch (e) {
        // 한 회원 실패가 전체를 중단시키지 않는다.
        failures.push({ userId: profile.id, reason: e instanceof Error ? e.message : 'unknown' });
      }
    }

    // 다음 실행이 이어받을 위치 — 발행 상한에 걸려 끊겼어도 여기까지는 검사했다.
    // ★ 저장 실패를 조용히 넘기면 매 실행이 같은 지점에서 시작해 뒤쪽 회원이
    //   다시 영구 기아에 빠지므로, 실패를 응답과 failures 양쪽에 남긴다.
    let cursorWrite: 'ok' | 'failed' | 'skipped' = 'skipped';
    if (useCursor && lastExaminedId) {
      const written = await writeAutoPublishCursor(admin, lastExaminedId);
      cursorWrite = written.ok ? 'ok' : 'failed';
      if (!written.ok) {
        failures.push({ userId: lastExaminedId, reason: `커서 저장 실패: ${written.reason}` });
      }
    }

    return NextResponse.json({
      ok: true,
      mode: 'live',
      total,
      cursor: useCursor ? 'persisted' : 'day-rotation',
      cursorWrite,
      scanned,
      published,
      inactiveSkipped,
      atomicFallbacks,
      indexNowFailures,
      indexNowSkipped,
      failures,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'cron failed';
    return NextResponse.json(
      { ok: false, error: message, scanned, published, inactiveSkipped, atomicFallbacks, indexNowFailures, indexNowSkipped, failures },
      { status: 500 },
    );
  }
}
