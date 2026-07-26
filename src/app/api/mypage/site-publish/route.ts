import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { validateComplianceReport } from '@/content/lib/compliance-report';
import { publishBlockReason } from '@/content/lib/clinic-site/publish-gate';
import { clinicSiteHost, clinicSiteUrl } from '@/content/lib/clinic-site/slug';
import { notifyIndexNow } from '@/content/lib/clinic-site/indexnow-submit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mypage/site-publish — { postId, publish }
 *
 * 내 블로그({site_slug}.hospitalblog.kr) 발행 토글.
 *
 * 게이트 (publish=true 일 때만):
 *  - Supabase 인증 + 본인 소유 글 (user_id 필터 + RLS 이중 방어)
 *  - site_slug 미설정 → 400 (프로필에서 주소 먼저 설정)
 *  - 의료광고법 검수 게이트 — geo-export 와 동일 기준
 *    (compliance_report 없음 / needsManualReview / HIGH·CRITICAL → 403 + 사유)
 *  - 본문 비어 있음 → 422
 *
 * 발행 취소(publish=false)는 게이트 없이 항상 허용 (내리는 것은 안전한 방향).
 * 성공 시 published_to_site/site_published_at 갱신 + 공개 페이지 ISR 재검증.
 */

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface PublishResult {
  published: boolean;
  /** 발행 상태일 때 공개 글 URL (취소 시 null) */
  url: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIGRATION_MISSING_MSG =
  '내 블로그 발행 기능이 아직 활성화되지 않았습니다. 잠시 후 다시 시도해주세요.';

interface PostRow {
  id: string;
  content: string;
  compliance_report?: unknown;
}

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json<ApiResponse<never>>({ success: false, error }, { status });
}

function isMissingColumnError(error: { code?: string } | null): boolean {
  return error?.code === '42703';
}

/** 공개 페이지 ISR 재검증 — 실패해도 발행 자체는 성공 처리 (최대 1시간 내 자연 갱신). */
function revalidateClinicPages(slug: string, postId: string): void {
  try {
    revalidatePath(`/clinic-site/${slug}`);
    revalidatePath(`/clinic-site/${slug}/posts/${postId}`);
  } catch (err) {
    console.error('[site-publish] 재검증 실패:', err instanceof Error ? err.message : err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { postId?: unknown; publish?: unknown } | null;
    const postId = typeof body?.postId === 'string' ? body.postId : '';
    const publish = body?.publish;

    if (!UUID_RE.test(postId)) {
      return jsonError(400, '잘못된 글 ID 형식입니다.');
    }
    if (typeof publish !== 'boolean') {
      return jsonError(400, '발행 여부(publish)가 올바르지 않습니다.');
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return jsonError(401, '로그인이 필요합니다.');
    }

    // 프로필의 블로그 주소 — 43 마이그 미적용(42703)이면 기능 비활성 안내
    const { data: profileRow, error: profileError } = await supabase
      .from('profiles')
      .select('site_slug')
      .eq('id', user.id)
      .single<{ site_slug: string | null }>();

    if (isMissingColumnError(profileError)) {
      return jsonError(503, MIGRATION_MISSING_MSG);
    }
    const siteSlug = profileRow?.site_slug ?? null;

    // 본인 소유 글만 (RLS + user_id 필터 이중 방어)
    const { data: post, error: postError } = await supabase
      .from('saved_posts')
      .select('id, content, compliance_report')
      .eq('id', postId)
      .eq('user_id', user.id)
      .single<PostRow>();

    if (postError || !post) {
      return jsonError(404, '글을 찾을 수 없습니다.');
    }

    if (publish) {
      if (!siteSlug) {
        return jsonError(400, '프로필에서 블로그 주소를 먼저 설정해주세요.');
      }

      // 검수(컴플라이언스) 게이트 — geo-export 와 동일 기준
      const blockReason = publishBlockReason(validateComplianceReport(post.compliance_report));
      if (blockReason) {
        return jsonError(403, blockReason);
      }

      const content = typeof post.content === 'string' ? post.content : '';
      if (content.trim() === '') {
        return jsonError(422, '본문이 비어 있어 발행할 수 없습니다.');
      }
    }

    const updates = publish
      ? { published_to_site: true, site_published_at: new Date().toISOString() }
      : { published_to_site: false, site_published_at: null };

    const { error: updateError } = await supabase
      .from('saved_posts')
      .update(updates)
      .eq('id', postId)
      .eq('user_id', user.id);

    if (isMissingColumnError(updateError)) {
      return jsonError(503, MIGRATION_MISSING_MSG);
    }
    if (updateError) {
      return jsonError(500, '발행 상태 저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }

    if (siteSlug) {
      revalidateClinicPages(siteSlug, postId);

      // IndexNow — 발행/발행취소 모두 알린다. 공식 스펙상 삭제된(404/410) URL 도
      // 제출 대상이다: "You should submit redirected URLs and pages that return
      // HTTP 404 or HTTP 410 status codes." 색인 요청이 실패해도 발행은 성공이다
      // (notifyIndexNow 는 절대 throw 하지 않으며 키 미설정이면 조용히 건너뛴다).
      await notifyIndexNow(clinicSiteHost(siteSlug), [
        clinicSiteUrl(siteSlug),
        clinicSiteUrl(siteSlug, `/posts/${postId}`),
      ]);
    }

    return NextResponse.json<ApiResponse<PublishResult>>({
      success: true,
      data: {
        published: publish,
        url: publish && siteSlug ? clinicSiteUrl(siteSlug, `/posts/${postId}`) : null,
      },
    });
  } catch (err) {
    console.error('[site-publish] 오류:', err instanceof Error ? err.message : err);
    return jsonError(500, '발행 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }
}
