'use client';

import { useEffect } from 'react';
import SeoAnalysis from '@/content/components/SeoAnalysis';
import OriginalityChecker from '@/content/components/OriginalityChecker';
import NaverPreview from '@/content/components/NaverPreview';
import type { BlogContent } from '@/types';

interface AnalysisModalProps {
  open: boolean;
  onClose: () => void;
  content: BlogContent;
  title: string;
  keyword: string;
}

export default function AnalysisModal({ open, onClose, content, title, keyword }: AnalysisModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-stretch sm:items-center justify-center bg-black/85 backdrop-blur-md isolate"
      onClick={onClose}
    >
      <div
        className="relative w-full sm:w-[min(960px,92vw)] max-h-screen sm:max-h-[90vh] flex flex-col bg-[#0b0d2b] sm:rounded-2xl border-0 sm:border sm:border-[#2a2b6e] shadow-2xl overflow-hidden isolate"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-[#2a2b6e] bg-[#12153d] sticky top-0 z-30">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0">📊</span>
            <h2 className="text-sm sm:text-base font-bold text-white truncate">상세 분석</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-lg bg-[#191970]/40 text-white hover:bg-red-500/80 hover:text-white transition-colors text-2xl leading-none font-bold border border-[#2a2b6e] hover:border-red-500"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-5">
          <SeoAnalysis content={content} />
          <OriginalityChecker title={content.title} body={content.body} keyword={keyword} />
          <NaverPreview title={title} body={content.body} keyword={keyword} />

          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-[#191970]/60 hover:bg-[#191970] text-white text-sm font-semibold border border-[#2a2b6e] hover:border-[#4a4ba0] transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
