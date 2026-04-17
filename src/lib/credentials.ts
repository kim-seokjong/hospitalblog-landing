import { createAdminClient } from '@/lib/supabase/server';
import { decrypt } from '@/lib/crypto';

/** 내부용: 복호화된 자격증명 가져오기 (publish API에서만 사용) */
export async function getDecryptedCredentials(userId: string): Promise<{ naverId: string; naverPw: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('naver_credentials')
    .select('naver_id_enc, naver_pw_enc, iv, tag, pw_iv, pw_tag')
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;

  try {
    const naverId = decrypt({ enc: data.naver_id_enc, iv: data.iv, tag: data.tag });
    const naverPw = decrypt({ enc: data.naver_pw_enc, iv: data.pw_iv, tag: data.pw_tag });
    return { naverId, naverPw };
  } catch {
    return null;
  }
}
