import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { parseBlogCheckInput } from '@/content/lib/blog-check-input';
import {
  runBlogCheck,
  toSimpleResult,
  blogCheckCacheKey,
  BLOG_CHECK_CACHE_TTL_MS,
  type BlogCheckReport,
  type BlogCheckRunResult,
} from '@/content/lib/blog-check';
import {
  consumeBlogCheckQuota,
  extractClientIp,
  joinOrStartSingleFlight,
  readBlogCheckLimits,
} from '@/content/lib/blog-check-limits';
import { cacheGet, cacheSet } from '@/content/lib/scoreboard/cache';

export const dynamic = 'force-dynamic';
// RSS 10s + 본문 2×10s + 실측(검색량 2콜·blog.json ≤10콜) + LLM 요약 12s 여유치.
export const maxDuration = 60;

/**
 * POST /api/blog-check — 네이버 블로그 무료진단 간단분석 (비회원 공개).
 * body: { blog: string } — 블로그 주소 또는 ID.
 *
 * 가드:
 * - 입력 검증: blogId [a-z0-9_-]{3,30}, URL 은 blog.naver.com/m.blog.naver.com 만
 * - 실행 캡: IP당 일 3회 + 전체 일 100회 (env 조절, 캐시 히트는 캡 미소비)
 * - 결과 캐시: blogId 당 7일 (인메모리 — 인스턴스 생존 기간 best-effort)
 * - 리드 적재: blog_id + 블로그명(병원명 추정) → blog_check_leads (service role, 그레이스풀)
 *
 * 컴플라이언스: 응답은 공개 지표 기반 점수·장단점만 — 매출·방문자 추정 없음,
 * 타 병원 비교 없음. 심화 지적 본문은 서버에서 제거(티저만) — 회원 전용.
 */

/** 실행 캡 카운터 (인메모리, dev HMR 생존). */
const QUOTA_KEY = '__dp_blog_check_quota__';
function getQuotaStore(): Map<string, number> {
  const g = globalThis as Record<string, unknown>;
  if (!(g[QUOTA_KEY] instanceof Map)) {
    g[QUOTA_KEY] = new Map<string, number>();
  }
  return g[QUOTA_KEY] as Map<string, number>;
}

/**
 * 캐시 스탬피드 방지 — blogId 별 in-flight Promise 공유(single-flight).
 * 같은 blogId 의 동시 캐시 미스 N건이 전부 풀 파이프라인을 돌지 않도록,
 * 첫 요청(리더)의 Promise 를 나머지가 공유한다. 완료·실패 시 맵에서 제거.
 */
const INFLIGHT_KEY = '__dp_blog_check_inflight__';
function getInflightMap(): Map<string, Promise<BlogCheckRunResult>> {
  const g = globalThis as Record<string, unknown>;
  if (!(g[INFLIGHT_KEY] instanceof Map)) {
    g[INFLIGHT_KEY] = new Map<string, Promise<BlogCheckRunResult>>();
  }
  return g[INFLIGHT_KEY] as Map<string, Promise<BlogCheckRunResult>>;
}

/** 리드 적재 — 실패해도 진단 응답을 막지 않는다 (테이블 미적용 포함 그레이스풀). */
async function saveLead(blogId: string, blogTitle: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('blog_check_leads').insert({
      blog_id: blogId,
      blog_title: blogTitle.slice(0, 120),
      source: 'blog-check',
    });
    if (error) {
      console.error('[blog-check] 리드 적재 실패(무시):', error.message);
    }
  } catch (e) {
    console.error('[blog-check] 리드 적재 예외(무시):', e instanceof Error ? e.message : e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const raw = (await req.json().catch(() => null)) as { blog?: unknown } | null;
    const blogId = parseBlogCheckInput(raw?.blog);
    if (!blogId) {
      return NextResponse.json(
        {
          error:
            '네이버 블로그 주소 또는 아이디를 확인해 주세요. 예: blog.naver.com/myclinic 또는 myclinic',
        },
        { status: 400 },
      );
    }

    // 1) 캐시 히트 — 실행 캡을 소비하지 않고 바로 반환 (7일)
    const cached = cacheGet<BlogCheckReport>(blogCheckCacheKey(blogId));
    if (cached) {
      return NextResponse.json({ result: toSimpleResult(cached), cached: true });
    }

    // 2+3) single-flight 조인 → 리더만 실행 캡 소비 (IP당 일 3회 + 전체 일 100회)
    //      — in-flight 확인이 쿼터보다 먼저: 같은 blogId 의 동시 요청(팔로워)은
    //        무과금으로 리더의 파이프라인 Promise 에 조인한다. 파이프라인 1회에
    //        IP 일일 허용량이 전부 소진되는 문제 방지.
    const join = joinOrStartSingleFlight(
      getInflightMap(),
      blogId,
      () =>
        consumeBlogCheckQuota(getQuotaStore(), {
          ip: extractClientIp(req.headers),
          limits: readBlogCheckLimits(),
        }),
      () => runBlogCheck(blogId),
    );
    if (!join.ok) {
      const message =
        join.reason === 'ip_limit'
          ? '무료진단은 하루 3회까지 이용할 수 있어요. 내일 다시 시도해 주세요.'
          : '오늘 무료진단 사용량이 모두 소진됐어요. 내일 다시 시도해 주세요.';
      return NextResponse.json({ error: message }, { status: 429 });
    }
    const { isLeader } = join;
    const run = await join.promise;
    if (!run.ok) {
      const message =
        run.reason === 'empty'
          ? '블로그에 발행된 글이 없어요. 글을 발행한 뒤 다시 진단해 주세요.'
          : '블로그를 찾을 수 없거나 RSS가 비공개예요. 주소를 확인하거나 블로그 RSS 공개 설정을 확인해 주세요.';
      return NextResponse.json({ error: message }, { status: 422 });
    }

    // 4) 캐시 저장(7일) + 리드 적재 — 리더 1회만 (팔로워 중복 적재 방지, 그레이스풀)
    if (isLeader) {
      cacheSet(blogCheckCacheKey(blogId), run.report, BLOG_CHECK_CACHE_TTL_MS);
      await saveLead(blogId, run.report.blogTitle);
    }

    return NextResponse.json({ result: toSimpleResult(run.report), cached: false });
  } catch (err) {
    console.error('[blog-check]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: '진단 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    );
  }
}
