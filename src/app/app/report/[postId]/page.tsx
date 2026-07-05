'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { LogoLockup } from '@/components/landing/Logo';
import type { ComplianceGrade, ComplianceReportSnapshot, SavedPost } from '@/types';

/**
 * 컴플라이언스 검사 리포트 — 글별 증빙 페이지 (인쇄 최적화).
 *
 * - 본인 글만(/api/posts/[id] 가 로그인+본인 소유 검증).
 * - compliance_report 스냅샷이 없는 과거 글은 즉석 재검사(/compliance-recheck) 후
 *   저장해 다음부턴 재사용한다.
 * - "PDF로 저장" = window.print() (서버 PDF 생성 없음).
 * - 이 페이지는 인쇄용이라 예외적으로 흰 배경 고정을 허용한다(리포 규칙 예외).
 */

type LoadState = 'loading' | 'rechecking' | 'ready' | 'error';

const GRADE_STYLE: Record<ComplianceGrade, { label: string; badge: string; desc: string }> = {
  PASS: {
    label: '검출 없음 (통과)',
    badge: 'bg-green-50 text-green-700 border-green-300',
    desc: '자동 검사에서 의료광고법 위반 소지 표현이 검출되지 않았습니다.',
  },
  LOW: {
    label: 'LOW · 참고',
    badge: 'bg-[#eef2f6] text-[#5b6573] border-[#b4bfce]',
    desc: '경미한 주의 항목이 있습니다. 교육·정보성 서술이면 무방하나 확인을 권장합니다.',
  },
  MEDIUM: {
    label: 'MEDIUM · 확인 필요',
    badge: 'bg-yellow-50 text-yellow-700 border-yellow-300',
    desc: '심의 소지가 있는 표현이 검출되었습니다. 발행 전 확인을 권장합니다.',
  },
  HIGH: {
    label: 'HIGH · 검수 권장',
    badge: 'bg-orange-50 text-orange-700 border-orange-300',
    desc: '위반 소지가 큰 표현이 검출되었습니다. 발행 전 검수를 권장합니다.',
  },
  CRITICAL: {
    label: 'CRITICAL · 즉시 수정 권장',
    badge: 'bg-red-50 text-red-700 border-red-300',
    desc: '치료 결과 보장 등 위반 소지가 매우 큰 표현이 검출되었습니다. 수정 후 발행을 권장합니다.',
  },
};

function severityBadgeClass(severity: string): string {
  switch (severity) {
    case 'CRITICAL':
      return 'bg-red-50 text-red-700 border border-red-300';
    case 'HIGH':
      return 'bg-orange-50 text-orange-700 border border-orange-300';
    case 'MEDIUM':
      return 'bg-yellow-50 text-yellow-700 border border-yellow-300';
    default:
      return 'bg-[#eef2f6] text-[#5b6573] border border-[#b4bfce]';
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** 3층 검사 체계 설명(고정 안내문). */
const LAYER_DESCRIPTIONS: Array<{ layer: string; title: string; desc: string }> = [
  {
    layer: 'A',
    title: '키워드·상품명 검사',
    desc: '의료법 제56조 기반 금지·주의 표현 사전과 전문의약품·의료기기 상품명(위고비·써마지 등)을 전건 자동 대조합니다.',
  },
  {
    layer: 'B',
    title: 'AI 심의관 전건 검토',
    desc: '키워드 사전이 못 잡는 신종·맥락 위반을 AI 심의관이 의료법 제56조 8개 카테고리 기준으로 전건 재검토합니다.',
  },
  {
    layer: 'C',
    title: '주간 법규 리서치 반영',
    desc: '의료광고법 개정·심의 사례를 주간 리서치로 모니터링하고 검토를 거쳐 검사 룰셋에 반영합니다.',
  },
];

export default function ComplianceReportPage() {
  const params = useParams<{ postId: string }>();
  const postId = typeof params?.postId === 'string' ? params.postId : '';

  const [state, setState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [post, setPost] = useState<SavedPost | null>(null);
  const [report, setReport] = useState<ComplianceReportSnapshot | null>(null);
  const [hospitalName, setHospitalName] = useState('');

  const load = useCallback(async () => {
    if (!postId) {
      setErrorMsg('잘못된 접근입니다.');
      setState('error');
      return;
    }
    setState('loading');
    setErrorMsg('');
    try {
      // 글 + 프로필(병원명) 병렬 조회
      const [postRes, profileRes] = await Promise.all([
        fetch(`/api/posts/${postId}`),
        fetch('/api/profile'),
      ]);
      if (!postRes.ok) {
        const json = await postRes.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '글을 불러오지 못했습니다. 로그인 상태를 확인해주세요.');
      }
      const postJson = await postRes.json() as { post: SavedPost };
      setPost(postJson.post);

      if (profileRes.ok) {
        const profileJson = await profileRes.json().catch(() => ({})) as {
          profile?: { hospital_name?: string | null };
        };
        setHospitalName(profileJson.profile?.hospital_name ?? '');
      }

      if (postJson.post.compliance_report) {
        setReport(postJson.post.compliance_report);
        setState('ready');
        return;
      }

      // 스냅샷 없는 과거 글 — 즉석 재검사(A층 무조건 + B층 LLM 1회) 후 저장·재사용
      setState('rechecking');
      const recheckRes = await fetch(`/api/posts/${postId}/compliance-recheck`, { method: 'POST' });
      if (!recheckRes.ok) {
        const json = await recheckRes.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '재검사에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
      const recheckJson = await recheckRes.json() as { report: ComplianceReportSnapshot };
      setReport(recheckJson.report);
      setState('ready');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '리포트를 불러오지 못했습니다.');
      setState('error');
    }
  }, [postId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading' || state === 'rechecking') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-[#202020] font-semibold mb-1">
            {state === 'rechecking' ? '이 글을 재검사하고 있습니다…' : '리포트를 불러오는 중…'}
          </div>
          {state === 'rechecking' && (
            <p className="text-sm text-[#5b6573]">
              검사 기록이 없는 글은 즉석에서 다시 검사합니다. 잠시만 기다려주세요.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (state === 'error' || !post || !report) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-600 text-sm mb-4">{errorMsg || '리포트를 표시할 수 없습니다.'}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="px-4 py-2 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-lg transition-colors"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  const grade = GRADE_STYLE[report.grade] ?? GRADE_STYLE.LOW;
  const violations = report.keyword.violations;
  const warnings = report.keyword.warnings;
  const aiFindings = report.aiReview?.findings ?? [];
  const isPass = report.grade === 'PASS';

  return (
    <div className="min-h-screen bg-white text-[#202020]">
      {/* 인쇄 최적화 — 배경색 보존 + 페이지 여백 */}
      <style>{`
        @media print {
          @page { margin: 12mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 print:py-0">
        {/* 상단 바 (화면 전용) */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8 print:hidden">
          <a href="/mypage?tab=posts" className="text-sm text-[#5b6573] hover:text-[#202020] transition-colors">
            ← 콘텐츠 보관함으로
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
            의료광고법 컴플라이언스 검사 리포트
          </h1>
          <p className="text-sm text-[#5b6573] mt-1">
            닥터포스트 자동 검사 결과 증빙 — 의료법 제56조 기반
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
            <div className="flex gap-2 sm:col-span-2">
              <dt className="text-[#5b6573] flex-shrink-0 w-20">글 제목</dt>
              <dd className="font-medium text-[#202020]">{post.title}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[#5b6573] flex-shrink-0 w-20">검사 시각</dt>
              <dd className="text-[#202020]">{formatDateTime(report.checkedAt)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[#5b6573] flex-shrink-0 w-20">검사 엔진</dt>
              <dd className="text-[#202020]">{report.engine}</dd>
            </div>
          </dl>
        </section>

        {/* 최종 등급 */}
        <section className="mb-8">
          <div className={`rounded-xl border-2 px-5 py-4 ${grade.badge}`}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <span className="text-lg font-bold">{isPass ? '✅' : '⚠️'} {grade.label}</span>
              {report.needsManualReview && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/70 border border-current">
                  발행 전 검수 권장
                </span>
              )}
            </div>
            <p className="text-sm mt-1.5">{grade.desc}</p>
          </div>
        </section>

        {/* 3층 검사 체계 */}
        <section className="mb-8">
          <h2 className="text-base font-bold text-[#202020] mb-3">
            <span className="text-[#ff4628]">■</span> 닥터포스트 3층 검사 체계
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {LAYER_DESCRIPTIONS.map((l) => (
              <div key={l.layer} className="rounded-xl border border-[#b4bfce] p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-6 h-6 flex items-center justify-center rounded-lg bg-[#ffece7] text-[#ff4628] text-xs font-bold">
                    {l.layer}
                  </span>
                  <span className="text-sm font-semibold text-[#202020]">{l.title}</span>
                </div>
                <p className="text-xs text-[#5b6573] leading-relaxed">{l.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* A층 — 항목별 판정 */}
        <section className="mb-8">
          <h2 className="text-base font-bold text-[#202020] mb-3">
            <span className="text-[#ff4628]">■</span> A층 — 키워드·상품명 검사 결과
            <span className="ml-2 text-sm font-normal text-[#5b6573]">
              위반 소지 {violations.length}건 · 경고 {warnings.length}건
            </span>
          </h2>

          {violations.length === 0 && warnings.length === 0 && (
            <div className="rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
              금지·주의 표현 및 전문의약품·의료기기 상품명이 검출되지 않았습니다.
            </div>
          )}

          {violations.length > 0 && (
            <div className="space-y-2 mb-3">
              {violations.map((v, i) => (
                <div key={`${v.word}-${i}`} className="rounded-xl border border-[#b4bfce] p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${severityBadgeClass(v.severity)}`}>
                      {v.severity}
                    </span>
                    <span className="text-sm font-semibold text-[#202020]">&ldquo;{v.word}&rdquo;</span>
                  </div>
                  <p className="text-xs text-[#5b6573] mb-1">근거: {v.rule}</p>
                  {v.suggestion && (
                    <p className="text-xs text-[#202020]">권장 조치: {v.suggestion}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3">
              <p className="text-xs font-semibold text-yellow-700 mb-1.5">경고 (심의 소지 — 검출만, 최종 판단은 검수 필요)</p>
              <ul className="space-y-1">
                {warnings.map((w, i) => (
                  <li key={i} className="text-xs text-yellow-700 leading-relaxed">· {w}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* B층 — AI 심의관 */}
        <section className="mb-8">
          <h2 className="text-base font-bold text-[#202020] mb-3">
            <span className="text-[#ff4628]">■</span> B층 — AI 심의관 검토 결과
            {report.aiReview && (
              <span className="ml-2 text-sm font-normal text-[#5b6573]">지적 {aiFindings.length}건</span>
            )}
          </h2>

          {!report.aiReview && (
            <div className="rounded-xl border border-[#b4bfce] bg-[#eef2f6] px-4 py-3 text-sm text-[#5b6573]">
              이 글에는 AI 심의 기록이 없습니다. A층 키워드·상품명 검사 결과만으로 작성된 리포트입니다.
            </div>
          )}

          {report.aiReview && aiFindings.length === 0 && (
            <div className="rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
              AI 심의관 검토에서 추가 지적 사항이 없습니다.
            </div>
          )}

          {aiFindings.length > 0 && (
            <div className="space-y-2">
              {aiFindings.map((f, i) => (
                <div key={`${f.category}-${i}`} className="rounded-xl border border-[#b4bfce] p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${severityBadgeClass(f.severity)}`}>
                      {f.severity}
                    </span>
                    <span className="text-sm font-semibold text-[#202020]">{f.category}</span>
                    {f.needsReview && (
                      <span className="text-xs text-[#ff4628] font-medium">심의 필요</span>
                    )}
                  </div>
                  {f.snippet && (
                    <p className="text-xs text-[#5b6573] mb-1 break-words">해당 표현: &ldquo;{f.snippet}&rdquo;</p>
                  )}
                  {f.reason && <p className="text-xs text-[#202020]">{f.reason} (위반 소지 · 검수 필요)</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 면책 고지 */}
        <footer className="border-t border-[#b4bfce] pt-4 pb-8">
          <p className="text-xs text-[#5b6573] leading-relaxed">
            본 리포트는 닥터포스트 자동 검사 결과로, 법률 자문이나 의료광고 사전심의를 대체하지
            않습니다. 표시된 항목은 &ldquo;위반&rdquo;의 단정이 아닌 &ldquo;위반 소지·심의 필요&rdquo;
            판정이며, 최종 판단은 의료광고 심의기관 및 법률 전문가의 검토를 권장합니다.
          </p>
          <p className="text-xs text-[#8a93a0] mt-2">
            © 닥터포스트 (hospitalblog.kr) · 광고진정성
          </p>
        </footer>
      </div>
    </div>
  );
}
