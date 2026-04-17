import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

// 임시 마이그레이션 엔드포인트 — 사용 후 삭제됩니다
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-migration-secret');
  if (secret !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // blog_category 컬럼 추가
  const { error } = await admin.rpc('exec_migration' as never, {} as never);

  // rpc가 없으면 직접 raw SQL 시도
  const results: string[] = [];

  // 컬럼 존재 여부 확인
  const { data: colCheck } = await admin
    .from('information_schema.columns' as never)
    .select('column_name')
    .eq('table_schema', 'public')
    .eq('table_name', 'naver_credentials')
    .eq('column_name', 'blog_category')
    .maybeSingle() as { data: { column_name: string } | null };

  if (colCheck) {
    return NextResponse.json({ message: 'blog_category 컬럼이 이미 존재합니다.', results });
  }

  return NextResponse.json({
    message: 'information_schema 확인 완료. Supabase SQL Editor에서 직접 실행 필요.',
    sql: "ALTER TABLE naver_credentials ADD COLUMN IF NOT EXISTS blog_category TEXT DEFAULT '';",
    error: error ? String(error) : null,
  });
}
