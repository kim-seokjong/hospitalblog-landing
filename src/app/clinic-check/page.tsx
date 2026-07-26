import type { Metadata } from 'next';
import { Suspense } from 'react';
import ClinicCheckClient from '@/components/clinic-diagnosis/ClinicCheckClient';

/**
 * /clinic-check — 병원명 무료진단 (영업 관문, 비회원 공개).
 *
 * 병원 이름만 넣으면 행정안전부 공표 정보로 병원을 특정하고,
 * 네이버 블로그·홈페이지·AI 검색 인용·의료광고법 표현 네 축을 진단한다.
 */

export const metadata: Metadata = {
  title: '병원 온라인 노출 무료진단 — 블로그·홈페이지·AI 검색 실측 | 닥터포스트',
  description:
    '병원 이름만 넣으면 네이버 블로그 노출, 홈페이지 접속·검색 설정, AI 검색 인용 여부, 의료광고법에서 자주 지적되는 표현까지 공개 자료로 조회해 무료로 진단해 드립니다.',
};

export default function ClinicCheckPage() {
  return (
    <Suspense fallback={null}>
      <ClinicCheckClient />
    </Suspense>
  );
}
