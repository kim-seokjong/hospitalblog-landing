/** 관리자 이메일 목록 (환경변수에서 로드) */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/** 이메일이 관리자인지 확인 */
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
