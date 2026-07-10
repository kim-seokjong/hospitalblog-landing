'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CopySuggestion } from '@/content/lib/thumbnail/copy-suggest';

interface ThumbnailCopySuggestProps {
  /** 원제(글 제목) — 카피 변환 입력 */
  title: string;
  /** 핵심 키워드 (선택) */
  keyword?: string;
  /** 제안 선택 시 (제목/라벨/강조 어절 적용) */
  onApply: (suggestion: CopySuggestion) => void;
}

interface SuggestState {
  loading: boolean;
  error?: string;
  suggestions: CopySuggestion[];
}

/**
 * 썸네일 카피 5안 자동 제안 패널.
 * 스튜디오가 열릴 때 글 제목으로 카피를 자동 로드하고, 클릭 한 번으로 적용한다.
 */
export default function ThumbnailCopySuggest({ title, keyword, onApply }: ThumbnailCopySuggestProps) {
  const [state, setState] = useState<SuggestState>({ loading: false, suggestions: [] });
  const [applied, setApplied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!title.trim()) return;
    setState({ loading: true, suggestions: [] });
    try {
      const res = await fetch('/api/thumbnail-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, keyword: keyword || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        suggestions?: CopySuggestion[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || '카피 제안 실패');
      setState({ loading: false, suggestions: Array.isArray(json.suggestions) ? json.suggestions : [] });
    } catch (e) {
      setState({
        loading: false,
        suggestions: [],
        error: e instanceof Error ? e.message : '카피 제안 실패',
      });
    }
  }, [title, keyword]);

  // 열릴 때 1회 자동 로드
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <div className="w-4 h-4 border-2 border-[#ff4628] border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-[#5b6573]">제목을 썸네일 카피로 변환 중...</p>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex items-center gap-2 py-1">
        <p className="text-[11px] text-[#ff4628]">{state.error}</p>
        <button
          onClick={() => void load()}
          className="text-[11px] font-bold text-[#5b6573] underline"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (state.suggestions.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-bold text-[#4a4f55]">
          카피 제안 <span className="font-normal text-[#73808f]">— 클릭하면 제목·라벨·강조 어절에 적용</span>
        </label>
        <button
          onClick={() => void load()}
          className="text-[11px] font-bold text-[#5b6573] hover:text-[#ff4628]"
        >
          ↺ 다시 제안
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {state.suggestions.map((s) => {
          const isApplied = applied === s.pattern;
          return (
            <button
              key={s.pattern}
              onClick={() => {
                setApplied(s.pattern);
                onApply(s);
              }}
              className={`text-left p-2.5 rounded-xl border transition-colors ${
                isApplied
                  ? 'border-[#ff4628] bg-[#ffece7]'
                  : 'border-[#e2e8ef] bg-[#f7f9fb] hover:border-[#ff4628]/50'
              }`}
            >
              <p className="text-[10px] font-bold text-[#ff4628] mb-1">{s.patternLabel}</p>
              <p className="text-[12px] font-extrabold text-[#202020] leading-snug">
                {[s.line1, s.line2].filter(Boolean).map((line, i) => (
                  <span key={i} className="block">
                    {line!.split(/(\s+)/).map((tok, j) =>
                      s.accentWord && tok.includes(s.accentWord) ? (
                        <span key={j} className="text-[#ff4628]">{tok}</span>
                      ) : (
                        <span key={j}>{tok}</span>
                      ),
                    )}
                  </span>
                ))}
              </p>
              {s.klabel ? (
                <p className="text-[10px] text-[#73808f] mt-1 truncate">라벨: {s.klabel}</p>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
