'use client';

import { useState } from 'react';

interface TrendData {
  period: string;
  ratio: number;
}

interface TrendResult {
  title: string;
  keywords: string[];
  data: TrendData[];
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

function SparkLine({ data, color }: { data: TrendData[]; color: string }) {
  if (data.length === 0) return null;
  const W = 260, H = 80, PAD = 8;
  const max = Math.max(...data.map(d => d.ratio), 1);
  const points = data.map((d, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - d.ratio / max) * (H - PAD * 2);
    return `${x},${y}`;
  });
  const lastPoint = points[points.length - 1].split(',');
  const lastRatio = data[data.length - 1].ratio;

  return (
    <svg width={W} height={H} className="w-full">
      {/* 배경 그리드 */}
      {[0, 0.5, 1].map(r => (
        <line key={r}
          x1={PAD} y1={PAD + (1 - r) * (H - PAD * 2)}
          x2={W - PAD} y2={PAD + (1 - r) * (H - PAD * 2)}
          stroke="#e5e7eb" strokeWidth="1" />
      ))}
      {/* 영역 채우기 */}
      <polygon
        points={`${PAD},${H - PAD} ${points.join(' ')} ${W - PAD},${H - PAD}`}
        fill={color} opacity="0.1" />
      {/* 라인 */}
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* 마지막 점 */}
      <circle cx={lastPoint[0]} cy={lastPoint[1]} r="4" fill={color} />
      <text x={Number(lastPoint[0]) + 6} y={Number(lastPoint[1]) + 4} fontSize="10" fill={color} fontWeight="bold">
        {lastRatio.toFixed(0)}
      </text>
    </svg>
  );
}

function getTrend(data: TrendData[]): { label: string; color: string; icon: string } {
  if (data.length < 3) return { label: '데이터 부족', color: 'text-gray-400', icon: '➖' };
  const recent = data.slice(-3).reduce((s, d) => s + d.ratio, 0) / 3;
  const prev = data.slice(-6, -3).reduce((s, d) => s + d.ratio, 0) / 3;
  const diff = recent - prev;
  if (diff > 5) return { label: '상승 중', color: 'text-green-600', icon: '📈' };
  if (diff < -5) return { label: '하락 중', color: 'text-red-500', icon: '📉' };
  return { label: '안정적', color: 'text-blue-600', icon: '➡️' };
}

function getPeak(data: TrendData[]): string {
  if (data.length === 0) return '-';
  const peak = data.reduce((a, b) => a.ratio > b.ratio ? a : b);
  return peak.period.slice(0, 7);
}

export default function KeywordTrend({ mainKeyword }: { mainKeyword: string }) {
  const [compareKeyword, setCompareKeyword] = useState('');
  const [results, setResults] = useState<TrendResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    const keywords = [mainKeyword, compareKeyword.trim()].filter(Boolean);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/keyword-trend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResults(data.results || []);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center">
            <span className="text-white text-lg">📊</span>
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-800">검색 트렌드</h2>
            <p className="text-xs text-gray-500">네이버 DataLab · 최근 12개월</p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* 비교 키워드 입력 */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              value={compareKeyword}
              onChange={e => setCompareKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="비교 키워드 입력 (선택)"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-4 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white text-sm font-bold rounded-xl transition-colors flex items-center gap-1.5"
          >
            {loading ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : '📊'}
            조회
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600">{error}</div>
        )}

        {/* 결과 */}
        {searched && results.length > 0 && (
          <div className="space-y-4">
            {results.map((result, idx) => {
              const trend = getTrend(result.data);
              const peak = getPeak(result.data);
              const avg = result.data.length > 0
                ? (result.data.reduce((s, d) => s + d.ratio, 0) / result.data.length).toFixed(1)
                : '0';
              const color = COLORS[idx % COLORS.length];

              return (
                <div key={result.title} className="border border-gray-100 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-sm font-bold text-gray-800">{result.title}</span>
                    </div>
                    <span className={`text-xs font-bold ${trend.color}`}>{trend.icon} {trend.label}</span>
                  </div>

                  <SparkLine data={result.data} color={color} />

                  {/* 월 레이블 */}
                  <div className="flex justify-between text-[9px] text-gray-400 px-1">
                    {result.data.filter((_, i) => i % 3 === 0).map(d => (
                      <span key={d.period}>{d.period.slice(5, 7)}월</span>
                    ))}
                    <span>현재</span>
                  </div>

                  {/* 통계 뱃지 */}
                  <div className="flex gap-2 flex-wrap">
                    <span className="text-[11px] bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full font-medium">
                      평균 {avg}
                    </span>
                    <span className="text-[11px] bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full font-medium">
                      최고 {peak}
                    </span>
                    <span className="text-[11px] bg-orange-50 text-orange-600 px-2.5 py-1 rounded-full font-medium">
                      현재 {result.data[result.data.length - 1]?.ratio.toFixed(0) ?? 0}점
                    </span>
                  </div>
                </div>
              );
            })}

            {/* 비교 요약 */}
            {results.length >= 2 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <p className="text-xs font-bold text-orange-700 mb-1">📌 비교 분석</p>
                {(() => {
                  const r0 = results[0].data[results[0].data.length - 1]?.ratio ?? 0;
                  const r1 = results[1].data[results[1].data.length - 1]?.ratio ?? 0;
                  const winner = r0 >= r1 ? results[0].title : results[1].title;
                  const diff = Math.abs(r0 - r1).toFixed(0);
                  return (
                    <p className="text-xs text-orange-700">
                      현재 <strong>{winner}</strong>이 더 많이 검색됩니다. (차이: {diff}점)
                      <br />SEO 효과를 위해 <strong>{winner}</strong> 키워드를 우선 사용하세요.
                    </p>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {!searched && (
          <p className="text-xs text-gray-400 text-center py-2">
            조회 버튼을 누르면 최근 12개월 검색 트렌드를 확인할 수 있습니다
          </p>
        )}
      </div>
    </div>
  );
}
