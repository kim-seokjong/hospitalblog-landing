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

const LOOKBACK_DAYS = 56; // 최근 8주

/**
 * 인용 기록 조회 상한 — 회원 1명 기준으로 재산정.
 *
 * 이 쿼리는 createServerSupabaseClient(사용자 세션) 로 실행되고
 * geo_citations 에 "auth.uid() = user_id" RLS(마이그 037)가 걸려 있어
 * 구조적으로 본인 행만 조회된다. 아래 .eq('user_id', ...) 는 이중 방어다.
 *
 * 회원 1명의 8주 최대 행 수 = 8주 × 5질의 × 3엔진(옵트인 포함 최대) = 120행.
 * 여기에 수동 재실행·과거 3질의 데이터가 섞이는 경우까지 보고 5배 여유를 둔다.
 *   → 600행.
 * 상한에 걸리면(=rowsTruncated) 가장 오래된 주는 표본이 잘려 있으므로
 * 주간 추이에서 제외한다. 그러지 않으면 그 주 인용률만 조용히 왜곡된다.
 */
const MAX_ROWS = 600;
const MAX_READINESS_POSTS = 20; // 준비도 검사 대상 발행글 수

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
   * 조회 상한(MAX_ROWS)에 걸려 가장 오래된 주가 잘렸는가.
   * true 면 weekly 에서 그 주를 제외했다(부분 표본으로 인용률이 왜곡되는 것 방지).
   */
  rowsTruncated: boolean;
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
    // 상한 초과를 감지하려고 1건 더 요청한다(초과분은 아래에서 버린다)
    const { data: rowsData, error: rowsErr } = await supabase
      .from('geo_citations')
      .select('id, question, engine, cited, citation_type, evidence, checked_at')
      .eq('user_id', user.id) // RLS 로도 걸리지만 이중 방어
      .gte('checked_at', since.toISOString())
      .order('checked_at', { ascending: false })
      .limit(MAX_ROWS + 1);
    // 마이그 037(geo_citations) 미적용 DB 폴백 — 테이블 없음(42P01)이면
    // 인용 기록만 비운 채 준비도 점수는 계속 제공한다(탭 자체를 막지 않는다).
    if (rowsErr && rowsErr.code !== '42P01') {
      return NextResponse.json({ error: rowsErr.message }, { status: 500 });
    }
    const fetched = (rowsErr ? [] : (rowsData ?? [])) as CitationDbRow[];
    const rowsTruncated = fetched.length > MAX_ROWS;
    const rows = rowsTruncated ? fetched.slice(0, MAX_ROWS) : fetched;

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
    //    상한에 걸렸다면 가장 오래된 주는 행이 잘려 있어 인용률이 왜곡된다 → 제외.
    const aggregated = aggregateWeeklyCitations(
      rows.map((r) => ({ checkedAt: r.checked_at, cited: r.cited })),
    );
    const weekly = rowsTruncated && aggregated.length > 1 ? aggregated.slice(1) : aggregated;
    if (rowsTruncated) {
      console.warn(`[mypage/geo] 인용 기록 조회 상한(${MAX_ROWS}) 도달 — 최고령 주를 추이에서 제외`);
    }

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
      rowsTruncated,
    } satisfies GeoTabResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
