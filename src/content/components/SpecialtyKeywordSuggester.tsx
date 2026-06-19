'use client';

import { useState } from 'react';

interface SpecialtyKeywordSuggesterProps {
  specialty: string;
  region: string;
  onSelect: (keyword: string, isSelected: boolean) => void;
}

interface RecommendResponse {
  headKeywords?: string[];
  subKeywords?: string[];
  error?: string;
}

export default function SpecialtyKeywordSuggester({
  specialty,
  region,
  onSelect,
}: SpecialtyKeywordSuggesterProps) {
  const [headKeywords, setHeadKeywords] = useState<string[]>([]);
  const [subKeywords, setSubKeywords] = useState<string[]>([]);
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
    setHeadKeywords([]);
    setSubKeywords([]);
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

      setHeadKeywords(data.headKeywords ?? []);
      setSubKeywords(data.subKeywords ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChipClick = (keyword: string) => {
    const willBeSelected = !selected.has(keyword);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) {
        next.delete(keyword);
      } else {
        next.add(keyword);
      }
      return next;
    });
    onSelect(keyword, willBeSelected);
  };

  const totalCount = headKeywords.length + subKeywords.length;
  const hasResults = totalCount > 0;

  return (
    <div className="rounded-2xl border border-[#b4bfce] bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#ffece7] border border-[#ff4628]/30 flex items-center justify-center flex-shrink-0">
            <span className="text-[#ff4628] text-xs">🔍</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#202020]">진료과목별 키워드 추천</h3>
            <p className="text-[10px] text-[#5b6573]">고관여 + 서브(증상) 2종으로 추천</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRecommend}
          disabled={isLoading || !specialty.trim()}
          className="flex-shrink-0 px-3 py-2 bg-[#ff4628] hover:bg-[#e63a1c] active:bg-[#e63a1c] disabled:bg-[#b4bfce] disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 min-h-[36px]"
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
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {hasResults && (
        <div className="space-y-4">
          <p className="text-[10px] text-[#5b6573]">
            키워드를 클릭하면 입력창에 추가됩니다 (총 {totalCount}개)
          </p>

          {headKeywords.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[11px] font-bold text-[#ff4628]">🎯 고관여 키워드</span>
                <span className="text-[9px] text-[#73808f]">진료과목 직접 검색</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {headKeywords.map((kw) => (
                  <button
                    key={kw}
                    type="button"
                    onClick={() => handleChipClick(kw)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all active:scale-95 ${
                      selected.has(kw)
                        ? 'bg-[#ff4628] border-[#ff4628] text-white'
                        : 'bg-white border-[#b4bfce] text-[#5b6573] hover:border-[#ff4628]/50 hover:text-[#202020]'
                    }`}
                  >
                    {kw}
                  </button>
                ))}
              </div>
            </div>
          )}

          {subKeywords.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[11px] font-bold text-emerald-600">🩹 서브 키워드</span>
                <span className="text-[9px] text-[#73808f]">환자 증상·상태 검색</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {subKeywords.map((kw) => (
                  <button
                    key={kw}
                    type="button"
                    onClick={() => handleChipClick(kw)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all active:scale-95 ${
                      selected.has(kw)
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'bg-white border-[#b4bfce] text-[#5b6573] hover:border-emerald-400/50 hover:text-[#202020]'
                    }`}
                  >
                    {kw}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!hasResults && !isLoading && !error && (
        <p className="text-xs text-[#73808f] text-center py-2">
          &quot;키워드 추천 받기&quot; 버튼을 눌러 추천을 받아보세요
        </p>
      )}
    </div>
  );
}
