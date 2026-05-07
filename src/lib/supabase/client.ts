import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)가 설정되지 않았습니다.');
  }
  return createBrowserClient(url, key, {
    cookies: {
      getAll() {
        if (typeof document === 'undefined') return [];
        return document.cookie
          .split('; ')
          .filter(Boolean)
          .map((entry) => {
            const eq = entry.indexOf('=');
            const name = eq === -1 ? entry : entry.slice(0, eq);
            const raw = eq === -1 ? '' : entry.slice(eq + 1);
            let value = raw;
            try { value = decodeURIComponent(raw); } catch { value = raw; }
            return { name, value };
          });
      },
      setAll(cookies) {
        if (typeof document === 'undefined') return;
        cookies.forEach(({ name, value, options }) => {
          const isDelete = value === '' || (options && options.maxAge !== undefined && options.maxAge <= 0);
          const path = options?.path ?? '/';
          const parts: string[] = [`${name}=${encodeURIComponent(value)}`, `path=${path}`];
          if (options?.domain) parts.push(`domain=${options.domain}`);
          if (options?.sameSite) parts.push(`samesite=${options.sameSite}`);
          if (options?.secure) parts.push('secure');
          if (options?.httpOnly) parts.push('httponly');
          if (isDelete) {
            parts.push('expires=Thu, 01 Jan 1970 00:00:00 GMT');
            parts.push('max-age=0');
          }
          // 만료 미설정 → 세션 쿠키 (브라우저 닫으면 자동 삭제)
          document.cookie = parts.join('; ');
        });
      },
    },
  });
}
