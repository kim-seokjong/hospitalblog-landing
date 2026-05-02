'use client';

import { useState } from 'react';

interface SpecialtyKeywordSuggesterProps {
  specialty: string;
  region: string;
  onSelect: (keyword: string) => void;
}

interface RecommendResponse {
  keywords?: string[];
  error?: string;
}

export default function SpecialtyKeywordSuggester({
  specialty,
  region,
  onSelect,
}: SpecialtyKeywordSuggesterProps) {
  const [keywords, setKeywords] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const handleRecommend = async () => {
    if (!specialty.trim()) {
      setError('진료과목을 먼저 선택해주세요.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setKeywords([]);
    setSelected(new Set());

    try {
      const res = await fetch('/api/keywords/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specialty: specialty.trim(), region: region.trim() }),
      });

      const data = await res.json() as RecommendResponse;

      if (!res.ok) {
        throw new Error(data.error ?? '키워드 추천에 실패했습니다.');
      }

      setKeywords(data.keywords ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChipClick = (keyword: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) {
        next.delete(keyword);
      } else {
        next.add(keyword);
      }
      return next;
    });
    onSelect(keyword);
  };

  return (
    <div className="rounded-2xl border border-[#2a2b6e] bg-[#12153d] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#191970] border border-[#4f6ef7]/30 flex items-center justify-center flex-shrink-0">
            <span className="text-[#4f6ef7] text-xs">🔍</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">진료과목별 키워드 추천</h3>
            <p className="text-[10px] text-[#8891bd]">AI가 SEO 키워드를 추천해 드립니다</p>
          </div>
        </div>

        <button
          onClick={handleRecommend}
          disabled={isLoading || !specialty.trim()}
          className="flex-shrink-0 px-3 py-2 bg-[#4f6ef7] hover:bg-[#3d5ef0] active:bg-[#2d4ee0] disabled:bg-[#2a2b6e] disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 min-h-[36px]"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-3 w-3 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>추천 중...</span>
            </>
          ) : (
            <span>키워드 추천 받기</span>
          )}
        </button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {keywords.length > 0 && (
        <div>
          <p className="text-[10px] text-[#8891bd] mb-2">
            키워드를 클릭하면 입력창에 추가됩니다 ({keywords.length}개)
          </p>
          <div className="flex flex-wrap gap-2">
            {keywords.map((kw) => (
              <button
                key={kw}
                onClick={() => handleChipClick(kw)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all active:scale-95 ${
                  selected.has(kw)
                    ? 'bg-[#4f6ef7] border-[#4f6ef7] text-white'
                    : 'bg-[#0b0d2b] border-[#2a2b6e] text-[#8891bd] hover:border-[#4f6ef7]/50 hover:text-white'
                }`}
              >
                {kw}
              </button>
            ))}
          </div>
        </div>
      )}

      {keywords.length === 0 && !isLoading && !error && (
        <p className="text-xs text-[#555d8a] text-center py-2">
          &quot;키워드 추천 받기&quot; 버튼을 눌러 추천을 받아보세요
        </p>
      )}
    </div>
  );
}
