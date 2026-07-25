// 매주 월요일 1회 실행 — AI 검색(GEO) 인용 추적 샘플링. (주기는 주 1회 유지)
// 유료 플랜 회원별로 프로필(지역·진료과·키워드) 기반 질문 최대 5개를 생성해
// 설정된 AI 검색 엔진(OpenAI · Perplexity · Gemini)에 각각 질의하고,
// 병원명/블로그 URL 인용 여부를 geo_citations 에 기록한다(engine 컬럼에 엔진 식별자).
// 샘플링 결과이며 실제 사용자 노출과 다를 수 있다(UI에 동일 면책 표기).
// 인증: Authorization: Bearer ${CRON_SECRET} (기존 cron 패턴 동일). service role로 insert(RLS 우회).
//
// 안전장치:
//  · API 키가 없는 엔진은 조용히 건너뛴다. 하나도 없으면 mode:'disabled'
//    → 새 환경변수를 넣지 않아도 기존과 동일하게(OpenAI 단독) 동작한다.
//  · 한 엔진이 실패해도 나머지 엔진은 계속 돈다. 실패는 failures[] 로 노출.
//  · 상한/데드라인에 걸려 잘린 회원 수를 응답에 명시한다(침묵 실패 금지).
//  · 같은 (엔진, 질의문)은 실행 중 메모리 캐시로 1회만 호출한다.

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/dev/lib/cron-auth';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { PAID_PLAN_IDS } from '@/payment/lib/plans';
import { extractNaverBlogId } from '@/content/lib/rank-tracking';
import { executeGeoQueries, getEnabledEngines } from '@/content/lib/geo-engines';
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
  sanitizeExcerpt,
} from '@/content/lib/geo-tracking';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** raw 에 보관하는 응답 발췌 길이 (전체 원문 저장 금지) */
const RAW_EXCERPT_LENGTH = 300;
/** geo_citations 배치 insert 청크 크기 — 행 수가 늘어 1건씩 넣으면 시간 예산을 잠식한다 */
const INSERT_CHUNK_SIZE = 200;

interface ProfileRow {
  id: string;
  hospital_name: string | null;
  region: string | null;
  specialty: string | null;
  hospital_keywords: string[] | null;
  naver_blog_url: string | null;
}

interface CitationTargetRow {
  readonly userId: string;
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

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

    // 2) 질의 계획 수립 — 질문 재료·인용 판정 대상이 모두 있는 회원만
    const plans: UserQuestionPlan[] = [];
    const targets = new Map<string, CitationTargetRow>();
    let skippedNoMaterial = 0;

    for (const profile of profiles) {
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
      targets.set(profile.id, {
        userId: profile.id,
        hospitalName: profile.hospital_name,
        naverBlogId,
      });
    }

    // 3) 고유 질의문 수 기준으로 상한 적용 (중복 질의는 캐시로 1회만 호출되므로 예산을 덜 쓴다)
    const capped = capQuestionPlan(plans, maxUniqueQuestionsFor(engines.length));

    // 4) 엔진별 병렬 실행 — 캐시가 (엔진, 질의문) 중복 호출을 제거한다
    const { cache, stats, failures } = await executeGeoQueries({
      questions: capped.uniqueQuestions,
      engines,
      env: process.env,
      deadlineAt,
    });

    for (const failure of failures) {
      console.error(`[geo-tracking] ${failure.engine} 질의 실패: ${failure.question} — ${failure.reason}`);
    }

    // 5) 회원별 인용 판정 — 병원명이 다르므로 캐시된 응답을 회원 수만큼 각각 판정한다
    const rows: GeoCitationInsert[] = [];
    let citedCount = 0;
    let unresolved = 0;

    for (const plan of capped.kept) {
      const target = targets.get(plan.userId);
      if (!target) continue;
      for (const question of plan.questions) {
        for (const engine of engines) {
          const outcome = cache.peek(engine.id, question);
          if (!outcome || !outcome.ok) {
            // 데드라인·상한으로 실행되지 않았거나 엔진이 실패한 조합 (failures[] 에 이미 기록)
            unresolved++;
            continue;
          }
          const result = detectCitation(
            { text: outcome.answer.text, sourceUrls: outcome.answer.sources.map((s) => s.url) },
            { hospitalName: target.hospitalName, naverBlogId: target.naverBlogId },
          );
          if (result.cited) citedCount++;
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
    }

    // 6) 배치 insert — 청크 단위 실패는 기록만 하고 나머지 청크는 계속 넣는다
    let inserted = 0;
    const insertErrors: string[] = [];
    for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
      const { error: insErr } = await admin.from('geo_citations').insert(chunk);
      if (insErr) {
        insertErrors.push(insErr.message);
        console.error('[geo-tracking] geo_citations 배치 insert 실패:', insErr.message);
        continue;
      }
      inserted += chunk.length;
    }

    const apiCalls = stats.reduce((sum, s) => sum + s.calls, 0);
    const plannedApiCalls = capped.kept.reduce((sum, p) => sum + p.questions.length, 0) * engines.length;

    return NextResponse.json({
      ok: true,
      mode: 'live',
      engines: engines.map((e) => e.id),
      users: capped.kept.length,
      inserted,
      cited: citedCount,
      // 상한/데드라인 때문에 잘려나간 것들 — 침묵 실패 방지용 명시
      truncated: {
        // MAX_USERS 를 넘겨 조회조차 되지 않은 유료 회원 수
        usersOverFetchLimit: Math.max(0, (paidTotal ?? 0) - profiles.length),
        // 고유 질의 상한에 걸려 이번 실행에서 제외된 회원 수
        usersOverQueryBudget: capped.truncatedUsers,
        questionsDropped: capped.droppedQuestions,
        // 데드라인·엔진 실패로 결과를 얻지 못한 (회원 × 질문 × 엔진) 수
        unresolvedResults: unresolved,
      },
      skippedNoMaterial,
      queries: {
        uniqueQuestions: capped.uniqueQuestions.length,
        plannedApiCalls,
        actualApiCalls: apiCalls,
        // 캐시로 제거한 중복 호출 수
        dedupedApiCalls: Math.max(0, plannedApiCalls - apiCalls),
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
