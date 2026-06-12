import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';

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
    const { title, content, keyword, tags, specialty, seo_score, image_urls, sns_copy, sms_copy, target_site } = body;

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return NextResponse.json({ error: '제목은 필수입니다.' }, { status: 400 });
    }
    if (!content || typeof content !== 'string' || content.trim() === '') {
      return NextResponse.json({ error: '본문은 필수입니다.' }, { status: 400 });
    }

    // target_site는 마이그레이션 018 적용 후에만 클라이언트가 전송 (미전송 시 컬럼 자체를 insert에서 제외해 하위 호환 유지)
    const validTargetSite =
      target_site === 'naver' || target_site === 'google' ? target_site : null;

    const { data, error } = await supabase
      .from('saved_posts')
      .insert({
        user_id: user.id,
        title: title.trim(),
        content: content.trim(),
        keyword: keyword ?? null,
        tags: Array.isArray(tags) ? tags : null,
        specialty: specialty ?? null,
        seo_score: typeof seo_score === 'number' ? seo_score : null,
        image_urls: Array.isArray(image_urls) ? image_urls : null,
        sns_copy: sns_copy ?? null,
        sms_copy: sms_copy ?? null,
        status: 'draft',
        ...(validTargetSite ? { target_site: validTargetSite } : {}),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ post: data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
