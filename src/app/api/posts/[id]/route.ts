import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { validateComplianceReport } from '@/content/lib/compliance-report';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
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

    const { data, error } = await supabase
      .from('saved_posts')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: '글을 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({ post: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
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

    const body = await req.json();
    const allowedFields = ['title', 'content', 'tags', 'status', 'keyword', 'seo_score', 'target_site', 'published_url'];
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // compliance_report(검사 증빙 스냅샷) — 재복사(PATCH)로 최신 검사 결과가 오면 갱신.
    // 서버 검증 실패(형태 불일치)나 미전송 시 건드리지 않는다(글 수정 자체는 막지 않는 방침,
    // 마이그 034 미적용 환경은 아래 42703 폴백이 보호).
    const incomingReport = 'compliance_report' in body
      ? validateComplianceReport(body.compliance_report)
      : null;
    if (incomingReport) {
      updates.compliance_report = incomingReport;
    }

    // original_content(VOICE-DNA 원본 스냅샷)는 불변 — 최초 1회만 채운다.
    // 재복사(PATCH)로 들어와도 이미 값이 있으면 절대 덮지 않는다. 미전송 시 건드리지 않음(하위 호환).
    const incomingOriginal =
      typeof body.original_content === 'string' && body.original_content.trim() !== ''
        ? body.original_content.trim()
        : null;
    if (incomingOriginal) {
      // 현재 값 확인 — 비어 있을 때만 채운다. 조회 실패(컬럼 미존재 등) 시 graceful 하게 건너뜀.
      const { data: current } = await supabase
        .from('saved_posts')
        .select('original_content')
        .eq('id', id)
        .eq('user_id', user.id)
        .single();
      const hasOriginal =
        current && typeof (current as { original_content?: unknown }).original_content === 'string'
          && (current as { original_content: string }).original_content.trim() !== '';
      if (current && !hasOriginal) {
        updates.original_content = incomingOriginal;
      }
    }

    for (const field of allowedFields) {
      if (field in body) {
        if (field === 'title') {
          const val = body[field];
          if (typeof val !== 'string' || val.trim() === '') {
            return NextResponse.json({ error: '제목은 비워둘 수 없습니다.' }, { status: 400 });
          }
          updates[field] = val.trim();
        } else if (field === 'content') {
          const val = body[field];
          if (typeof val !== 'string' || val.trim() === '') {
            return NextResponse.json({ error: '본문은 비워둘 수 없습니다.' }, { status: 400 });
          }
          updates[field] = val.trim();
        } else if (field === 'tags') {
          updates[field] = Array.isArray(body[field]) ? body[field] : null;
        } else if (field === 'status') {
          const validStatuses = ['draft', 'scheduled', 'published'];
          if (!validStatuses.includes(body[field])) {
            return NextResponse.json({ error: '유효하지 않은 상태값입니다.' }, { status: 400 });
          }
          updates[field] = body[field];
        } else if (field === 'target_site') {
          const val = body[field];
          // null은 네이버 간주로 되돌리는 정당한 경우 → 허용
          if (val === null) {
            updates[field] = null;
          } else if (val === 'naver' || val === 'google') {
            updates[field] = val;
          } else {
            return NextResponse.json({ error: 'target_site는 naver 또는 google이어야 합니다.' }, { status: 400 });
          }
        } else if (field === 'published_url') {
          const val = body[field];
          if (val === null) {
            updates[field] = null;
          } else if (typeof val === 'string' && /^https?:\/\//i.test(val.trim())) {
            updates[field] = val.trim();
          } else {
            return NextResponse.json({ error: 'published_url은 http(s) URL이어야 합니다.' }, { status: 400 });
          }
        } else {
          updates[field] = body[field];
        }
      }
    }

    let { data, error } = await supabase
      .from('saved_posts')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    // 마이그 034(compliance_report) 미적용 환경 폴백 — 컬럼 없음(42703)이면
    // 리포트만 제외하고 재시도한다(글 수정 자체를 막지 않는다).
    if (error && incomingReport && error.code === '42703') {
      const { compliance_report: _omitted, ...withoutReport } = updates;
      ({ data, error } = await supabase
        .from('saved_posts')
        .update(withoutReport)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single());
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: '글을 찾을 수 없거나 권한이 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({ post: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
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

    const { error } = await supabase
      .from('saved_posts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
