import type { Metadata } from 'next';
import { Suspense } from 'react';
import BlogCheckClient from '@/components/blog-check/BlogCheckClient';

/**
 * /blog-check — 네이버 블로그 무료진단 (영업 리드 마그넷, 비회원 공개).
 * 실제 화면은 클라이언트 컴포넌트(BlogCheckClient) — useSearchParams(?blog=)를
 * 쓰므로 Suspense 경계로 감싼다 (랜딩 ClinicParamReader 패턴 동일).
 */

export const metadata: Metadata = {
  title: '네이버 블로그 무료진단 — SEO·AI검색·의료광고법 실측 | 닥터포스트',
  description:
    '병원 네이버 블로그 주소만 넣으면 검색량·노출 순위·문서수 실측 기반으로 SEO 점수, AI 검색(GEO) 점수, 의료광고법 위험 신호를 무료로 진단해 드립니다.',
};

export default function BlogCheckPage() {
  return (
    <Suspense fallback={null}>
      <BlogCheckClient />
    </Suspense>
  );
}
