// 매주 월요일 1회 실행 — AI 검색(GEO) 인용 추적 샘플링.
// 유료 플랜 회원별로 프로필(지역·진료과·키워드) 기반 질문 최대 3개를 생성해
// OpenAI 웹검색으로 실제 AI 답변을 받아, 병원명/블로그 URL 인용 여부를 geo_citations에 기록한다.
// 샘플링 결과이며 실제 사용자 노출과 다를 수 있다(UI에 동일 면책 표기).
// 인증: Authorization: Bearer ${CRON_SECRET} (기존 cron 패턴 동일). service role로 insert(RLS 우회).
// GEO_LIVE_QUERY=off 면 라이브 질의 전체 비활성 → 즉시 mode:'disabled' 반환(준비도 점수 모드만 운영).

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/dev/lib/cron-auth';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { PAID_PLAN_IDS } from '@/payment/lib/plans';
import { extractNaverBlogId } from '@/content/lib/rank-tracking';
import { isGeoLiveQueryEnabled, runGeoLiveQuery, GEO_QUERY_ENGINE } from '@/content/lib/geo-live-query';
import {
  buildGeoQuestions,
  detectCitation,
  sanitizeExcerpt,
} from '@/content/lib/geo-tracking';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// 비용/부하 방어 상한
const MAX_USERS = 100;          // 1회 실행 사용자 상한 (사용자당 최대 3질의)
const MAX_TOTAL_QUERIES = 200;  // 1회 실행 전체 질의 상한
const THROTTLE_MS = 500;        // 질의 사이 지연 (OpenAI RPM 방어)
const RAW_EXCERPT_LENGTH = 300; // raw 에 보관하는 응답 발췌 길이 (전체 원문 저장 금지)

interface ProfileRow {
  id: string;
  hospital_name: string | null;
  region: string | null;
  specialty: string | null;
  hospital_keywords: string[] | null;
  naver_blog_url: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isGeoLiveQueryEnabled()) {
    return NextResponse.json({
      ok: true,
      mode: 'disabled',
      message: 'GEO 라이브 질의가 비활성 상태입니다 (GEO_LIVE_QUERY=off 또는 OPENAI_API_KEY 미설정). 준비도 점수 모드만 운영됩니다.',
    });
  }

  const admin = createAdminClient();
  let users = 0;
  let queries = 0;
  let inserted = 0;
  let citedCount = 0;
  const failures: Array<{ userId: string; question: string; reason: string }> = [];

  try {
    // 유료 플랜 회원만 대상 (질문 재료가 있는 사용자만 실제 질의)
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

    for (const profile of profiles) {
      if (queries >= MAX_TOTAL_QUERIES) break;

      const questions = buildGeoQuestions({
        region: profile.region,
        specialty: profile.specialty,
        hospitalKeywords: profile.hospital_keywords,
      });
      if (questions.length === 0) continue; // 질문 재료 부족 → 스킵

      const target = {
        hospitalName: profile.hospital_name,
        naverBlogId: extractNaverBlogId(profile.naver_blog_url),
      };
      // 인용 판정 대상(병원명·블로그) 자체가 없으면 질의해도 의미 없음 → 스킵
      if (!target.hospitalName && !target.naverBlogId) continue;

      users++;

      for (const question of questions) {
        if (queries >= MAX_TOTAL_QUERIES) break;
        try {
          if (queries > 0) await sleep(THROTTLE_MS);
          queries++;

          const answer = await runGeoLiveQuery(question);
          const result = detectCitation(
            { text: answer.text, sourceUrls: answer.sources.map((s) => s.url) },
            target,
          );

          // 저장 최소화: 응답 원문 전체가 아니라 발췌+출처 목록만 raw 에 보관
          const { error: insErr } = await admin.from('geo_citations').insert({
            user_id: profile.id,
            question,
            engine: GEO_QUERY_ENGINE,
            cited: result.cited,
            citation_type: result.citationType,
            evidence: result.evidence,
            raw: {
              sources: answer.sources,
              excerpt: sanitizeExcerpt(answer.text, RAW_EXCERPT_LENGTH),
            },
          });
          if (insErr) {
            failures.push({ userId: profile.id, question, reason: insErr.message });
            continue;
          }
          inserted++;
          if (result.cited) citedCount++;
        } catch (e) {
          // 개별 질의 실패는 기록만 하고 계속 진행 (전체 실패 금지)
          const reason = e instanceof Error ? e.message : 'unknown';
          failures.push({ userId: profile.id, question, reason });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      mode: 'live',
      users,
      queries,
      inserted,
      cited: citedCount,
      failures,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'cron failed';
    return NextResponse.json(
      { ok: false, error: message, users, queries, inserted, cited: citedCount, failures },
      { status: 500 },
    );
  }
}
