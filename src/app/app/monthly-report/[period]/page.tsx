'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { LogoLockup } from '@/components/landing/Logo';
import {
  isValidPeriod,
  periodLabel,
  type MonthlyReportData,
} from '@/content/lib/monthly-report';

/**
 * 월간 성과 리포트 — 인쇄 최적화 페이지 (구독 해지 방어).
 *
 * - 본인 리포트만(/api/mypage/monthly-reports 가 로그인 + RLS로 본인 소유 검증).
 * - "PDF로 저장" = window.print() (서버 PDF 생성 없음 — /app/report/[postId] 패턴 동일).
 * - 이 페이지는 인쇄용이라 예외적으로 흰 배경 고정을 허용한다(리포 규칙 예외).
 */

type LoadState = 'loading' | 'ready' | 'error';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function StatCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="rounded-xl border border-[#b4bfce] p-4 text-center">
      <p className="text-xs text-[#5b6573] mb-1">{label}</p>
      <p className="text-2xl font-bold text-[#202020]">
        {value.toLocaleString('ko-KR')}
        <span className="text-sm font-medium text-[#5b6573] ml-0.5">{unit}</span>
      </p>
    </div>
  );
}

export default function MonthlyReportPage() {
  const params = useParams<{ period: string }>();
  const period = typeof params?.period === 'string' ? params.period : '';

  const [state, setState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [report, setReport] = useState<MonthlyReportData | null>(null);
  const [createdAt, setCreatedAt] = useState('');
  const [hospitalName, setHospitalName] = useState('');

  const load = useCallback(async () => {
    if (!period || !isValidPeriod(period)) {
      setErrorMsg('잘못된 접근입니다. 기간 형식은 YYYY-MM 입니다.');
      setState('error');
      return;
    }
    setState('loading');
    setErrorMsg('');
    try {
      // 리포트 + 프로필(병원명) 병렬 조회 (컴플라이언스 리포트 페이지 패턴 동일)
      const [reportRes, profileRes] = await Promise.all([
        fetch(`/api/mypage/monthly-reports?period=${encodeURIComponent(period)}`),
        fetch('/api/profile'),
      ]);
      if (!reportRes.ok) {
        const json = await reportRes.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '리포트를 불러오지 못했습니다. 로그인 상태를 확인해주세요.');
      }
      const json = await reportRes.json() as {
        report: { period: string; createdAt: string; data: MonthlyReportData };
      };
      setReport(json.report.data);
      setCreatedAt(json.report.createdAt);

      if (profileRes.ok) {
        const profileJson = await profileRes.json().catch(() => ({})) as {
          profile?: { hospital_name?: string | null };
        };
        setHospitalName(profileJson.profile?.hospital_name ?? '');
      }
      setState('ready');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '리포트를 불러오지 못했습니다.');
      setState('error');
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-[#202020] font-semibold">리포트를 불러오는 중…</div>
      </div>
    );
  }

  if (state === 'error' || !report) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-600 text-sm mb-4">{errorMsg || '리포트를 표시할 수 없습니다.'}</p>
          <div className="flex items-center justify-center gap-3">
            <a
              href="/mypage?tab=rankings"
              className="px-4 py-2 border border-[#b4bfce] text-[#202020] text-sm font-semibold rounded-lg hover:bg-[#eef2f6] transition-colors"
            >
              성과 리포트 탭으로
            </a>
            <button
              type="button"
              onClick={() => void load()}
              className="px-4 py-2 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-lg transition-colors"
            >
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }

  const label = periodLabel(report.period);
  const limitText =
    report.usage.monthlyLimit === -1
      ? '무제한'
      : report.usage.monthlyLimit === 0
        ? '-'
        : `${report.usage.monthlyLimit}회`;

  return (
    <div className="min-h-screen bg-white text-[#202020]">
      {/* 인쇄 최적화 — 배경색 보존 + 페이지 여백 (report/[postId] 패턴 동일) */}
      <style>{`
        @media print {
          @page { margin: 12mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 print:py-0">
        {/* 상단 바 (화면 전용) */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8 print:hidden">
          <a href="/mypage?tab=rankings" className="text-sm text-[#5b6573] hover:text-[#202020] transition-colors">
            ← 성과 리포트 탭으로
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2.5 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-lg transition-colors"
          >
            PDF로 저장 / 인쇄
          </button>
        </div>

        {/* 리포트 헤더 */}
        <header className="border-b-2 border-[#ff4628] pb-5 mb-6">
          <LogoLockup variant="light" className="h-9 w-auto mb-4" />
          <h1 className="text-xl sm:text-2xl font-bold text-[#202020]">
            {label} 월간 성과 리포트
          </h1>
          <p className="text-sm text-[#5b6573] mt-1">
            닥터포스트가 지난달 우리 병원 블로그를 위해 해낸 일들입니다.
          </p>
        </header>

        {/* 메타 정보 */}
        <section className="mb-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {hospitalName && (
              <div className="flex gap-2">
                <dt className="text-[#5b6573] flex-shrink-0 w-20">병원명</dt>
                <dd className="font-medium text-[#202020]">{hospitalName}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="text-[#5b6573] flex-shrink-0 w-20">대상 기간</dt>
              <dd className="text-[#202020]">{label}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[#5b6573] flex-shrink-0 w-20">생성 시각</dt>
              <dd className="text-[#202020]">{formatDateTime(createdAt || report.generatedAt)}</dd>
            </div>
            {report.usage.planName && (
              <div className="flex gap-2">
                <dt className="text-[#5b6573] flex-shrink-0 w-20">이용 플랜</dt>
                <dd className="text-[#202020]">{report.usage.planName}</dd>
              </div>
            )}
          </dl>
        </section>

        {/* 핵심 지표 */}
        <section className="mb-8">
          <h2 className="text-base font-bold text-[#202020] mb-3">
            <span className="text-[#ff4628]">■</span> 지난달 핵심 지표
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="AI 글 생성" value={report.usage.generated} unit="회" />
            <StatCard label="발행한 글" value={report.posts.published} unit="건" />
            <StatCard label="의료광고법 검사" value={report.compliance.checked} unit="건" />
            <StatCard label="상위 10위 진입" value={report.rankings.top10Count} unit="건" />
          </div>
          <p className="text-[11px] text-[#5b6573] mt-2">
            · 의료광고법 검사는 닥터포스트 3층 검사 체계(키워드·상품명 + AI 심의관 + 주간 법규 리서치)로 수행되며, 글별 증빙 리포트가 함께 보관됩니다.
          </p>
        </section>

        {/* 검색 순위 성과 */}
        <section className="mb-8">
          <h2 className="text-base font-bold text-[#202020] mb-3">
            <span className="text-[#ff4628]">■</span> 검색 순위 성과
            <span className="ml-2 text-sm font-normal text-[#5b6573]">
              추적 키워드 {report.rankings.trackedKeywords}개
            </span>
          </h2>

          {report.rankings.improved.length === 0 ? (
            <div className="rounded-xl border border-[#b4bfce] bg-[#eef2f6] px-4 py-3 text-sm text-[#5b6573]">
              {report.rankings.trackedKeywords === 0
                ? '지난달 추적된 키워드가 없습니다. 글을 발행하고 블로그 주소를 등록하면 순위 추적이 시작됩니다.'
                : '지난달에는 순위가 상승한 글이 없습니다. 순위는 발행 후 시간이 지나며 서서히 오르는 경우가 많습니다.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-[#b4bfce] text-left">
                    <th className="py-2 pr-3 text-xs font-semibold text-[#5b6573]">순위 상승 글</th>
                    <th className="py-2 pr-3 text-xs font-semibold text-[#5b6573] whitespace-nowrap">키워드</th>
                    <th className="py-2 text-xs font-semibold text-[#5b6573] whitespace-nowrap text-right">순위 변화</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rankings.improved.map((p) => (
                    <tr key={p.postId} className="border-b border-[#eef2f6]">
                      <td className="py-2.5 pr-3 text-[#202020] font-medium leading-snug">{p.title}</td>
                      <td className="py-2.5 pr-3 text-[#5b6573] whitespace-nowrap">{p.keyword ? `#${p.keyword}` : '-'}</td>
                      <td className="py-2.5 whitespace-nowrap text-right">
                        <span className="text-[#5b6573]">{p.fromRank}위</span>
                        <span className="mx-1 text-[#b4bfce]">→</span>
                        <span className="font-bold text-[#ff4628]">{p.toRank}위</span>
                        <span className="ml-1.5 text-green-600 text-xs font-semibold">▲{p.fromRank - p.toRank}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 사용량 */}
        <section className="mb-8">
          <h2 className="text-base font-bold text-[#202020] mb-3">
            <span className="text-[#ff4628]">■</span> 지난달 이용 현황
          </h2>
          <div className="rounded-xl border border-[#b4bfce] p-4 text-sm">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <p className="text-[#202020]">
                AI 글 생성 <strong>{report.usage.generated}회</strong>
                <span className="text-[#5b6573]"> / 월 한도 {limitText}</span>
              </p>
              <p className="text-[#202020]">
                글 저장 <strong>{report.posts.created}건</strong>
              </p>
            </div>
          </div>
        </section>

        {/* 다음 달 추천 액션 */}
        <section className="mb-8">
          <h2 className="text-base font-bold text-[#202020] mb-3">
            <span className="text-[#ff4628]">■</span> 다음 달 추천 액션
          </h2>
          <ol className="space-y-2">
            {report.actions.map((action, i) => (
              <li key={i} className="flex items-start gap-3 rounded-xl border border-[#b4bfce] p-4">
                <span className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-lg bg-[#ffece7] text-[#ff4628] text-xs font-bold">
                  {i + 1}
                </span>
                <p className="text-sm text-[#202020] leading-relaxed">{action}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* 면책 고지 */}
        <footer className="border-t border-[#b4bfce] pt-4 pb-8">
          <p className="text-xs text-[#5b6573] leading-relaxed">
            본 리포트는 닥터포스트 이용 데이터를 규칙 기반으로 집계한 자동 리포트입니다.
            검색 순위는 네이버 블로그 검색 관련도(sort=sim) 기준 <strong className="text-[#4a4f55]">추정치</strong>이며,
            실제 노출·방문·문의 성과를 보장하지 않습니다.
          </p>
          <p className="text-xs text-[#8a93a0] mt-2">
            © 닥터포스트 (hospitalblog.kr) · 광고진정성
          </p>
        </footer>
      </div>
    </div>
  );
}
