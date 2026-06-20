import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { isAdmin } from '@/hr/lib/admin';
import {
  createNoticeForAll,
  createNoticeForUser,
  listRecentNotices,
} from '@/dev/lib/notice-repository';

export const dynamic = 'force-dynamic';

const MAX_TITLE_LEN = 100;
const MAX_MESSAGE_LEN = 1000;

interface CreateNoticeBody {
  title?: unknown;
  message?: unknown;
  target?: unknown; // 'all' | userId
}

/** 최근 발송한 공지 목록 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!isAdmin(user?.email)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const notices = await listRecentNotices();
    return NextResponse.json({ notices });
  } catch (e) {
    console.error('[admin/notices] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** 공지 생성 (개별 / 전체) */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!isAdmin(user?.email)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const body = (await req.json()) as CreateNoticeBody;

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const target = typeof body.target === 'string' ? body.target.trim() : '';

    if (!title) {
      return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 });
    }
    if (title.length > MAX_TITLE_LEN) {
      return NextResponse.json(
        { error: `제목은 ${MAX_TITLE_LEN}자 이내여야 합니다.` },
        { status: 400 }
      );
    }
    if (!message) {
      return NextResponse.json({ error: '내용을 입력하세요.' }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE_LEN) {
      return NextResponse.json(
        { error: `내용은 ${MAX_MESSAGE_LEN}자 이내여야 합니다.` },
        { status: 400 }
      );
    }
    if (!target) {
      return NextResponse.json(
        { error: '전송 대상을 선택하세요.' },
        { status: 400 }
      );
    }

    const result =
      target === 'all'
        ? await createNoticeForAll({ title, message })
        : await createNoticeForUser({ userId: target, title, message });

    console.log(
      `[admin/notices] ${user?.email} sent notice (target=${target}, delivered=${result.delivered})`
    );

    return NextResponse.json({ success: true, delivered: result.delivered });
  } catch (e) {
    console.error('[admin/notices] POST error:', e);
    const message = e instanceof Error ? e.message : '서버 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
