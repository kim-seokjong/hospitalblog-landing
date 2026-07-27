'use client';

import { useCallback, useRef, useState } from 'react';
import Logo from '@/components/landing/Logo';
import DiagnosisReportView from './DiagnosisReportView';
import ClinicCandidatePicker from './ClinicCandidatePicker';
import BlogGuessPicker from './BlogGuessPicker';
import DetailDiagnosisForm, { type DetailInput } from './DetailDiagnosisForm';
import type { ClinicCandidate, ClinicLookupOutcome, DiagnosisReport } from '@/content/lib/clinic-diagnosis/types';

/**
 * 병원명 무료진단 — 전용 페이지 (모바일 최적화).
 *
 * 흐름: 병원 이름 입력 → 후보 특정(1건이면 자동, 여러 건이면 선택)
 *      → 네 축 진단 → 결과(항목마다 지금상태/왜문제/뭘해야)
 *      → 자동 탐색이 실패했거나 더 보고 싶으면 상세 진단(주소·본문 직접 입력).
 *
 * 규칙: 라이트 랜딩 테마 명시(bg-white·text-[#202020]) — 다크 루트 상속 가드.
 *      매출·방문자 추정 금지, 타 병원 비교 금지, 의료광고법 단정 금지.
 */

const inputClass =
  'w-full px-4 py-3.5 rounded-xl border border-[#dbe2ea] bg-white text-[#202020] placeholder-[#8a93a0] focus:outline-none focus:border-[#ff4628] text-[15px]';

export default function ClinicCheckClient() {
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [showRegion, setShowRegion] = useState(false);

  const [lookup, setLookup] = useState<ClinicLookupOutcome | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [busyMngNo, setBusyMngNo] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  /** 응답 경합 가드 — 연속 실행 시 이전 응답이 최신 결과를 덮지 않도록. */
  const reqRef = useRef(0);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const regionRef = useRef<HTMLInputElement | null>(null);

  const runDiagnosis = useCallback(
    async (clinic: ClinicCandidate, detail?: DetailInput) => {
      const reqId = ++reqRef.current;
      setBusyMngNo(clinic.mngNo);
      setError(null);
      setShareUrl(null);
      try {
        const res = await fetch('/api/clinic-diagnosis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mngNo: clinic.mngNo,
            name: clinic.name,
            region: clinic.region,
            blogId: detail?.blogId || undefined,
            siteUrl: detail?.siteUrl || undefined,
            body: detail?.body || undefined,
            share: true,
          }),
        });
        const data = (await res.json()) as { report?: DiagnosisReport; shareUrl?: string | null; error?: string };
        if (reqId !== reqRef.current) return;
        if (!res.ok || !data.report) {
          setError(data.error ?? '진단에 실패했어요. 잠시 후 다시 시도해 주세요.');
          return;
        }
        setReport(data.report);
        setShareUrl(data.shareUrl ?? null);
        setShowDetail(false);
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
      } catch {
        if (reqId === reqRef.current) setError('네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
      } finally {
        if (reqId === reqRef.current) setBusyMngNo(null);
      }
    },
    [],
  );

  const runLookup = useCallback(async () => {
    const value = name.trim();
    if (value.length < 2) {
      setError('병원 이름을 2자 이상 입력해 주세요.');
      return;
    }
    const reqId = ++reqRef.current;
    setLookupLoading(true);
    setError(null);
    setLookup(null);
    setReport(null);
    setShareUrl(null);
    try {
      const res = await fetch('/api/clinic-diagnosis/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value, region: region.trim() }),
      });
      const data = (await res.json()) as { outcome?: ClinicLookupOutcome; error?: string };
      if (reqId !== reqRef.current) return;
      if (!data.outcome) {
        setError(data.error ?? '병원을 찾지 못했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }
      setLookup(data.outcome);
      if (data.outcome.kind === 'resolved') {
        // 정확히 1건일 때만 자동으로 진단까지 이어간다.
        void runDiagnosis(data.outcome.clinic);
      } else if (data.outcome.kind === 'unavailable' || data.outcome.kind === 'not_found') {
        setShowDetail(true);
      }
    } catch {
      if (reqId === reqRef.current) setError('네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      if (reqId === reqRef.current) setLookupLoading(false);
    }
  }, [name, region, runDiagnosis]);

  const handleNeedRegion = useCallback(() => {
    setShowRegion(true);
    setTimeout(() => regionRef.current?.focus(), 60);
  }, []);

  const selectedClinic =
    report?.clinic ?? (lookup?.kind === 'resolved' ? lookup.clinic : null);

  return (
    <div className="min-h-screen bg-white text-[#202020]">
      <div className="flex h-2">
        <i className="flex-1 bg-[#ff4628]" />
        <i className="flex-1 bg-[#202020]" />
        <i className="flex-1 bg-[#b8c8d7]" />
      </div>
      <header className="sticky top-0 z-40 border-b border-[#dbe2ea] bg-white/85 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between">
          <a href="/" aria-label="닥터포스트 홈" className="flex items-center min-w-0">
            <Logo variant="light" />
          </a>
          <span className="text-xs sm:text-sm font-bold text-[#4a4f55]">병원 온라인 노출 무료진단</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 sm:px-6 py-10 sm:py-14">
        <div className="text-center">
          <p className="text-[13px] font-extrabold text-[#ff4628] tracking-[2px]">FREE CHECK</p>
          <h1 className="text-[26px] sm:text-[40px] font-black leading-tight mt-2.5" style={{ letterSpacing: '-0.5px' }}>
            병원 이름만 넣으면
            <br className="sm:hidden" /> 온라인 노출 성적을 알려드려요
          </h1>
          <p className="text-[#4a4f55] mt-3 text-[15px] sm:text-base leading-relaxed">
            블로그·홈페이지·AI 검색 노출·의료광고법 표현까지
            <br className="hidden sm:block" />
            공개된 자료로 실제로 조회해서 무료로 진단해 드려요.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runLookup();
          }}
          className="mt-7 max-w-xl mx-auto"
        >
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="병원 이름 (예: 브이비성형외과의원)"
              className={inputClass}
              style={{ colorScheme: 'light' }}
              maxLength={60}
              required
            />
            <button
              type="submit"
              disabled={lookupLoading || busyMngNo !== null || name.trim().length < 2}
              className="flex-shrink-0 px-7 py-3.5 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-bold rounded-xl transition-all shadow-[0_12px_30px_-14px_rgba(255,70,40,0.30)] hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
            >
              {lookupLoading ? '병원 찾는 중…' : busyMngNo ? '진단 중…' : '무료 진단하기'}
            </button>
          </div>

          {showRegion ? (
            <input
              ref={regionRef}
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="지역 (예: 대구광역시 수성구)"
              className={`${inputClass} mt-3`}
              style={{ colorScheme: 'light' }}
              maxLength={30}
            />
          ) : (
            <button
              type="button"
              onClick={handleNeedRegion}
              className="mt-2.5 text-[12px] text-[#5b6573] underline underline-offset-2 min-h-[44px]"
            >
              같은 이름이 많다면 지역을 함께 넣어 주세요
            </button>
          )}
        </form>

        <p className="text-[11px] text-[#8a93a0] text-center mt-2.5 leading-relaxed">
          행정안전부 공표 정보 · 네이버 공개 API · 공개된 블로그 글과 홈페이지 열람만 사용해요 · 무료
        </p>

        {(lookupLoading || busyMngNo !== null) && (
          <div className="flex items-center justify-center gap-2 py-12">
            <span className="w-5 h-5 border-2 border-[#ff4628] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-[#5b6573]">
              {lookupLoading ? '등록된 병원 정보를 찾는 중…' : '블로그·홈페이지·AI 검색을 실제로 조회하는 중… (최대 1분)'}
            </span>
          </div>
        )}

        {error && (
          <div className="mt-8 max-w-xl mx-auto bg-yellow-50 border border-yellow-500/30 rounded-xl px-4 py-3.5 flex items-start gap-2">
            <span className="text-yellow-600 text-sm flex-shrink-0 mt-0.5">⚠</span>
            <p className="text-sm text-yellow-700">{error}</p>
          </div>
        )}

        {lookup && !report && !lookupLoading && (
          <ClinicCandidatePicker
            outcome={lookup}
            onPick={(clinic) => void runDiagnosis(clinic)}
            onNeedRegion={handleNeedRegion}
            busyMngNo={busyMngNo}
          />
        )}

        {report && !busyMngNo && (
          <div ref={resultRef} className="mt-10">
            <DiagnosisReportView report={report} />

            {/*
              블로그 후보 목록.
              · uncertain : 특정하지 못했다 → 골라 달라고 한다(진단은 나머지 축으로만 나갔다)
              · assumed   : 1위로 이미 진단했다 → **교체용**으로만 띄운다(흐름을 막지 않는다)
            */}
            {(report.blog.resolution.kind === 'uncertain' || report.blog.resolution.kind === 'assumed') && (
              <BlogGuessPicker
                guesses={report.blog.resolution.guesses}
                currentBlogId={report.blog.resolution.kind === 'assumed' ? report.blog.blogId : null}
                busy={busyMngNo !== null}
                onPick={(blogId) => void runDiagnosis(report.clinic, { blogId, siteUrl: '', body: '' })}
              />
            )}

            {shareUrl && (
              <div className="mt-6 bg-[#f7f9fb] border border-[#dbe2ea] rounded-2xl px-4 py-4">
                <p className="text-[13px] font-bold">이 진단 결과를 링크로 보낼 수 있어요</p>
                <p className="text-[12px] text-[#5b6573] mt-1 mb-2.5 leading-relaxed">
                  원장님께 그대로 전달하거나 나중에 다시 열어보실 수 있어요 (30일 후 만료).
                </p>
                <input
                  readOnly
                  value={typeof window !== 'undefined' ? `${window.location.origin}${shareUrl}` : shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className={inputClass}
                  style={{ colorScheme: 'light' }}
                />
              </div>
            )}

            {!showDetail && (
              <button
                type="button"
                onClick={() => setShowDetail(true)}
                className="w-full mt-4 px-6 py-3.5 min-h-[44px] bg-[#202020] text-white font-bold rounded-xl"
              >
                더 정확하게 — 주소를 직접 넣어 상세 진단하기
              </button>
            )}
          </div>
        )}

        {showDetail && (
          <DetailDiagnosisForm
            clinic={selectedClinic}
            busy={busyMngNo !== null}
            onSubmit={(detail) => {
              if (selectedClinic) void runDiagnosis(selectedClinic, detail);
            }}
          />
        )}
      </main>
    </div>
  );
}
