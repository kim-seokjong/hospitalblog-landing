import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import {
  analyzeCompetitorPosts,
  buildSearchQuery,
  fetchNaverBlogPosts,
  type CompetitorInsights,
  type NaverPost,
} from '@/content/lib/competitor-analysis';
import {
  computeContentGaps,
  fetchKeywordVolumes,
  type GapCandidate,
} from '@/content/lib/keyword-volume';
import { computePublishFrequency } from '@/content/lib/scoreboard/publish-frequency';

/**
 * POST /api/content-plan
 * body: { specialty, region, keyword? }
 *
 * 경쟁 모니터링(주제·키워드) + 내 발행이력 갭 분석 + 검색량 근거를 한 번에 묶어
 * "콘텐츠 기획서" 데이터를 반환한다. competitor-monitor 는 그대로 두고 조합한다.
 *
 * 반환:
 *  - posts: 경쟁 블로그 글
 *  - insights: { topics, keywords }
 *  - gaps: 경쟁자는 다루는데 내가 아직 안 쓴 주제(검색량 내림차순)
 *  - volumes available 여부는 gaps[].volume / 각 키워드 volume 으로 표현(없으면 null)
 *  - naverError?: 네이버 검색 실패 메시지(그레이스풀)
 */
interface RequestBody {
  specialty?: string;
  region?: string;
  keyword?: string;
}

interface SavedPostRow {
  title?: string | null;
  keyword?: string | null;
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
    const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';

    if (!specialty) {
      return NextResponse.json({ error: '진료과목을 입력해주세요.' }, { status: 400 });
    }
    if (!region) {
      return NextResponse.json({ error: '지역을 입력해주세요.' }, { status: 400 });
    }

    // 1) 경쟁 블로그 검색 (그레이스풀)
    const query = buildSearchQuery(specialty, region, keyword || undefined);
    let posts: NaverPost[] = [];
    let naverError: string | null = null;
    try {
      posts = await fetchNaverBlogPosts(query);
    } catch (err) {
      naverError = err instanceof Error ? err.message : '네이버 API 오류';
    }

    // 2) Claude 인사이트 (의료광고법 가드 포함)
    const insights: CompetitorInsights = await analyzeCompetitorPosts(posts);

    // 3) 내 발행이력(saved_posts) 조회 → 갭 분석 근거 (서버에서 RLS 적용 조회)
    const { data: myPosts } = await supabase
      .from('saved_posts')
      .select('title, keyword')
      .eq('user_id', user.id)
      .limit(200);

    const myCoveredText = ((myPosts ?? []) as SavedPostRow[])
      .flatMap((p) => [p.title ?? '', p.keyword ?? ''])
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0);

    // 4) 갭 후보 = 경쟁 주제 + 추천 키워드 (주제는 keyword 로 짧은 핵심어 추출이 어려우므로 text 그대로)
    const candidates = [
      ...insights.topics.map((t) => ({ text: t, keyword: t })),
      ...insights.keywords.map((k) => ({ text: k, keyword: k })),
    ];

    // 5) 검색량 근거 (그레이스풀 — 키 없으면 available:false, volumes 빈 객체)
    const volumeKeywords = [
      ...insights.keywords,
      ...(keyword ? [keyword] : []),
    ];
    const volumeResult = await fetchKeywordVolumes(volumeKeywords);

    // 6) 갭 = 내가 아직 안 다룬 후보, 검색량 내림차순
    const gaps: GapCandidate[] = computeContentGaps(
      candidates,
      myCoveredText,
      volumeResult.volumes
    );

    // 7) 발행 빈도 프록시 — 같은 검색 결과의 postdate 만 사용 (추가 API 없음)
    const publishFrequency = computePublishFrequency(posts);

    return NextResponse.json({
      posts,
      insights,
      gaps,
      volumes: volumeResult.volumes,
      volumeAvailable: volumeResult.available,
      publishFrequency,
      ...(naverError ? { naverError } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
