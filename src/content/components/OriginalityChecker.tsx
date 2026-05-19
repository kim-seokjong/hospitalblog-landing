'use client';

import { useState } from 'react';

interface Risk {
  sentence: string;
  reason: string;
  severity: '높음' | '중간' | '낮음';
}

interface Analysis {
  originalityScore: number;
  riskLevel: '낮음' | '중간' | '높음';
  summary: string;
  risks: Risk[];
  suggestions: string[];
  verdict: '통과' | '수정권장' | '재작성권장';
}

interface SimilarPost {
  title: string;
  description: string;
  link: string;
  blogger: string;
  date: string;
}

interface OriginalityResult {
  analysis: Analysis;
  similarPosts: SimilarPost[];
  checkedAt: string;
  naverWarning?: string;
}

interface OriginalityCheckerProps {
  title: string;
  body: string;
  keyword: string;
}

const VERDICT_STYLE = {
  '통과': { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', badge: 'bg-green-500', icon: '✅' },
  '수정권장': { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', badge: 'bg-amber-500', icon: '⚠️' },
  '재작성권장': { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', badge: 'bg-red-500', icon: '❌' },
};

const SEVERITY_STYLE = {
  '높음': 'bg-red-100 text-red-700 border-red-200',
  '중간': 'bg-amber-100 text-amber-700 border-amber-200',
  '낮음': 'bg-blue-100 text-blue-700 border-blue-200',
};

export default function OriginalityChecker({ title, body, keyword }: OriginalityCheckerProps) {
  const [result, setResult] = useState<OriginalityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSimilar, setShowSimilar] = useState(false);

  const handleCheck = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/check-originality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, keyword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '검사 실패');
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const score = result?.analysis.originalityScore ?? 0;
  const verdict = result?.analysis.verdict;
  const style = verdict ? VERDICT_STYLE[verdict] : null;

  const scoreColor =
    score >= 80 ? 'text-green-600' :
    score >= 60 ? 'text-amber-500' : 'text-red-500';

  const scoreBarColor =
    score >= 80 ? 'bg-green-500' :
    score >= 60 ? 'bg-amber-400' : 'bg-red-500';

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
      {/* 헤더 */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-500 rounded-xl flex items-center justify-center">
            <span className="text-white text-lg">🔍</span>
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-gray-800">독창성 검사</h2>
            <p className="text-xs text-gray-500">네이버 블로그 유사 글 비교 · Claude AI 분석</p>
          </div>
          {result && (
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full text-white ${style?.badge}`}>
              {style?.icon} {verdict}
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* 검사 버튼 */}
        <button
          onClick={handleCheck}
          disabled={loading}
          className="w-full py-3 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              네이버 검색 중 · AI 분석 중...
            </>
          ) : (
            <><span>🔍</span> {result ? '다시 검사하기' : '독창성 검사 시작'}</>
          )}
        </button>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {/* 네이버 검색 경고 */}
            {result.naverWarning && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                ⚠️ {result.naverWarning}
              </div>
            )}
            {/* 점수 */}
            <div className={`rounded-xl border p-4 ${style?.bg} ${style?.border}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-gray-700">독창성 점수</span>
                <span className={`text-3xl font-black ${scoreColor}`}>{score}점</span>
              </div>
              <div className="w-full bg-white/60 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-3 rounded-full transition-all duration-700 ${scoreBarColor}`}
                  style={{ width: `${score}%` }}
                />
              </div>
              <p className={`text-sm font-medium mt-2 ${style?.text}`}>
                {style?.icon} {result.analysis.summary}
              </p>
            </div>

            {/* 위험 요소 */}
            {(result.analysis.risks ?? []).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-600">⚠️ 유사 표현 감지 ({(result.analysis.risks ?? []).length}건)</p>
                {(result.analysis.risks ?? []).map((risk, i) => (
                  <div key={i} className={`rounded-lg border p-3 ${SEVERITY_STYLE[risk.severity]}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${SEVERITY_STYLE[risk.severity]}`}>
                        {risk.severity}
                      </span>
                      <span className="text-xs font-medium truncate">{risk.sentence}</span>
                    </div>
                    <p className="text-xs opacity-80">{risk.reason}</p>
                  </div>
                ))}
              </div>
            )}

            {/* 개선 제안 */}
            {(result.analysis.suggestions ?? []).length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-xs font-bold text-blue-700 mb-2">💡 개선 제안</p>
                <ul className="space-y-1">
                  {(result.analysis.suggestions ?? []).map((s, i) => (
                    <li key={i} className="text-xs text-blue-700 flex items-start gap-1.5">
                      <span className="flex-shrink-0 mt-0.5">•</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 유사 글 목록 */}
            <div>
              <button
                onClick={() => setShowSimilar(v => !v)}
                className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-700"
              >
                <span>{showSimilar ? '▼' : '▶'}</span>
                네이버 검색 유사 글 ({result.similarPosts.length}건)
              </button>

              {showSimilar && (
                <div className="mt-2 space-y-2">
                  {result.similarPosts.map((post, i) => (
                    <a
                      key={i}
                      href={post.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-gray-50 border border-gray-200 rounded-lg p-3 hover:bg-gray-100 transition-colors"
                    >
                      <p className="text-xs font-bold text-blue-700 truncate">{post.title}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{post.description}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{post.blogger} · {post.date}</p>
                    </a>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[10px] text-gray-400 text-center">
              검사 시각: {new Date(result.checkedAt).toLocaleString('ko-KR')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
