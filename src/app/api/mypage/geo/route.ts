// 마이페이지 AI 검색(GEO) 탭 — 최근 인용 체크 결과 + 주간 인용률 추이 + GEO 준비도 점수.
// 모든 데이터는 본인 것만(RLS + user_id). 라이브 질의 비활성 환경에서도
// 준비도 점수 섹션만으로 탭이 성립한다(liveEnabled 플래그로 UI 분기).

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { isGeoLiveQueryEnabled } from '@/content/lib/geo-live-query';
import {
  aggregateWeeklyCitations,
  scoreGeoReadiness,
  type GeoReadinessScore,
  type WeeklyCitationPoint,
} from '@/content/lib/geo-tracking';
import { kstDateKey } from '@/content/lib/ai-referral/request';
import {
  AI_REFERRAL_WINDOW_DAYS,
  aiReferralWindowStart,
  emptyAiReferralSummary,
  summarizeAiReferrals,
  type AiReferralDbRow,
  type AiReferralSummary,
} from '@/content/lib/ai-referral/summary';

export const dynamic = 'force-dynamic';

const LOOKBACK_DAYS = 56;        // 최근 8주
const MAX_ROWS = 400;            // 인용 기록 조회 상한
const MAX_READINESS_POSTS = 20;  // 준비도 검사 대상 발행글 수
const MAX_AI_REFERRAL_ROWS = 800; // AI 유입 집계 행 조회 상한 (병원×출처×글×일 grain)

interface CitationDbRow {
  id: string;
  question: string;
  engine: string;
  cited: boolean;
  citation_type: string | null;
  evidence: string | null;
  checked_at: string;
}

export interface GeoCheckItem {
  id: string;
  question: string;
  engine: string;
  cited: boolean;
  citationType: 'hospital_name' | 'blog_url' | 'none';
  evidence: string | null;
  checkedAt: string;
}

export interface GeoTabResponse {
  liveEnabled: boolean;
  /** 가장 최근 체크 회차의 질문별 결과 */
  latest: GeoCheckItem[];
  /** 최근 8주 주간 인용률 추이 (과거 → 현재) */
  weekly: WeeklyCitationPoint[];
  /** 발행 글 GEO 구조 준비도. null = 발행 글 없음 */
  readiness: GeoReadinessScore | null;
  /** 준비도 검사에 사용한 글 수 */
  checkedPostCount: number;
  /**
   * AI 검색에서 병원 블로그로 실제 넘어온 방문의 최근 30일 집계.
   * 인용(latest/weekly)은 "언급됐는가", 이쪽은 "사람이 왔는가" — 서로 다른 지표다.
   * 데이터 0건·마이그 048 미적용에서도 빈 요약이 들어와 화면이 깨지지 않는다.
   */
  aiReferral: AiReferralSummary;
  /** 병원 블로그(서브도메인) 개설 여부. 미개설이면 유입 집계 대상 자체가 없다. */
  clinicSiteEnabled: boolean;
}

interface AiReferralQueryRow {
  visit_date: string;
  source: string;
  post_id: string | null;
  visits: number;
}

function toCitationType(value: string | null): GeoCheckItem['citationType'] {
  return value === 'hospital_name' || value === 'blog_url' ? value : 'none';
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);

    // 1) 최근 8주 인용 기록 (RLS로 본인 것만, 최신순)
    const { data: rowsData, error: rowsErr } = await supabase
      .from('geo_citations')
      .select('id, question, engine, cited, citation_type, evidence, checked_at')
      .gte('checked_at', since.toISOString())
      .order('checked_at', { ascending: false })
      .limit(MAX_ROWS);
    // 마이그 037(geo_citations) 미적용 DB 폴백 — 테이블 없음(42P01)이면
    // 인용 기록만 비운 채 준비도 점수는 계속 제공한다(탭 자체를 막지 않는다).
    if (rowsErr && rowsErr.code !== '42P01') {
      return NextResponse.json({ error: rowsErr.message }, { status: 500 });
    }
    const rows = (rowsErr ? [] : (rowsData ?? [])) as CitationDbRow[];

    // 2) 최신 회차 결과 — 가장 최근 checked_at 과 같은 날짜(UTC)의 기록
    let latest: GeoCheckItem[] = [];
    if (rows.length > 0) {
      const latestDay = rows[0].checked_at.slice(0, 10);
      latest = rows
        .filter((r) => r.checked_at.slice(0, 10) === latestDay)
        .map((r) => ({
          id: r.id,
          question: r.question,
          engine: r.engine,
          cited: r.cited,
          citationType: toCitationType(r.citation_type),
          evidence: r.evidence,
          checkedAt: r.checked_at,
        }));
    }

    // 3) 주간 인용률 추이 (과거 → 현재)
    const weekly = aggregateWeeklyCitations(
      rows.map((r) => ({ checkedAt: r.checked_at, cited: r.cited })),
    );

    // 4) GEO 준비도 점수 — 최근 발행 글 구조 규칙 검사 (라이브 질의와 무관하게 항상 제공)
    const { data: postsData } = await supabase
      .from('saved_posts')
      .select('title, content')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(MAX_READINESS_POSTS);
    const posts = (postsData ?? []) as Array<{ title: string; content: string }>;
    const readiness = scoreGeoReadiness(
      posts.map((p) => ({ title: p.title ?? '', content: p.content ?? '' })),
    );

    // 5) AI 검색 유입 실측 — 최근 30일 (RLS로 본인 병원 것만)
    const endDate = kstDateKey();
    const startDate = aiReferralWindowStart(endDate, AI_REFERRAL_WINDOW_DAYS);
    const { data: refData, error: refErr } = await supabase
      .from('clinic_ai_referrals')
      .select('visit_date, source, post_id, visits')
      .gte('visit_date', startDate)
      .lte('visit_date', endDate)
      .order('visit_date', { ascending: false })
      .limit(MAX_AI_REFERRAL_ROWS);

    // 마이그 048 미적용 DB 폴백 — 테이블 없음(42P01)이면 빈 요약으로 계속 진행한다
    // (탭 전체를 500 으로 막지 않는다). 그 외 오류도 계측이므로 승격하지 않는다.
    let aiReferral: AiReferralSummary = emptyAiReferralSummary(endDate, AI_REFERRAL_WINDOW_DAYS);
    if (!refErr && refData) {
      const refRows = refData as unknown as AiReferralQueryRow[];

      // 글 제목은 별도 조회로 붙인다 (PostgREST 임베딩 형태 차이에 의존하지 않기 위함).
      // saved_posts 도 RLS 로 본인 글만 조회된다.
      const postIds = Array.from(
        new Set(refRows.map((r) => r.post_id).filter((id): id is string => typeof id === 'string')),
      );
      const titleById = new Map<string, string>();
      if (postIds.length > 0) {
        const { data: titleData } = await supabase
          .from('saved_posts')
          .select('id, title')
          .in('id', postIds);
        for (const row of (titleData ?? []) as Array<{ id: string; title: string | null }>) {
          titleById.set(row.id, row.title ?? '');
        }
      }

      const rows: AiReferralDbRow[] = refRows.map((r) => ({
        visitDate: r.visit_date,
        source: r.source,
        postId: r.post_id,
        postTitle: r.post_id ? (titleById.get(r.post_id) ?? null) : null,
        visits: r.visits,
      }));
      aiReferral = summarizeAiReferrals(rows, {
        endDate,
        windowDays: AI_REFERRAL_WINDOW_DAYS,
      });
    }

    // 6) 병원 블로그 개설 여부 — 미개설이면 유입 집계 자체가 성립하지 않아 안내가 달라진다
    const { data: profileData } = await supabase
      .from('profiles')
      .select('site_slug')
      .eq('id', user.id)
      .maybeSingle();
    const clinicSiteEnabled = Boolean(
      (profileData as { site_slug: string | null } | null)?.site_slug,
    );

    return NextResponse.json({
      liveEnabled: isGeoLiveQueryEnabled(),
      latest,
      weekly,
      readiness,
      checkedPostCount: posts.length,
      aiReferral,
      clinicSiteEnabled,
    } satisfies GeoTabResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
