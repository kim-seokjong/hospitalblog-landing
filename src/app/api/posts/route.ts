import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { buildServerComplianceReport } from '@/content/lib/compliance-report-server';
import { sanitizeImageUrls, sanitizeTags, sanitizeSeoScore } from '@/content/lib/saved-post-fields';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get('status');
    const validStatuses = ['draft', 'scheduled', 'published'];

    let query = supabase
      .from('saved_posts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (statusFilter && validStatuses.includes(statusFilter)) {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ posts: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = await req.json();
    const { title, content, keyword, tags, specialty, seo_score, image_urls, sns_copy, sms_copy, target_site, status, published_url, original_content, compliance_report } = body;

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return NextResponse.json({ error: '제목은 필수입니다.' }, { status: 400 });
    }
    if (!content || typeof content !== 'string' || content.trim() === '') {
      return NextResponse.json({ error: '본문은 필수입니다.' }, { status: 400 });
    }

    // status는 생성 시 'draft'(기본) 또는 'published'(복사=발행 간주)만 허용
    if (status !== undefined && status !== 'draft' && status !== 'published') {
      return NextResponse.json({ error: '유효하지 않은 상태값입니다.' }, { status: 400 });
    }
    const validStatus: 'draft' | 'published' = status === 'published' ? 'published' : 'draft';

    // target_site는 마이그레이션 018 적용 후에만 클라이언트가 전송 (미전송 시 컬럼 자체를 insert에서 제외해 하위 호환 유지)
    const validTargetSite =
      target_site === 'naver' || target_site === 'google' ? target_site : null;

    // published_url은 선택적 — http(s) URL일 때만 저장 (미전송/비정상 시 컬럼 제외해 하위 호환)
    const validPublishedUrl =
      typeof published_url === 'string' && /^https?:\/\//i.test(published_url.trim())
        ? published_url.trim()
        : null;

    // original_content: AI 생성 직후 원본 스냅샷(VOICE-DNA 편집 학습용).
    // 미전송 시 컬럼 자체를 insert에서 제외해 하위 호환(마이그 029 미적용 환경 보호).
    const validOriginalContent =
      typeof original_content === 'string' && original_content.trim() !== ''
        ? original_content.trim()
        : null;

    // compliance_report: 의료광고법 검사 증빙 스냅샷(서버 검증·정규화 후 저장).
    // 검증 실패(형태 불일치)나 미전송 시 컬럼 자체를 insert에서 제외해 하위 호환
    // (마이그 034 미적용 환경 보호 + 글 저장 자체는 리포트 문제로 막지 않는 방침).
    //
    // ⚠️ A층 결과·등급·검수 권고는 **서버가 본문으로 재산정한다**. 클라이언트가 보낸
    //    grade/needsManualReview 를 그대로 믿으면 위반 글에 grade:"PASS" 를 실어
    //    발행 게이트(site-publish·GEO export·auto-publish)를 우회할 수 있다.
    //    B층(LLM) 결과와 autoFixed 이력은 재현 비용이 크므로 클라이언트 보고분을
    //    쓰되, 게이트 판정에는 관여하지 않는 표시 전용 데이터다.
    const validComplianceReport = buildServerComplianceReport(compliance_report, content);

    const insertRow = {
      user_id: user.id,
      title: title.trim(),
      content: content.trim(),
      keyword: keyword ?? null,
      // 산출물 3종은 서버에서도 정규화한다 — 클라이언트가 TagResult(객체)나
      // data URL 을 그대로 보내도 컬럼 형태(text[]/int)에 맞게 걸러 저장한다.
      tags: sanitizeTags(tags),
      specialty: specialty ?? null,
      seo_score: sanitizeSeoScore(seo_score),
      image_urls: sanitizeImageUrls(image_urls, process.env.NEXT_PUBLIC_SUPABASE_URL),
      sns_copy: sns_copy ?? null,
      sms_copy: sms_copy ?? null,
      status: validStatus,
      ...(validTargetSite ? { target_site: validTargetSite } : {}),
      ...(validPublishedUrl ? { published_url: validPublishedUrl } : {}),
      ...(validOriginalContent ? { original_content: validOriginalContent } : {}),
      ...(validComplianceReport ? { compliance_report: validComplianceReport } : {}),
    };

    let { data, error } = await supabase
      .from('saved_posts')
      .insert(insertRow)
      .select()
      .single();

    // 마이그 034(compliance_report) 미적용 환경 폴백 — 컬럼 없음(42703)이면
    // 리포트만 제외하고 재시도한다(글 저장 자체를 막지 않는다).
    if (error && validComplianceReport && error.code === '42703') {
      const { compliance_report: _omitted, ...withoutReport } = insertRow as Record<string, unknown>;
      ({ data, error } = await supabase
        .from('saved_posts')
        .insert(withoutReport)
        .select()
        .single());
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ post: data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
