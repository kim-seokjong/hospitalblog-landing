import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import {
  fetchPlaceDeep,
  fetchPlaceTopFive,
  findHospitalRank,
  type PlaceDeepItem,
} from '@/content/lib/scoreboard/place';

export const dynamic = 'force-dynamic';

/**
 * POST /api/competitor-place
 * body: { specialty, region, hospitalName? }
 *
 * 플레이스 상위노출 + 리뷰 수 (하이브리드).
 * - 1차(안전): 네이버 지역검색 OpenAPI 톱5 + 내 병원 "톱5 진입" 배지.
 * - 2차(베스트에포트): 공개 검색 JSON에서 상세 순위·방문자/블로그 리뷰 수.
 *   실패 시 조용히 1차만 반환. env PLACE_DEEP_LOOKUP=off 면 완전 비활성.
 * - 2차 성공 시 competitor_place_snapshots 에 스냅샷 저장 → 추이(리뷰 증감) 계산.
 */

interface RequestBody {
  specialty?: string;
  region?: string;
  hospitalName?: string;
}

interface DeepItemWithTrend extends PlaceDeepItem {
  visitorDelta: number | null;
  blogDelta: number | null;
}

interface SnapshotRow {
  hospital_name: string;
  visitor_reviews: number | null;
  blog_reviews: number | null;
  searched_at: string;
}

function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = (await req.json()) as RequestBody;
    const specialty = typeof body.specialty === 'string' ? body.specialty.trim() : '';
    const region = typeof body.region === 'string' ? body.region.trim() : '';
    const hospitalName = typeof body.hospitalName === 'string' ? body.hospitalName.trim() : '';

    if (!specialty || !region) {
      return NextResponse.json({ error: '진료과목과 지역을 입력해주세요.' }, { status: 400 });
    }
    if (specialty.length > 30 || region.length > 30 || hospitalName.length > 60) {
      return NextResponse.json({ error: '입력값이 너무 깁니다.' }, { status: 400 });
    }

    const query = `${region} ${specialty}`;

    // 1차: 지역검색 톱5 (키 없거나 실패 시 빈 배열 — graceful)
    const topFive = await fetchPlaceTopFive(query);
    const topFiveRank = hospitalName
      ? findHospitalRank(topFive.map((p) => p.name), hospitalName)
      : null;

    // 2차: 상세 순위·리뷰 수 (베스트에포트 — 실패 시 null)
    const deepItems = await fetchPlaceDeep(query);

    let deep: { items: DeepItemWithTrend[]; myRank: number | null } | null = null;
    let trendStatus: 'ready' | 'accumulating' | 'none' = 'none';

    if (deepItems && deepItems.length > 0) {
      // 이전 스냅샷 조회 (같은 회원·같은 검색어) → 리뷰 증감 계산
      const { data: prevRows, error: prevError } = await supabase
        .from('competitor_place_snapshots')
        .select('hospital_name, visitor_reviews, blog_reviews, searched_at')
        .eq('user_id', user.id)
        .eq('search_query', query)
        .order('searched_at', { ascending: false })
        .limit(50);

      if (prevError) {
        console.error('[competitor-place] 이전 스냅샷 조회 실패:', prevError.message);
      }

      const previousByName = new Map<string, SnapshotRow>();
      for (const row of (prevRows ?? []) as SnapshotRow[]) {
        if (!previousByName.has(row.hospital_name)) {
          previousByName.set(row.hospital_name, row);
        }
      }

      const items: DeepItemWithTrend[] = deepItems.map((item) => {
        const prev = previousByName.get(item.name);
        return {
          ...item,
          visitorDelta: prev ? delta(item.visitorReviews, prev.visitor_reviews) : null,
          blogDelta: prev ? delta(item.blogReviews, prev.blog_reviews) : null,
        };
      });

      trendStatus = previousByName.size > 0 ? 'ready' : 'accumulating';
      deep = {
        items,
        myRank: hospitalName ? findHospitalRank(items.map((i) => i.name), hospitalName) : null,
      };

      // 스냅샷 저장 (실패해도 응답은 유지 — 추이만 다음 기회에)
      const { error: insertError } = await supabase
        .from('competitor_place_snapshots')
        .insert(
          deepItems.map((item) => ({
            user_id: user.id,
            search_query: query,
            hospital_name: item.name,
            rank: item.rank,
            visitor_reviews: item.visitorReviews,
            blog_reviews: item.blogReviews,
          }))
        );
      if (insertError) {
        console.error('[competitor-place] 스냅샷 저장 실패:', insertError.message);
      }
    }

    return NextResponse.json({
      query,
      topFive: topFive.map((p) => ({
        name: p.name,
        category: p.category,
        address: p.roadAddress || p.address,
        link: p.link,
      })),
      topFiveRank,
      deep,
      deepAvailable: deep !== null,
      trendStatus,
    });
  } catch (err) {
    console.error('[competitor-place] 오류:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: '플레이스 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    );
  }
}
