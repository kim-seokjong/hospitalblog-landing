import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { encrypt, decrypt } from '@/lib/crypto';

async function getAuthUser() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

/** GET: 저장된 자격증명 확인 (id 마스킹 + 카테고리) */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const admin = createAdminClient();

  // blog_category 컬럼이 아직 없을 수 있으므로 fallback 처리
  let maskedId = '***';
  let blogCategory = '';
  let exists = false;

  // 1차: blog_category 포함 조회
  const { data, error } = await admin
    .from('naver_credentials')
    .select('naver_id_enc, iv, tag, blog_category')
    .eq('user_id', user.id)
    .single();

  if (!error && data) {
    exists = true;
    blogCategory = data.blog_category ?? '';
    try {
      const naverId = decrypt({ enc: data.naver_id_enc, iv: data.iv, tag: data.tag });
      maskedId = naverId.slice(0, 2) + '***' + naverId.slice(-1);
    } catch { /* keep default */ }
    return NextResponse.json({ exists, maskedId, blogCategory });
  }

  // 컬럼 없음 에러(42703)이면 blog_category 없이 재조회
  if (error && (error.code === '42703' || error.message?.includes('blog_category'))) {
    const { data: data2, error: error2 } = await admin
      .from('naver_credentials')
      .select('naver_id_enc, iv, tag')
      .eq('user_id', user.id)
      .single();

    if (!error2 && data2) {
      exists = true;
      try {
        const naverId = decrypt({ enc: data2.naver_id_enc, iv: data2.iv, tag: data2.tag });
        maskedId = naverId.slice(0, 2) + '***' + naverId.slice(-1);
      } catch { /* keep default */ }
      return NextResponse.json({ exists, maskedId, blogCategory: '' });
    }
  }

  return NextResponse.json({ exists: false });
}

/** POST: 자격증명 저장 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { naverId, naverPw, naverSes = '', blogCategory = '' } = await req.json();
  if (!naverId?.trim() || !naverPw?.trim()) {
    return NextResponse.json({ error: '아이디와 NID_AUT 쿠키를 입력해주세요.' }, { status: 400 });
  }

  const encId = encrypt(naverId.trim());
  // NID_AUT와 NID_SES를 || 구분자로 합쳐서 저장
  const combined = naverSes.trim() ? `${naverPw.trim()}||${naverSes.trim()}` : naverPw.trim();
  const encPw = encrypt(combined);
  const admin = createAdminClient();

  // 1차: blog_category 포함 upsert
  const baseData = {
    user_id: user.id,
    naver_id_enc: encId.enc,
    naver_pw_enc: encPw.enc,
    iv: encId.iv,
    tag: encId.tag,
    pw_iv: encPw.iv,
    pw_tag: encPw.tag,
    updated_at: new Date().toISOString(),
  };

  const { error: err1 } = await admin
    .from('naver_credentials')
    .upsert({ ...baseData, blog_category: blogCategory.trim() }, { onConflict: 'user_id' });

  if (!err1) return NextResponse.json({ success: true });

  // blog_category 컬럼 없음 에러면 해당 필드 빼고 재시도
  if (err1.code === '42703' || err1.message?.includes('blog_category')) {
    const { error: err2 } = await admin
      .from('naver_credentials')
      .upsert(baseData, { onConflict: 'user_id' });

    if (!err2) return NextResponse.json({ success: true });
    return NextResponse.json({ error: '저장에 실패했습니다: ' + err2.message }, { status: 500 });
  }

  return NextResponse.json({ error: '저장에 실패했습니다: ' + err1.message }, { status: 500 });
}

/** DELETE: 자격증명 삭제 */
export async function DELETE() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const admin = createAdminClient();
  const { error } = await admin.from('naver_credentials').delete().eq('user_id', user.id);
  if (error) return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });

  return NextResponse.json({ success: true });
}
