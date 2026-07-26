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
import { getAiReferralSummary } from '@/dev/lib/ai-referral-server';
import {
  AI_REFERRAL_WINDOW_DAYS,
  type AiReferralSummary,
} from '@/content/lib/ai-referral/summary';

export const dynamic = 'force-dynamic';

const LOOKBACK_DAYS = 56;        // 최근 8주
const MAX_ROWS = 400;            // 인용 기록 조회 상한
const MAX_READINESS_POSTS = 20;  // 준비도 검사 대상 발행글 수

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
   * 데이터 0건·마이그 051 미적용에서도 빈 요약이 들어와 화면이 깨지지 않는다.
   */
  aiReferral: AiReferralSummary;
  /** 병원 블로그(서브도메인) 개설 여부. 미개설이면 유입 집계 대상 자체가 없다. */
  clinicSiteEnabled: boolean;
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

    // 5) AI 검색 유입 실측 — 최근 30일.
    // 집계는 DB 함수(clinic_ai_referral_summary, SECURITY INVOKER → RLS 적용)가 한다.
    // 원시 행을 끌어와 합산하면 행 수 상한에 걸리는 순간 통계가 조용히 잘리기 때문에
    // 앱에서 LIMIT 기반으로 읽지 않는다. 마이그 051 미적용·오류면 빈 요약이 온다.
    const aiReferral: AiReferralSummary = await getAiReferralSummary(AI_REFERRAL_WINDOW_DAYS);

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
