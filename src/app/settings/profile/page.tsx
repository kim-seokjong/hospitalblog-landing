import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** 기존 프로필 설정 페이지 — 마이페이지 '내 정보' 탭으로 통합 이전 */
export default function ProfileSettingsRedirect() {
  redirect('/mypage?tab=profile');
}
