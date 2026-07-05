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
    if (rowsErr) {
      return NextResponse.json({ error: rowsErr.message }, { status: 500 });
    }
    const rows = (rowsData ?? []) as CitationDbRow[];

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

    return NextResponse.json({
      liveEnabled: isGeoLiveQueryEnabled(),
      latest,
      weekly,
      readiness,
      checkedPostCount: posts.length,
    } satisfies GeoTabResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
