import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { isAdmin } from '@/hr/lib/admin';
import { parseNaverBlogId, fetchNaverBlogPostItems } from '@/content/lib/naver-blog-fetch';
import { checkCompliance } from '@/content/lib/medical-compliance';
import { reviewComplianceWithAI } from '@/content/lib/medical-compliance-ai';
import {
  AUDIT_AI_REVIEW_LIMIT,
  AUDIT_BODY_MAX_CHARS,
  AUDIT_POST_LIMIT,
  applyAiFindings,
  buildAuditPost,
  buildAuditResults,
  cooldownEndsAt,
  isCooldownActive,
  type AuditPostResult,
  type BlogAuditResults,
} from '@/content/lib/compliance-report';

// 수집기 전체 예산 50초 + B층 LLM 심의 최대 5회를 고려한 여유치.
export const maxDuration = 120;

/** blog_audits 테이블 미적용(마이그 034 전) 판정 — 42P01(undefined_table). */
function isMissingAuditTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || (error.message?.includes('blog_audits') ?? false);
}

/**
 * POST /api/blog-audit — 기존 네이버 블로그 소급 진단 실행.
 *
 * body: { blogUrl?: string } — admin 전용(영업 시연). 일반 유저는 body 값을 무시하고
 * 프로필의 '내 블로그 주소'(naver_blog_url)만 사용한다(임의 블로그 스캔 방지).
 *
 * 흐름: 수집(최근 20편·본문 6000자) → 전 글 A층 checkCompliance →
 *       A층 위험점수 상위 5편만 B층 LLM 심의(비용 방어) → blog_audits 저장.
 * 재실행 쿨다운 24시간(최근 run_at 기준, admin 예외).
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const admin = isAdmin(user.email);

    // 진단 대상 블로그 결정 — 일반 유저는 본인 프로필 주소만, admin은 body 주소 허용.
    let blogInput = '';
    if (admin) {
      const raw = (await req.json().catch(() => null)) as { blogUrl?: unknown } | null;
      blogInput = typeof raw?.blogUrl === 'string' ? raw.blogUrl : '';
    }
    if (!blogInput) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('naver_blog_url')
        .eq('id', user.id)
        .single();
      blogInput =
        typeof (profile as { naver_blog_url?: unknown } | null)?.naver_blog_url === 'string'
          ? ((profile as { naver_blog_url: string }).naver_blog_url)
          : '';
    }

    const blogId = parseNaverBlogId(blogInput);
    if (!blogId) {
      return NextResponse.json(
        {
          error:
            '진단할 네이버 블로그 주소가 없습니다. 마이페이지 > 내 정보에서 "내 블로그 주소"를 먼저 입력해주세요. 예: blog.naver.com/myclinic',
        },
        { status: 400 },
      );
    }

    // 재실행 쿨다운 24시간 — 최근 run_at 검사(admin 예외).
    if (!admin) {
      const { data: lastRows, error: lastError } = await supabase
        .from('blog_audits')
        .select('run_at')
        .eq('user_id', user.id)
        .order('run_at', { ascending: false })
        .limit(1);
      // 테이블 미적용 등 조회 실패는 쿨다운 없이 진행(graceful) — 저장 단계에서 다시 처리.
      const lastRunAt = !lastError && lastRows?.[0]?.run_at ? String(lastRows[0].run_at) : null;
      if (isCooldownActive(lastRunAt)) {
        return NextResponse.json(
          {
            error: '블로그 진단은 24시간에 1회 실행할 수 있습니다.',
            nextAvailableAt: lastRunAt ? cooldownEndsAt(lastRunAt) : null,
          },
          { status: 429 },
        );
      }
    }

    // 1) 수집 — 최근 20편, 본문 6000자 (실패·빈 결과 시 빈 배열, never throws)
    const items = await fetchNaverBlogPostItems(blogId, {
      limit: AUDIT_POST_LIMIT,
      bodyMaxChars: AUDIT_BODY_MAX_CHARS,
    });
    if (items.length === 0) {
      return NextResponse.json(
        {
          error:
            '블로그에서 글을 가져오지 못했습니다. 공개 블로그인지, 발행된 글이 있는지 확인해주세요.',
        },
        { status: 422 },
      );
    }

    // 2) A층 — 전 글 키워드/상품명 검사
    const auditedPosts: AuditPostResult[] = items.map((item) =>
      buildAuditPost({
        title: item.title || '(제목 없음)',
        link: item.link,
        body: item.body,
        compliance: checkCompliance(item.body),
      }),
    );

    // 3) B층 — A층 위험점수 상위 5편만 LLM 심의(비용 방어, 최대 5회).
    //    reviewComplianceWithAI 는 throw 하지 않으며, 실패(reviewed=false) 글은
    //    A층 결과만으로 표시한다(graceful). 원본 인덱스로 매칭(링크 중복 안전).
    const byRiskDesc = auditedPosts
      .map((post, idx) => ({ post, idx }))
      .sort((a, b) => b.post.riskScore - a.post.riskScore);
    const reviewedByIndex = new Map<number, AuditPostResult>();
    for (const { post, idx } of byRiskDesc.slice(0, AUDIT_AI_REVIEW_LIMIT)) {
      const review = await reviewComplianceWithAI(items[idx].body);
      if (review.reviewed) {
        reviewedByIndex.set(idx, applyAiFindings(post, review.findings));
      }
    }
    const finalPosts = auditedPosts.map((p, idx) => reviewedByIndex.get(idx) ?? p);

    const results: BlogAuditResults = buildAuditResults({ blogId, posts: finalPosts });

    // 4) 저장 — blog_audits (RLS: 본인 insert). 마이그 034 미적용이면 저장만 스킵하고
    //    결과는 그대로 반환한다(진단 UX를 막지 않는다).
    let saved = true;
    const { error: insertError } = await supabase.from('blog_audits').insert({
      user_id: user.id,
      blog_id: blogId,
      run_at: results.runAt,
      results,
    });
    if (insertError) {
      saved = false;
      if (!isMissingAuditTable(insertError)) {
        // 테이블은 있는데 저장 실패 — 결과 반환은 유지하되 사유를 함께 전달.
        return NextResponse.json({ audit: results, saved, saveError: insertError.message });
      }
    }

    return NextResponse.json({ audit: results, saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/blog-audit — 최신 진단 결과 캐시 반환(본인 것만, RLS).
 * 진단 이력이 없거나 테이블 미적용이면 { audit: null }.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('blog_audits')
      .select('run_at, results')
      .eq('user_id', user.id)
      .order('run_at', { ascending: false })
      .limit(1);

    if (error) {
      if (isMissingAuditTable(error)) {
        return NextResponse.json({ audit: null });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const latest = data?.[0];
    if (!latest) {
      return NextResponse.json({ audit: null });
    }

    return NextResponse.json({
      audit: latest.results as BlogAuditResults,
      runAt: latest.run_at,
      nextAvailableAt: cooldownEndsAt(String(latest.run_at)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
