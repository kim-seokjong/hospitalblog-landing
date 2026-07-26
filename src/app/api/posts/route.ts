import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { validateComplianceReport } from '@/content/lib/compliance-report';
import { normalizeKeywordInput } from '@/content/lib/keyword-list';

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
    const validComplianceReport = validateComplianceReport(compliance_report);

    const insertRow = {
      user_id: user.id,
      title: title.trim(),
      content: content.trim(),
      // 키워드 정규화 — 빈 토큰·중복·연속공백 제거 ("조원동치과, , 사랑니" → "조원동치과, 사랑니").
      // ★ 순위 추적은 이 값을 콤마로 분리해 키워드별로 검색한다. 빈 토큰이 섞여 있으면
      //   글 자체는 멀쩡해도 추적 단계에서 잡음이 된다 → 저장 경계에서 한 번 정리한다.
      keyword: normalizeKeywordInput(keyword) || null,
      tags: Array.isArray(tags) ? tags : null,
      specialty: specialty ?? null,
      seo_score: typeof seo_score === 'number' ? seo_score : null,
      image_urls: Array.isArray(image_urls) ? image_urls : null,
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
