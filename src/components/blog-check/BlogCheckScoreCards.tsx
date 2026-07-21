'use client';

import type { BlogCheckSimpleResult } from '@/content/lib/blog-check';

/**
 * 무료진단 점수표 — 스코어보드 카드 스타일(scoreboard/*Card 계열) 재사용.
 * 공개 지표 기반 점수만 표시 — 매출·방문자 추정 금지, 타 병원 비교 금지.
 */

function scoreTone(score: number): string {
  if (score >= 70) return 'text-emerald-600';
  if (score >= 40) return 'text-amber-600';
  return 'text-[#e63a1c]';
}

const CADENCE_BADGE: Record<string, string> = {
  우수: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  양호: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  불규칙: 'bg-amber-50 text-amber-600 border-amber-200',
  방치: 'bg-red-50 text-red-500 border-red-200',
};

export default function BlogCheckScoreCards({ result }: { result: BlogCheckSimpleResult }) {
  const { scores } = result;
  const cards = [
    {
      icon: '🔍',
      label: '네이버 SEO',
      value: (
        <span className={`text-3xl font-black ${scoreTone(scores.seo)}`}>
          {scores.seo}
          <span className="text-sm font-bold text-[#8a93a0]">/100</span>
        </span>
      ),
      sub: `노출 ${scores.seoBreakdown.exposure} · 꾸준함 ${scores.seoBreakdown.consistency} · 정합성 ${scores.seoBreakdown.fit}`,
    },
    {
      icon: '🤖',
      label: 'AI 검색 (GEO)',
      value: (
        <span className={`text-3xl font-black ${scoreTone(scores.geo)}`}>
          {scores.geo}
          <span className="text-sm font-bold text-[#8a93a0]">/100</span>
        </span>
      ),
      sub: '네이버 블로그 단독 운영의 구조적 상한',
    },
    {
      icon: '🛡️',
      label: '의료광고법 위험 신호',
      value: (
        <span className={`text-3xl font-black ${scores.complianceCount === 0 ? 'text-emerald-600' : 'text-[#e63a1c]'}`}>
          {scores.complianceCount}
          <span className="text-sm font-bold text-[#8a93a0]">건</span>
        </span>
      ),
      sub: scores.complianceCount === 0 ? '최근 글에서 검출 없음' : '검출 문구는 상세분석에서 확인',
    },
    {
      icon: '📅',
      label: '발행 꾸준함',
      value: (
        <span className={`inline-block text-sm font-bold px-3 py-1.5 rounded-full border ${CADENCE_BADGE[scores.cadenceGrade] ?? ''}`}>
          {scores.cadenceGrade}
        </span>
      ),
      sub: `최근 12주 평균 주 ${scores.postsPerWeek}편`,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {cards.map(({ icon, label, value, sub }) => (
        <div
          key={label}
          className="bg-white border border-[#b4bfce] rounded-2xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-[#ffece7] flex items-center justify-center flex-shrink-0">
              <span className="text-sm">{icon}</span>
            </div>
            <h3 className="text-[12px] sm:text-sm font-bold text-[#202020] leading-tight">{label}</h3>
          </div>
          <div className="min-h-[44px] flex items-center">{value}</div>
          <p className="text-[11px] text-[#73808f] mt-1.5 leading-snug">{sub}</p>
        </div>
      ))}
    </div>
  );
}
