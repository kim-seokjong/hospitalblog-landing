import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { encrypt, decrypt } from '@/lib/crypto';

async function getAuthUser() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

/** GET: 저장된 자격증명 존재 여부 확인 (id 마스킹 + 카테고리 반환) */
export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('naver_credentials')
    .select('naver_id_enc, iv, tag, blog_category')
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ exists: false });
  }

  try {
    const naverId = decrypt({ enc: data.naver_id_enc, iv: data.iv, tag: data.tag });
    const masked = naverId.slice(0, 2) + '***' + naverId.slice(-1);
    return NextResponse.json({
      exists: true,
      maskedId: masked,
      blogCategory: data.blog_category ?? '',
    });
  } catch {
    return NextResponse.json({ exists: true, maskedId: '***', blogCategory: '' });
  }
}

/** POST: 자격증명 저장 (아이디/비밀번호 암호화, 카테고리 평문) */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { naverId, naverPw, blogCategory = '' } = await req.json();

  if (!naverId?.trim() || !naverPw?.trim()) {
    return NextResponse.json({ error: '아이디와 비밀번호를 모두 입력해주세요.' }, { status: 400 });
  }

  const encId = encrypt(naverId.trim());
  const encPw = encrypt(naverPw.trim());

  const admin = createAdminClient();
  const { error } = await admin
    .from('naver_credentials')
    .upsert(
      {
        user_id: user.id,
        naver_id_enc: encId.enc,
        naver_pw_enc: encPw.enc,
        iv: encId.iv,
        tag: encId.tag,
        pw_iv: encPw.iv,
        pw_tag: encPw.tag,
        blog_category: blogCategory.trim(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    return NextResponse.json({ error: '저장에 실패했습니다: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/** DELETE: 자격증명 삭제 */
export async function DELETE() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from('naver_credentials').delete().eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
