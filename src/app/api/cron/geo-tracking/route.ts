// 매주 월요일 1회 실행 — AI 검색(GEO) 인용 추적 샘플링. (주기는 주 1회 유지)
// 유료 플랜 회원별로 프로필(지역·진료과·키워드) 기반 질문 최대 5개를 생성해
// 설정된 AI 검색 엔진(OpenAI · Perplexity)에 각각 질의하고,
// 병원명/블로그 URL 인용 여부를 geo_citations 에 기록한다(engine 컬럼에 엔진 식별자).
// 샘플링 결과이며 실제 사용자 노출과 다를 수 있다(UI에 동일 면책 표기).
// 인증: Authorization: Bearer ${CRON_SECRET} (기존 cron 패턴 동일). service role로 insert(RLS 우회).
//
// ⚠️ Gemini 는 구글 약관(Grounded Results 의 analyze/cache 금지)으로 기본 비활성이다.
//    상세 근거는 src/content/lib/geo-engines/gemini.ts 상단 참조.
//
// 안전장치:
//  · API 키가 없는 엔진은 조용히 건너뛴다. 하나도 없으면 mode:'disabled'
//    → 새 환경변수를 넣지 않아도 기존과 동일하게(OpenAI 단독) 동작한다.
//  · 한 엔진이 실패해도 나머지 엔진은 계속 돈다. 실패는 failures[] 로 노출.
//  · 상한/데드라인에 걸려 잘린 회원 수를 응답에 명시한다(침묵 실패 금지).
//  · 같은 (엔진, 질의문)은 실행 중 메모리 캐시로 1회만 호출한다.
//  · 회원 단위 "전부 아니면 전무" — 계획된 조합이 하나라도 실패하면 그 회원은 저장하지 않는다.
//  · ★ 동시 실행 차단: 외부 API 를 호출하기 전에 geo_tracking_runs(week_start PK) 에
//    insert 를 시도한다. 원자적 단일 문이라 동시 실행에서도 하나만 통과한다(마이그 048).
//  · ★ 구간별 절대 시각 상한으로 300초 안에 반드시 끝난다
//    (질의 200s → 저장 285s → 마무리 288s → 응답 290s. 근거는 budget.ts "실행 시간 예산").

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/dev/lib/cron-auth';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { PAID_PLAN_IDS } from '@/payment/lib/plans';
import { extractNaverBlogId } from '@/content/lib/rank-tracking';
import { executeGeoQueries, getEnabledEngines } from '@/content/lib/geo-engines';
import { chunkGroups } from '@/content/lib/geo-engines/batching';
import {
  INSERT_CHUNK_TIMEOUT_MS,
  LOCK_FINALIZE_TIMEOUT_MS,
  MAX_REPORTED_FAILURES,
  MAX_USERS,
  MIN_INSERT_WINDOW_MS,
  QUERY_DEADLINE_MS,
  SAVE_DEADLINE_MS,
  capQuestionPlan,
  maxUniqueQuestionsFor,
  type UserQuestionPlan,
} from '@/content/lib/geo-engines/budget';
import {
  PG_UNDEFINED_TABLE,
  interpretLockInsert,
  staleThresholdIso,
  type RunLockDecision,
} from '@/content/lib/geo-engines/run-lock';
import {
  buildGeoQuestions,
  detectCitation,
  mondayOfWeek,
  sanitizeExcerpt,
} from '@/content/lib/geo-tracking';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** raw 에 보관하는 응답 발췌 길이 (전체 원문 저장 금지) */
const RAW_EXCERPT_LENGTH = 300;
/** geo_citations 배치 insert 목표 크기 — 회원 경계는 넘지 않는다 */
const INSERT_CHUNK_SIZE = 200;
/**
 * 이번 주 중복 확인 조회 상한.
 * 후보 회원 id 로 범위를 좁혀 조회하므로(.in) 테이블 전체 증가와 무관하다.
 * 우리 cron 이 한 주에 쓰는 최대 행 수 = 100명 × 5질의 × 3엔진 = 1,500.
 * stale 인계로 한 번 더 돌아도 3,000. 그 두 배인 6,000 을 상한으로 둔다.
 */
const WEEK_ROWS_LOOKUP_LIMIT = 6_000;

interface ProfileRow {
  id: string;
  hospital_name: string | null;
  region: string | null;
  specialty: string | null;
  hospital_keywords: string[] | null;
  naver_blog_url: string | null;
}

interface CitationTarget {
  readonly hospitalName: string | null;
  readonly naverBlogId: string | null;
}

interface GeoCitationInsert {
  user_id: string;
  question: string;
  engine: string;
  cited: boolean;
  citation_type: string;
  evidence: string | null;
  raw: { sources: Array<{ url: string; title: string }>; excerpt: string };
}

type AdminClient = ReturnType<typeof createAdminClient>;

/** 남은 시간에 맞춰 좁힌 타임아웃 시그널 (없으면 null = 시간 없음) */
function deadlineSignal(deadlineAt: number, maxMs: number, minMs: number): AbortSignal | null {
  const remaining = deadlineAt - Date.now();
  if (remaining < minMs) return null;
  return AbortSignal.timeout(Math.min(maxMs, remaining));
}

/**
 * 주차 실행 잠금 확보 — 외부 API 호출 전에 반드시 통과해야 한다.
 * week_start 고유키 insert 로 동시 실행을 원자적으로 차단한다.
 * 이미 있는 레코드가 stale('running' 인데 오래 방치)이면 조건부 update 로 인계받는다.
 */
async function acquireRunLock(admin: AdminClient, weekStart: string): Promise<RunLockDecision> {
  const { error } = await admin
    .from('geo_tracking_runs')
    .insert({ week_start: weekStart, status: 'running' });

  if (!error) return interpretLockInsert(null);
  if (error.code !== '23505') return interpretLockInsert(error);

  // 고유키 충돌 — 비정상 종료로 남은 잠금인지 확인해 인계 시도.
  // 조건부 update 가 행을 돌려주면 그 순간 소유권을 얻은 것이라 경쟁이 없다.
  const { data: takenOver, error: takeoverErr } = await admin
    .from('geo_tracking_runs')
    .update({ started_at: new Date().toISOString(), status: 'running' })
    .eq('week_start', weekStart)
    .eq('status', 'running')
    .lt('started_at', staleThresholdIso())
    .select('week_start');

  if (takeoverErr) return interpretLockInsert(error);
  return interpretLockInsert(error, (takenOver ?? []).length > 0);
}

/**
 * 이번 주에 이미 기록이 있는 회원 id 집합 (후보 회원으로 범위를 좁혀 조회).
 * 잠금이 1차 방어선이고, 이것은 stale 인계·잠금 미적용 상황의 2차 방어선이다.
 */
async function fetchAlreadyCheckedUserIds(
  admin: AdminClient,
  weekStartIso: string,
  candidateIds: readonly string[],
): Promise<{ ids: ReadonlySet<string>; error: string | null; incomplete: boolean }> {
  if (candidateIds.length === 0) return { ids: new Set(), error: null, incomplete: false };

  const { data, error } = await admin
    .from('geo_citations')
    .select('user_id')
    .in('user_id', candidateIds as string[])
    .gte('checked_at', weekStartIso)
    .limit(WEEK_ROWS_LOOKUP_LIMIT);

  if (error) {
    // 테이블 자체가 없으면 중복도 있을 수 없다 → 빈 집합으로 진행
    if (error.code === PG_UNDEFINED_TABLE) return { ids: new Set(), error: null, incomplete: false };
    return { ids: new Set(), error: error.message, incomplete: true };
  }

  const rows = (data ?? []) as Array<{ user_id: string | null }>;
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.user_id) ids.add(row.user_id);
  }
  // 상한에 닿았다면 못 본 회원이 있을 수 있다 → 중복 판정을 신뢰할 수 없다
  return { ids, error: null, incomplete: rows.length >= WEEK_ROWS_LOOKUP_LIMIT };
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const queryDeadlineAt = startedAt + QUERY_DEADLINE_MS;
  const saveDeadlineAt = startedAt + SAVE_DEADLINE_MS;
  const engines = getEnabledEngines(process.env);

  if (engines.length === 0) {
    return NextResponse.json({
      ok: true,
      mode: 'disabled',
      message:
        'GEO 라이브 질의가 비활성 상태입니다 (GEO_LIVE_QUERY=off 또는 엔진 API 키 미설정). 준비도 점수 모드만 운영됩니다.',
    });
  }

  const admin = createAdminClient();
  const weekStart = mondayOfWeek(new Date().toISOString());
  if (!weekStart) {
    return NextResponse.json({ ok: false, error: '주차 계산에 실패했습니다.' }, { status: 500 });
  }
  let lock: RunLockDecision = { mode: 'error', reason: null, proceed: false };

  try {
    // 0) ★ 실행 잠금 — 외부 API 호출(=비용 발생) 이전에 원자적으로 선점한다
    lock = await acquireRunLock(admin, weekStart);
    if (!lock.proceed) {
      const status = lock.mode === 'error' ? 500 : 200;
      console.warn(`[geo-tracking] 실행 중단 (lock=${lock.mode}): ${lock.reason}`);
      return NextResponse.json(
        { ok: lock.mode !== 'error', mode: lock.mode, weekStart, message: lock.reason },
        { status },
      );
    }
    if (lock.mode === 'unavailable') {
      console.warn(`[geo-tracking] ${lock.reason}`);
    }

    // 1) 유료 플랜 회원 조회 (질문 재료가 있는 사용자만 실제 질의)
    const { count: paidTotal } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .in('plan', PAID_PLAN_IDS);

    const { data, error } = await admin
      .from('profiles')
      .select('id, hospital_name, region, specialty, hospital_keywords, naver_blog_url')
      .in('plan', PAID_PLAN_IDS)
      .order('id', { ascending: true })
      .limit(MAX_USERS);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const profiles = (data ?? []) as ProfileRow[];

    // 2) 이번 주 중복 확인 (2차 방어선) — 확인 불가면 진행하지 않는다(이중 과금 방지)
    const already = await fetchAlreadyCheckedUserIds(
      admin,
      `${weekStart}T00:00:00.000Z`,
      profiles.map((p) => p.id),
    );
    if (already.error || already.incomplete) {
      const reason = already.error ?? `중복 확인 조회가 상한(${WEEK_ROWS_LOOKUP_LIMIT})에 닿아 신뢰할 수 없습니다.`;
      console.error('[geo-tracking] 중복 확인 실패로 중단(이중 과금 방지):', reason);
      return NextResponse.json(
        { ok: false, mode: 'aborted', weekStart, error: `중복 확인 실패로 중단: ${reason}` },
        { status: 500 },
      );
    }

    // 3) 질의 계획 수립 — 질문 재료·인용 판정 대상이 모두 있고, 이번 주 미처리인 회원만
    const plans: UserQuestionPlan[] = [];
    const targets = new Map<string, CitationTarget>();
    let skippedNoMaterial = 0;
    let skippedAlreadyChecked = 0;

    for (const profile of profiles) {
      if (already.ids.has(profile.id)) {
        skippedAlreadyChecked++;
        continue;
      }
      const questions = buildGeoQuestions({
        region: profile.region,
        specialty: profile.specialty,
        hospitalKeywords: profile.hospital_keywords,
      });
      const naverBlogId = extractNaverBlogId(profile.naver_blog_url);
      // 인용 판정 대상(병원명·블로그)이 없으면 질의해도 의미가 없다
      if (questions.length === 0 || (!profile.hospital_name && !naverBlogId)) {
        skippedNoMaterial++;
        continue;
      }
      plans.push({ userId: profile.id, questions });
      targets.set(profile.id, { hospitalName: profile.hospital_name, naverBlogId });
    }

    // 4) 고유 질의문 수 기준으로 상한 적용 (중복 질의는 캐시로 1회만 호출되므로 예산을 덜 쓴다)
    const capped = capQuestionPlan(plans, maxUniqueQuestionsFor(engines.length));

    // 5) 엔진별 병렬 실행 — 캐시가 (엔진, 질의문) 중복 호출을 제거한다
    const { cache, stats, failures, httpAttempts, deadlineReached } = await executeGeoQueries({
      questions: capped.uniqueQuestions,
      engines,
      env: process.env,
      deadlineAt: queryDeadlineAt,
    });

    for (const failure of failures.slice(0, MAX_REPORTED_FAILURES)) {
      console.error(`[geo-tracking] ${failure.engine} 질의 실패: ${failure.question} — ${failure.reason}`);
    }
    if (deadlineReached) {
      console.warn('[geo-tracking] 질의 데드라인 도달 — 미완료 질의를 취소하고 저장 단계로 넘어갑니다.');
    }

    // 6) 회원별 인용 판정 — 병원명이 다르므로 캐시된 응답을 회원 수만큼 각각 판정한다.
    //    ★ 계획된 (질문 × 엔진) 조합이 하나라도 비면 그 회원은 통째로 버린다.
    //      부분 표본으로 인용률을 계산하면 조용히 왜곡되기 때문이다.
    const userRowGroups: GeoCitationInsert[][] = [];
    let citedCount = 0;
    let usersDroppedPartialFailure = 0;
    let unresolvedResults = 0;

    for (const plan of capped.kept) {
      const target = targets.get(plan.userId);
      if (!target) continue;

      const rows: GeoCitationInsert[] = [];
      let cited = 0;
      let complete = true;

      for (const question of plan.questions) {
        for (const engine of engines) {
          const outcome = cache.peek(engine.id, question);
          if (!outcome || !outcome.ok) {
            // 데드라인·상한으로 실행되지 않았거나 엔진이 실패한 조합 (failures[] 에 이미 기록)
            unresolvedResults++;
            complete = false;
            continue;
          }
          const result = detectCitation(
            { text: outcome.answer.text, sourceUrls: outcome.answer.sources.map((s) => s.url) },
            { hospitalName: target.hospitalName, naverBlogId: target.naverBlogId },
          );
          if (result.cited) cited++;
          // 저장 최소화: 응답 원문 전체가 아니라 발췌+출처 목록만 raw 에 보관
          rows.push({
            user_id: plan.userId,
            question,
            engine: engine.id,
            cited: result.cited,
            citation_type: result.citationType,
            evidence: result.evidence,
            raw: {
              sources: outcome.answer.sources.map((s) => ({ url: s.url, title: s.title })),
              excerpt: sanitizeExcerpt(outcome.answer.text, RAW_EXCERPT_LENGTH),
            },
          });
        }
      }

      if (!complete) {
        usersDroppedPartialFailure++;
        continue; // 부분 실패 회원은 저장하지 않는다
      }
      citedCount += cited;
      userRowGroups.push(rows);
    }

    // 7) 배치 insert — 회원 경계를 가르지 않게 청킹하고, 저장 데드라인 안에서만 수행한다.
    //    남은 시간이 부족하면 더 넣지 않고 중단 사실을 응답에 명시한다(조용한 부분 저장 금지).
    const chunks = chunkGroups(userRowGroups, INSERT_CHUNK_SIZE);
    let inserted = 0;
    let chunksSkippedByDeadline = 0;
    let insertAborted = false;
    const insertErrors: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const signal = deadlineSignal(saveDeadlineAt, INSERT_CHUNK_TIMEOUT_MS, MIN_INSERT_WINDOW_MS);
      if (!signal) {
        insertAborted = true;
        chunksSkippedByDeadline = chunks.length - i;
        console.error(
          `[geo-tracking] 저장 데드라인 도달 — 남은 청크 ${chunksSkippedByDeadline}건을 저장하지 못했습니다.`,
        );
        break;
      }
      const { error: insErr } = await admin.from('geo_citations').insert(chunks[i]).abortSignal(signal);
      if (insErr) {
        if (insertErrors.length < MAX_REPORTED_FAILURES) insertErrors.push(insErr.message);
        console.error('[geo-tracking] geo_citations 배치 insert 실패:', insErr.message);
        continue;
      }
      inserted += chunks[i].length;
    }

    const plannedApiCalls = capped.kept.reduce((sum, p) => sum + p.questions.length, 0) * engines.length;
    const actualApiCalls = stats.reduce((sum, s) => sum + s.calls, 0);

    // 8) 실행 잠금 마무리 (관측용). 실패해도 본 작업 결과에는 영향이 없다.
    if (lock.mode === 'acquired') {
      const finalizeSignal = AbortSignal.timeout(LOCK_FINALIZE_TIMEOUT_MS);
      const { error: finErr } = await admin
        .from('geo_tracking_runs')
        .update({
          finished_at: new Date().toISOString(),
          status: 'done',
          users: userRowGroups.length,
          inserted,
          http_attempts: httpAttempts,
        })
        .eq('week_start', weekStart)
        .abortSignal(finalizeSignal);
      if (finErr) console.error('[geo-tracking] 실행 잠금 마무리 실패:', finErr.message);
    }

    return NextResponse.json({
      ok: true,
      mode: 'live',
      weekStart,
      lock: { mode: lock.mode, note: lock.reason },
      engines: engines.map((e) => e.id),
      users: userRowGroups.length,
      inserted,
      cited: citedCount,
      // 상한/데드라인/부분실패 때문에 빠진 것들 — 침묵 실패 방지용 명시
      truncated: {
        // MAX_USERS 를 넘겨 조회조차 되지 않은 유료 회원 수
        usersOverFetchLimit: Math.max(0, (paidTotal ?? 0) - profiles.length),
        // 고유 질의 상한에 걸려 이번 실행에서 제외된 회원 수
        usersOverQueryBudget: capped.truncatedUsers,
        questionsDropped: capped.droppedQuestions,
        // 계획 조합이 하나라도 실패해 통째로 버린 회원 수 (전부 아니면 전무)
        usersDroppedPartialFailure,
        // 결과를 얻지 못한 (회원 × 질문 × 엔진) 조합 수
        unresolvedResults,
        deadlineReached,
        // 저장 데드라인에 걸려 넣지 못한 청크 수
        insertAborted,
        chunksSkippedByDeadline,
      },
      skippedNoMaterial,
      // 이번 주에 이미 기록이 있어 건너뛴 회원 수 (중복 실행 2차 방어)
      skippedAlreadyChecked,
      queries: {
        uniqueQuestions: capped.uniqueQuestions.length,
        plannedApiCalls,
        actualApiCalls,
        // 캐시로 제거한 중복 호출 수
        dedupedApiCalls: Math.max(0, plannedApiCalls - actualApiCalls),
        // 재시도를 포함한 실제 외부 HTTP 요청 수 (비용 산정의 정본)
        httpAttempts,
      },
      elapsedMs: Date.now() - startedAt,
      engineStats: stats,
      // 응답 직렬화 시간을 묶기 위해 길이를 제한한다
      failures: failures.slice(0, MAX_REPORTED_FAILURES),
      failureCount: failures.length,
      insertErrors,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'cron failed';
    console.error('[geo-tracking] 배치 중단:', message);
    return NextResponse.json({ ok: false, error: message, lock: lock.mode }, { status: 500 });
  }
}
