import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/dev/lib/supabase/server';
import DiagnosisReportView from '@/components/clinic-diagnosis/DiagnosisReportView';
import type { DiagnosisReport } from '@/content/lib/clinic-diagnosis/types';

/**
 * /clinic-check/r/[token] — 공유 리포트 (읽기 전용, 인증 없음).
 *
 * 대표가 전화·메일 후속으로 원장에게 그대로 보내는 링크다.
 * 토큰은 추측 불가능한 난수(64자)이며, 만료됐으면 404 로 떨어진다.
 *
 * 검색엔진 색인 금지 — 특정 병원의 진단 결과가 검색에 노출되면 안 된다.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '병원 온라인 노출 진단 결과 | 닥터포스트',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

/** 토큰 형식 검증 — DB 조회 전에 형태부터 거른다. */
const TOKEN_PATTERN = /^[a-f0-9]{32,80}$/;

export default async function SharedDiagnosisPage({ params }: PageProps) {
  const { token } = await params;
  if (!TOKEN_PATTERN.test(token ?? '')) notFound();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('clinic_diagnosis_reports')
    .select('results, expires_at, view_count')
    .eq('share_token', token)
    .maybeSingle();

  if (error || !data?.results) notFound();
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) notFound();

  // 조회수 증가는 실패해도 화면을 막지 않는다.
  void admin
    .from('clinic_diagnosis_reports')
    .update({ view_count: (data.view_count ?? 0) + 1 })
    .eq('share_token', token)
    .then(undefined, () => undefined);

  const report = data.results as DiagnosisReport;

  return (
    <div className="min-h-screen bg-white text-[#202020]">
      <div className="flex h-2">
        <i className="flex-1 bg-[#ff4628]" />
        <i className="flex-1 bg-[#202020]" />
        <i className="flex-1 bg-[#b8c8d7]" />
      </div>
      <main className="max-w-4xl mx-auto px-5 sm:px-6 py-10 sm:py-14">
        <p className="text-[13px] font-extrabold text-[#ff4628] tracking-[2px]">FREE CHECK</p>
        <h1 className="text-[22px] sm:text-[32px] font-black leading-tight mt-2 mb-6" style={{ letterSpacing: '-0.5px' }}>
          병원 온라인 노출 진단 결과
        </h1>

        {/* 이 화면의 토큰이 그대로 메일 발송의 열쇠다 — 링크를 받은 사람도 다시 보낼 수 있다. */}
        <DiagnosisReportView report={report} shareToken={token} />

        <div className="mt-8 text-center">
          <Link
            href="/clinic-check"
            className="inline-block px-7 py-3.5 min-h-[44px] bg-[#202020] text-white font-bold rounded-xl"
          >
            다른 병원도 진단해 보기
          </Link>
        </div>
      </main>
    </div>
  );
}
