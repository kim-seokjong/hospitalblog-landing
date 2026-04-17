import { createAdminClient } from '@/lib/supabase/server';
import { decrypt } from '@/lib/crypto';

export interface DecryptedCredentials {
  naverId: string;
  naverPw: string;
  blogCategory: string;
}

/** 내부용: 복호화된 자격증명 가져오기 (publish API에서만 사용)
 *  blog_category 컬럼이 없어도 동작하도록 fallback 처리 */
export async function getDecryptedCredentials(userId: string): Promise<DecryptedCredentials | null> {
  const admin = createAdminClient();

  // 1차: blog_category 포함 조회
  const { data, error } = await admin
    .from('naver_credentials')
    .select('naver_id_enc, naver_pw_enc, iv, tag, pw_iv, pw_tag, blog_category')
    .eq('user_id', userId)
    .single();

  // blog_category 컬럼이 아직 없으면 2차 fallback (컬럼 없이 조회)
  if (error && (error.code === '42703' || error.message?.includes('blog_category'))) {
    const { data: data2, error: error2 } = await admin
      .from('naver_credentials')
      .select('naver_id_enc, naver_pw_enc, iv, tag, pw_iv, pw_tag')
      .eq('user_id', userId)
      .single();

    if (error2 || !data2) return null;

    try {
      const naverId = decrypt({ enc: data2.naver_id_enc, iv: data2.iv, tag: data2.tag });
      const naverPw = decrypt({ enc: data2.naver_pw_enc, iv: data2.pw_iv, tag: data2.pw_tag });
      return { naverId, naverPw, blogCategory: '' };
    } catch {
      return null;
    }
  }

  if (error || !data) return null;

  try {
    const naverId = decrypt({ enc: data.naver_id_enc, iv: data.iv, tag: data.tag });
    const naverPw = decrypt({ enc: data.naver_pw_enc, iv: data.pw_iv, tag: data.pw_tag });
    return { naverId, naverPw, blogCategory: data.blog_category ?? '' };
  } catch {
    return null;
  }
}
