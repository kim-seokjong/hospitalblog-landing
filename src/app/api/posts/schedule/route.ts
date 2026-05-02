import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = await req.json() as unknown;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 });
    }

    const { id, scheduled_at } = body as Record<string, unknown>;

    if (typeof id !== 'string' || id.trim() === '') {
      return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });
    }

    if (scheduled_at !== null && typeof scheduled_at !== 'string') {
      return NextResponse.json({ error: 'scheduled_at은 ISO 날짜 문자열 또는 null이어야 합니다.' }, { status: 400 });
    }

    if (typeof scheduled_at === 'string') {
      const parsed = new Date(scheduled_at);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: '유효하지 않은 날짜 형식입니다.' }, { status: 400 });
      }
    }

    const newStatus = scheduled_at === null ? 'draft' : 'scheduled';

    const { data, error } = await supabase
      .from('saved_posts')
      .update({
        scheduled_at: scheduled_at ?? null,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id.trim())
      .eq('user_id', user.id)
      .select()
      .single();

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
