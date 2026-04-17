import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDecryptedCredentials } from '@/lib/credentials';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // 1. 인증 확인
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  // 2. 요청 파싱
  let title: string, body: string, tags: string[], requestCategory: string;
  try {
    const parsed = await req.json() as { title?: string; body?: string; tags?: string[]; category?: string };
    title = parsed.title ?? '';
    body = parsed.body ?? '';
    tags = parsed.tags ?? [];
    requestCategory = parsed.category ?? '';
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  if (!title || !body) {
    return NextResponse.json({ error: '제목과 본문이 필요합니다.' }, { status: 400 });
  }

  // 3. 자격증명 복호화
  const creds = await getDecryptedCredentials(user.id);
  if (!creds) {
    return NextResponse.json(
      { error: '네이버 자격증명을 먼저 설정해주세요. (설정 → 네이버 계정)' },
      { status: 400 }
    );
  }

  const { naverId, naverCookie, naverSes, blogCategory: dbCategory } = creds;
  const category = requestCategory || dbCategory;

  // 4. 발행 서버(Render)로 프록시
  const publishServerUrl = process.env.PUBLISH_SERVER_URL;
  if (!publishServerUrl) {
    return NextResponse.json(
      { error: '발행 서버가 설정되지 않았습니다. 관리자에게 문의하세요.' },
      { status: 503 }
    );
  }

  try {
    const response = await fetch(`${publishServerUrl}/api/publish-naver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.PUBLISH_API_KEY ?? '',
      },
      body: JSON.stringify({ naverId, naverCookie, naverSes, title, body, tags, category }),
    });

    const data = await response.json() as { error?: string; url?: string; message?: string };
    if (!response.ok) {
      return NextResponse.json({ error: data.error || '발행에 실패했습니다.' }, { status: response.status });
    }
    return NextResponse.json(data);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `발행 서버 연결 오류: ${message}` },
      { status: 500 }
    );
  }
}
