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
//  · 질의 데드라인(240초)과 저장 몫(≈60초)을 분리해 **DB 저장 단계에는 반드시 도달**한다.
//  · 회원 단위 "전부 아니면 전무" — 계획된 조합이 하나라도 실패하면 그 회원은 저장하지 않는다.
//  · 같은 주(월요일 기준)에 이미 기록이 있는 회원은 건너뛴다(cron 중복 실행 방어).

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/dev/lib/cron-auth';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { PAID_PLAN_IDS } from '@/payment/lib/plans';
import { extractNaverBlogId } from '@/content/lib/rank-tracking';
import { executeGeoQueries, getEnabledEngines } from '@/content/lib/geo-engines';
import { chunkGroups } from '@/content/lib/geo-engines/batching';
import {
  MAX_USERS,
  QUERY_DEADLINE_MS,
  capQuestionPlan,
  maxUniqueQuestionsFor,
  type UserQuestionPlan,
} from '@/content/lib/geo-engines/budget';
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
/** 중복 실행 방어용 조회 상한 (100명 × 5질의 × 3엔진 = 1,500 대비 여유) */
const RECENT_ROWS_LOOKUP_LIMIT = 3_000;
/** 테이블 없음 — 마이그 037 미적용 DB 폴백용 코드 */
const PG_UNDEFINED_TABLE = '42P01';

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

/**
 * 이번 주(월요일 UTC 기준)에 이미 기록이 있는 회원 id 집합.
 *
 * cron 이 두 번 호출되면 외부 API 비용이 이중 발생하고 같은 주차 데이터가
 * 중복 삽입되어 인용률이 왜곡된다. 메모리 캐시는 단일 요청 안에서만 막아 준다.
 * 새 테이블 없이 기존 geo_citations.checked_at 만으로 판정한다.
 */
async function fetchAlreadyCheckedUserIds(
  admin: AdminClient,
  weekStartIso: string,
): Promise<{ ids: ReadonlySet<string>; error: string | null }> {
  const { data, error } = await admin
    .from('geo_citations')
    .select('user_id')
    .gte('checked_at', weekStartIso)
    .limit(RECENT_ROWS_LOOKUP_LIMIT);

  if (error) {
    // 테이블 자체가 없으면 중복도 있을 수 없다 → 빈 집합으로 진행
    if (error.code === PG_UNDEFINED_TABLE) return { ids: new Set(), error: null };
    return { ids: new Set(), error: error.message };
  }

  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{ user_id: string | null }>) {
    if (row.user_id) ids.add(row.user_id);
  }
  return { ids, error: null };
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 질의 데드라인과 저장 몫을 분리한다. 질의는 240초 안에 끝내고
  // 남은 시간(≈60초)을 배치 insert·응답에 쓴다 → 저장 단계에 반드시 도달한다.
  const deadlineAt = Date.now() + QUERY_DEADLINE_MS;
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

  try {
    // 0) 중복 실행 방어 — 이번 주에 이미 처리된 회원은 제외
    const weekStart = mondayOfWeek(new Date().toISOString());
    const weekStartIso = weekStart ? `${weekStart}T00:00:00.000Z` : null;
    const already = weekStartIso
      ? await fetchAlreadyCheckedUserIds(admin, weekStartIso)
      : { ids: new Set<string>(), error: null };
    if (already.error) {
      console.error('[geo-tracking] 중복 실행 방어 조회 실패(전체 진행으로 폴백):', already.error);
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

    // 2) 질의 계획 수립 — 질문 재료·인용 판정 대상이 모두 있고, 이번 주 미처리인 회원만
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

    // 3) 고유 질의문 수 기준으로 상한 적용 (중복 질의는 캐시로 1회만 호출되므로 예산을 덜 쓴다)
    const capped = capQuestionPlan(plans, maxUniqueQuestionsFor(engines.length));

    // 4) 엔진별 병렬 실행 — 캐시가 (엔진, 질의문) 중복 호출을 제거한다
    const { cache, stats, failures, httpAttempts, deadlineReached } = await executeGeoQueries({
      questions: capped.uniqueQuestions,
      engines,
      env: process.env,
      deadlineAt,
    });

    for (const failure of failures) {
      console.error(`[geo-tracking] ${failure.engine} 질의 실패: ${failure.question} — ${failure.reason}`);
    }
    if (deadlineReached) {
      console.warn('[geo-tracking] 질의 데드라인 도달 — 미완료 질의를 취소하고 저장 단계로 넘어갑니다.');
    }

    // 5) 회원별 인용 판정 — 병원명이 다르므로 캐시된 응답을 회원 수만큼 각각 판정한다.
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

    // 6) 배치 insert — 회원 경계를 가르지 않게 청킹한다.
    //    청크 실패는 기록만 하고 나머지 청크는 계속 넣는다.
    const chunks = chunkGroups(userRowGroups, INSERT_CHUNK_SIZE);
    let inserted = 0;
    const insertErrors: string[] = [];
    for (const chunk of chunks) {
      const { error: insErr } = await admin.from('geo_citations').insert(chunk);
      if (insErr) {
        insertErrors.push(insErr.message);
        console.error('[geo-tracking] geo_citations 배치 insert 실패:', insErr.message);
        continue;
      }
      inserted += chunk.length;
    }

    const plannedApiCalls = capped.kept.reduce((sum, p) => sum + p.questions.length, 0) * engines.length;
    const actualApiCalls = stats.reduce((sum, s) => sum + s.calls, 0);

    return NextResponse.json({
      ok: true,
      mode: 'live',
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
      },
      skippedNoMaterial,
      // 이번 주에 이미 기록이 있어 건너뛴 회원 수 (cron 중복 실행 방어)
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
      engineStats: stats,
      failures,
      insertErrors,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'cron failed';
    console.error('[geo-tracking] 배치 중단:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
