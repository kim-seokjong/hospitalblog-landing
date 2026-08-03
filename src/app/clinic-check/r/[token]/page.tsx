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

// 제목 접미사('| 닥터포스트')는 붙이지 않는다 — 루트 layout 의 title.template 이 붙인다.
export const metadata: Metadata = {
  title: '병원 온라인 노출 진단 결과',
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

  /**
   * 이 토큰으로 **이메일을 남긴 적이 있는가** — 해결방법 공개의 서버 측 근거.
   *
   * ⚠️ 화면에서만 가리면 게이트가 아니다(2026-08-04 교차검증). 진단 API 응답에
   *    공유 토큰이 그대로 실려 있어서, 개발자도구를 열거나 API 를 직접 부르면
   *    토큰을 얻어 이 화면으로 전부 볼 수 있었다.
   *
   * 대표가 전화 후속으로 보내는 링크도 **메일 발송을 거치므로** 리드 행이 남는다.
   * 조회가 실패하면 잠근다 — 확인 못 한 것을 공개 근거로 삼지 않는다.
   */
  const { data: lead } = await admin
    .from('clinic_diagnosis_email_leads')
    .select('id')
    .eq('share_token', token)
    .limit(1);
  const emailGiven = Array.isArray(lead) && lead.length > 0;

  return (
    <Shell>
      {/*
        이 화면의 토큰이 그대로 메일 발송의 열쇠다 — 링크를 받은 사람도 다시 보낼 수 있다.
        shared=true : 여기에는 블로그 후보 선택기도 상세 진단 폼도 없다. 문구가 "아래에서
        바꿔 주세요"라고 말하면 고칠 수 없는 안내가 된다.
      */}
      <ReportBody report={report} token={token} emailGiven={emailGiven} />
    </Shell>
  );
}

/** 공유 화면 껍데기 — 정상·오류 화면이 같은 틀을 쓴다. */
function Shell({ children }: { children: React.ReactNode }) {
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
        {children}
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

/**
 * 화면이 최소한으로 기대하는 형태인가 (저장된 옛 행 방어).
 *
 * ★ 이 링크는 이미 메일·전화로 원장에게 나갔다. 저장 형태가 지금 화면 기대와
 *   어긋나는 옛 행이 하나만 있어도 그 링크가 통째로 500 이 되고, 그건 그대로
 *   신뢰 문제가 된다. 형태부터 확인하고, 그래도 새는 것은 error.tsx 가 받는다.
 *   (만료·없는 토큰의 404 처리는 위에서 그대로 유지된다 — 여기는 '깨진 데이터' 경로다.)
 */
function isRenderableReport(value: unknown): value is DiagnosisReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<DiagnosisReport>;
  return (
    Boolean(report.clinic) &&
    typeof report.runAt === 'string' &&
    Array.isArray(report.findings) &&
    Array.isArray(report.unchecked) &&
    Boolean(report.blog) &&
    Boolean(report.site) &&
    Boolean(report.ai) &&
    Boolean(report.compliance)
  );
}

function ReportBody({
  report,
  token,
  emailGiven,
}: {
  report: DiagnosisReport;
  token: string;
  /** 이 토큰으로 이메일을 남긴 적이 있는가 — 해결방법 공개 여부. */
  emailGiven: boolean;
}) {
  if (!isRenderableReport(report)) {
    console.error('[clinic-check/share] 저장된 리포트 형태가 화면 기대와 다릅니다.');
    return <ReportUnavailable />;
  }
  return (
    <DiagnosisReportView report={report} shareToken={token} shared unlockActions={emailGiven} />
  );
}

function ReportUnavailable() {
  return (
    <div className="bg-[#f7f9fb] border border-[#dbe2ea] rounded-2xl p-5 sm:p-6">
      <p className="text-[15px] font-extrabold">이 진단 결과를 불러오지 못했습니다.</p>
      <p className="text-[13px] text-[#4a4f55] leading-relaxed mt-2">
        결과가 저장된 형식이 지금 화면과 맞지 않아 그대로 보여드릴 수 없었어요. 아래에서 병원 이름으로 다시 진단하시면
        최신 결과를 확인하실 수 있습니다.
      </p>
    </div>
  );
}
