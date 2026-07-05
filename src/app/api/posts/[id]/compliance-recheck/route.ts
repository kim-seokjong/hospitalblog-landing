import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { checkCompliance } from '@/content/lib/medical-compliance';
import { reviewComplianceWithAI, type AiComplianceReview } from '@/content/lib/medical-compliance-ai';
import {
  buildComplianceReport,
  validateComplianceReport,
  type ComplianceReportSnapshot,
} from '@/content/lib/compliance-report';

export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/posts/[id]/compliance-recheck
 *
 * compliance_report 스냅샷이 없는 과거 글의 즉석 재검사.
 * - 이미 스냅샷이 있으면 그대로 반환한다(B층 LLM 재호출 없음 — 비용 방어).
 * - 없으면 A층(키워드/상품명)은 무조건 + B층(LLM 심의관)은 이 경우에만 1회 수행하고,
 *   결과를 saved_posts.compliance_report 에 저장해 다음부턴 재사용한다.
 * - B층 실패는 graceful — A층 결과만으로도 리포트는 성립한다(aiReview: null).
 */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    // 본인 글만 (RLS + user_id 필터)
    const { data: post, error: fetchError } = await supabase
      .from('saved_posts')
      .select('id, content, compliance_report')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !post) {
      return NextResponse.json({ error: '글을 찾을 수 없습니다.' }, { status: 404 });
    }

    // 1) 기존 스냅샷이 있으면 재사용 (형태 검증 통과분만 — 손상 데이터는 재검사로 대체)
    const existing = validateComplianceReport(
      (post as { compliance_report?: unknown }).compliance_report,
    );
    if (existing) {
      return NextResponse.json({ report: existing, rechecked: false });
    }

    const content = typeof post.content === 'string' ? post.content : '';
    if (content.trim() === '') {
      return NextResponse.json({ error: '본문이 비어 있어 검사할 수 없습니다.' }, { status: 422 });
    }

    // 2) A층 — 키워드/상품명 검사(무조건 수행)
    const keywordCompliance = checkCompliance(content);

    // 3) B층 — LLM 심의관(스냅샷 없는 과거 글에 한해 1회). 실패해도 진행(graceful).
    let aiReview: AiComplianceReview = { findings: [], reviewed: false };
    try {
      aiReview = await reviewComplianceWithAI(content);
    } catch {
      aiReview = { findings: [], reviewed: false, error: 'review_failed' };
    }

    const report: ComplianceReportSnapshot = buildComplianceReport({
      compliance: keywordCompliance,
      aiReview,
    });

    // 4) 저장 — 다음부턴 재사용. 저장 실패(마이그 034 미적용 등)해도 리포트 표시는 계속.
    let saved = true;
    const { error: updateError } = await supabase
      .from('saved_posts')
      .update({ compliance_report: report, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);
    if (updateError) {
      saved = false;
    }

    return NextResponse.json({ report, rechecked: true, saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
