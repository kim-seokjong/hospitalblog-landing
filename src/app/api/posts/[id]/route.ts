import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';

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

    const { data, error } = await supabase
      .from('saved_posts')
      .update(updates)
      .eq('id', id)
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
