import { createAdminClient } from '@/lib/supabase/server';
import { decrypt } from '@/lib/crypto';

export interface DecryptedCredentials {
  naverId: string;
  naverPw: string;
  blogCategory: string; // 블로그 카테고리명 (평문 저장)
}

/** 내부용: 복호화된 자격증명 가져오기 (publish API에서만 사용) */
export async function getDecryptedCredentials(userId: string): Promise<DecryptedCredentials | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('naver_credentials')
    .select('naver_id_enc, naver_pw_enc, iv, tag, pw_iv, pw_tag, blog_category')
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;

  try {
    const naverId = decrypt({ enc: data.naver_id_enc, iv: data.iv, tag: data.tag });
    const naverPw = decrypt({ enc: data.naver_pw_enc, iv: data.pw_iv, tag: data.pw_tag });
    return { naverId, naverPw, blogCategory: data.blog_category ?? '' };
  } catch {
    return null;
  }
}
