import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  // 오픈 리다이렉트 방어: 상대 경로만 허용
  const safePath = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/?error=auth_failed`);
    }
  }

  return NextResponse.redirect(`${origin}${safePath}`);
}
