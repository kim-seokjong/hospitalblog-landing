'use client';

import type { BlogContent } from '@/types';

interface SeoAnalysisProps {
  content: BlogContent;
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  const r = 20;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={r} fill="none" stroke="#f3f4f6" strokeWidth="6" />
        <circle
          cx="28" cy="28" r={r} fill="none"
          stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 28 28)"
        />
        <text x="28" y="33" textAnchor="middle" fontSize="12" fontWeight="700" fill={color}>{score}</text>
      </svg>
      <span className="text-xs text-gray-500 text-center leading-tight">{label}</span>
    </div>
  );
}

export default function SeoAnalysis({ content }: SeoAnalysisProps) {
  const { seoAnalysis, imageGuidelines } = content;

  const keywordOk = seoAnalysis.keywordCount >= 4 && seoAnalysis.keywordCount <= 6;
  const h2Ok = seoAnalysis.h2Count >= 4;
  const h3Ok = seoAnalysis.h3Count >= 2;
  const charOk = content.charCount >= 1500;
  const firstParaOk = seoAnalysis.firstParaKeyword;
  const subheadingOk = seoAnalysis.subheadingWithKeyword >= 2;
  const longtailOk = seoAnalysis.longtailCoverage >= 3;

  const overallScore = Math.round(
    (seoAnalysis.structureScore * 0.25) +
    (keywordOk ? 100 : 60) * 0.2 +
    (charOk ? 100 : 60) * 0.15 +
    (content.compliance.isCompliant ? 100 : 50) * 0.15 +
    (firstParaOk ? 100 : 50) * 0.1 +
    (subheadingOk ? 100 : 50) * 0.1 +
    (longtailOk ? 100 : 50) * 0.05
  );

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5">
        <h3 className="text-white font-bold text-base">네이버 SEO 분석 리포트</h3>
        <p className="text-blue-100 text-xs mt-0.5">C-Rank · D.I.A+ 기준 최적화 분석</p>
      </div>

      <div className="p-5">
        {/* 종합 점수 */}
        <div className="flex items-center justify-around mb-5">
          <ScoreRing score={overallScore} label="종합 SEO" />
          <ScoreRing score={seoAnalysis.structureScore} label="구조 점수" />
          <ScoreRing score={content.compliance.isCompliant ? 100 : Math.max(0, 100 - content.compliance.violations.length * 20)} label="광고법 준수" />
          <ScoreRing score={charOk ? 100 : Math.round((content.charCount / 1400) * 100)} label="글자수" />
        </div>

        {/* 체크리스트 */}
        <div className="space-y-2 mb-4">
          <h4 className="text-xs font-bold text-gray-700 mb-2">상위노출 체크리스트</h4>
          {[
            { ok: charOk, label: `글자수 ${content.charCount.toLocaleString()}자`, sub: '1,500자 이상 권장' },
            { ok: h2Ok, label: `H2 소제목 ${seoAnalysis.h2Count}개`, sub: '4~5개 권장' },
            { ok: h3Ok, label: `H3 세부소제목 ${seoAnalysis.h3Count}개`, sub: '2개 이상 권장' },
            { ok: keywordOk, label: `핵심 키워드 ${seoAnalysis.keywordCount}회`, sub: '4~6회 권장' },
            { ok: firstParaOk, label: '첫 단락 키워드 포함', sub: 'D.I.A+ 200자 가산점' },
            { ok: subheadingOk, label: `소제목 키워드 포함 ${seoAnalysis.subheadingWithKeyword}개`, sub: '2개 이상 권장' },
            { ok: longtailOk, label: `롱테일 키워드 ${seoAnalysis.longtailCoverage}/${seoAnalysis.longtailTotal}개`, sub: '3개 이상 권장' },
            { ok: content.compliance.isCompliant, label: '의료광고법 준수', sub: '금지어 없음' },
            { ok: imageGuidelines.placementHints.length >= 4, label: `이미지 위치 ${imageGuidelines.placementHints.length}곳`, sub: '5곳 이상 권장' },
          ].map(({ ok, label, sub }, i) => (
            <div key={i} className={`flex items-center gap-2 p-2 rounded-lg ${ok ? 'bg-green-50' : 'bg-amber-50'}`}>
              <span className={`text-sm flex-shrink-0 ${ok ? 'text-green-600' : 'text-amber-500'}`}>
                {ok ? '✓' : '△'}
              </span>
              <div className="flex-1 min-w-0">
                <span className={`text-xs font-semibold ${ok ? 'text-green-800' : 'text-amber-700'}`}>{label}</span>
                <span className="text-xs text-gray-400 ml-1">({sub})</span>
              </div>
            </div>
          ))}
        </div>

        {/* 읽기 시간 */}
        <div className="bg-gray-50 rounded-xl p-3 flex items-center gap-3">
          <span className="text-2xl">⏱</span>
          <div>
            <p className="text-xs font-bold text-gray-700">예상 읽기 시간</p>
            <p className="text-sm font-bold text-blue-600">{seoAnalysis.estimatedReadingTime}분</p>
            <p className="text-xs text-gray-400">체류 시간이 길수록 D.I.A+ 가산점</p>
          </div>
        </div>
      </div>
    </div>
  );
}
