import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { suggestThumbnailCopy } from '@/content/lib/thumbnail/copy-suggest';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/thumbnail-copy
 * body: { title, keyword?, hospitalType? }
 * 글 제목을 썸네일 카피 5패턴(최대 5안)으로 변환한다.
 * 응답: { suggestions: [{ pattern, patternLabel, klabel, line1, line2?, accentWord }] }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
    if (!title) {
      return NextResponse.json({ error: '글 제목(title)이 필요합니다.' }, { status: 400 });
    }
    if ([...title].length > 120) {
      return NextResponse.json({ error: '제목이 너무 깁니다(최대 120자).' }, { status: 400 });
    }

    const keyword = typeof raw?.keyword === 'string' ? raw.keyword.trim().slice(0, 40) : undefined;
    const hospitalType =
      typeof raw?.hospitalType === 'string' ? raw.hospitalType.trim().slice(0, 20) : undefined;

    const suggestions = await suggestThumbnailCopy({ title, keyword, hospitalType });

    return NextResponse.json({ suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : '카피 생성에 실패했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
