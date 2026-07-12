import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { validateComplianceReport } from '@/content/lib/compliance-report';
import {
  buildGeoSchemas,
  buildMetaDescription,
  extractFaqItems,
  extractSummaryLines,
  serializeJsonLd,
  stripStructureBlocks,
} from '@/content/lib/geo-schema';
import { buildExportFilename, buildGeoExportHtml } from '@/content/lib/geo-export';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mypage/geo-export?postId=<uuid>
 *
 * "GEO 발행본" 다운로드 — 저장 글 1편을 병원 공식 홈페이지 게시용 완결 HTML
 * (본문 + JSON-LD 스키마 + 메타태그)로 내보낸다. 네이버 블로그(환자 유입)와
 * 함께 홈페이지에도 발행하면 AI 검색(ChatGPT·Gemini·Claude) 인용을 준비할 수 있다.
 *
 * 게이트:
 *  - Supabase 인증 필수 (마이페이지 패턴)
 *  - 본인 소유 글만 (user_id 검증 + RLS)
 *  - 의료광고법 검수 통과 글만 — saved_posts.compliance_report(마이그 034)의
 *    grade(HIGH/CRITICAL 차단)·needsManualReview(true 차단) 기준. 스냅샷이
 *    없는 과거 글은 검사 리포트 페이지에서 재검사 후 이용하도록 403 안내.
 *
 * 성공 응답: text/html 첨부 다운로드 (파일명 = 글 제목 slug, RFC 5987 인코딩).
 * 오류 응답: ApiResponse JSON 엔벨로프(success/error).
 */

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PostRow {
  id: string;
  title: string;
  content: string;
  published_at: string | null;
  created_at: string | null;
  compliance_report?: unknown;
}

interface ProfileRow {
  hospital_name?: string | null;
  hospital_type?: string | null;
  region?: string | null;
  hospital_address?: string | null;
}

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json<ApiResponse<never>>({ success: false, error }, { status });
}

/** 검수 게이트 — 통과 시 null, 차단 시 한국어 사유를 반환한다. */
function exportBlockReason(reportRaw: unknown): string | null {
  const report = validateComplianceReport(reportRaw);
  if (!report) {
    return '의료광고법 검사 기록이 아직 없는 글입니다. 콘텐츠 보관함의 "검사 리포트"에서 검사를 먼저 완료한 뒤 다시 시도해주세요.';
  }
  if (report.needsManualReview || report.grade === 'HIGH' || report.grade === 'CRITICAL') {
    return '의료광고법 검수가 필요한 글은 홈페이지용 HTML로 내보낼 수 없습니다. 지적된 표현을 수정하고 재검사를 통과한 후 다시 시도해주세요.';
  }
  return null;
}

/** RFC 5987 filename* 값 인코딩 — encodeURIComponent 미처리 문자 보강. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export async function GET(req: NextRequest) {
  try {
    const postId = req.nextUrl.searchParams.get('postId') ?? '';
    if (!UUID_RE.test(postId)) {
      return jsonError(400, '잘못된 글 ID 형식입니다.');
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return jsonError(401, '로그인이 필요합니다.');
    }

    // 본인 소유 글만 (RLS + user_id 필터 이중 방어)
    const { data: post, error: postError } = await supabase
      .from('saved_posts')
      .select('id, title, content, published_at, created_at, compliance_report')
      .eq('id', postId)
      .eq('user_id', user.id)
      .single<PostRow>();

    if (postError || !post) {
      return jsonError(404, '글을 찾을 수 없습니다.');
    }

    // 검수(컴플라이언스) 게이트 — 통과 글만 내보내기 허용
    const blockReason = exportBlockReason(post.compliance_report);
    if (blockReason) {
      return jsonError(403, blockReason);
    }

    const content = typeof post.content === 'string' ? post.content : '';
    if (content.trim() === '') {
      return jsonError(422, '본문이 비어 있어 내보낼 수 없습니다.');
    }

    // 병원 프로필(공개 사실정보) — 조회 실패는 graceful (스키마에서 병원 필드만 생략)
    let profileRow: ProfileRow = {};
    try {
      const { data } = await supabase
        .from('profiles')
        .select('hospital_name, hospital_type, region, hospital_address')
        .eq('id', user.id)
        .single<ProfileRow>();
      profileRow = data ?? {};
    } catch {
      profileRow = {};
    }

    const schemaPost = {
      title: post.title,
      content,
      publishedAt: post.published_at ?? post.created_at,
    };
    const profile = {
      hospitalName: profileRow.hospital_name ?? null,
      specialty: profileRow.hospital_type ?? null,
      region: profileRow.region ?? null,
      address: profileRow.hospital_address ?? null,
    };

    const schemas = buildGeoSchemas(schemaPost, profile);
    const html = buildGeoExportHtml({
      title: post.title,
      bodyText: stripStructureBlocks(content),
      metaDescription: buildMetaDescription(content),
      jsonLd: serializeJsonLd(schemas),
      summaryLines: extractSummaryLines(content),
      faqItems: extractFaqItems(content),
    });

    const filename = buildExportFilename(post.title);
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="geo-post.html"; filename*=UTF-8''${encodeRfc5987(filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[geo-export] 오류:', err instanceof Error ? err.message : err);
    return jsonError(500, '홈페이지용 HTML 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }
}
