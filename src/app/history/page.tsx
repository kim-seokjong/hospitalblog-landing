import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** 기존 콘텐츠 저장함 페이지 — 마이페이지 '콘텐츠 보관함' 탭으로 통합 이전 */
export default function HistoryRedirect() {
  redirect('/mypage?tab=posts');
}
