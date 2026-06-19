'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import SeoAnalysis from '@/content/components/SeoAnalysis';
import OriginalityChecker from '@/content/components/OriginalityChecker';
import NaverPreview from '@/content/components/NaverPreview';
import type { BlogContent } from '@/types';

const STORAGE_KEY = 'dp_analysis_data';

interface AnalysisPayload {
  content: BlogContent;
  title: string;
  keyword: string;
}

function isAnalysisPayload(value: unknown): value is AnalysisPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === 'string' &&
    typeof v.keyword === 'string' &&
    v.content !== null &&
    typeof v.content === 'object'
  );
}

export default function AnalysisPage() {
  const [payload, setPayload] = useState<AnalysisPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isAnalysisPayload(parsed)) {
          setPayload(parsed);
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      // ignore corrupted storage entry
    } finally {
      setLoaded(true);
    }
  }, []);

  const handleClose = () => {
    window.close();
    // If window.close() is blocked (most cases for tabs not opened by script
    // in same flow, or by browser policy), show a toast.
    setTimeout(() => {
      if (!window.closed) {
        setToast('이 창은 자동으로 닫을 수 없습니다. 브라우저 탭을 직접 닫아주세요.');
      }
    }, 300);
  };

  return (
    <div className="min-h-screen bg-[#eaeef4] text-[#202020]">
      <header className="sticky top-0 z-40 border-b border-[#b4bfce] bg-white/85 backdrop-blur-md">
        <div className="max-w-screen-lg mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0">📊</span>
            <h1 className="text-sm sm:text-base font-bold text-[#202020] truncate">상세 분석</h1>
            {payload?.title && (
              <span className="hidden sm:inline text-xs text-[#5b6573] truncate ml-2">
                · {payload.title}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="창 닫기"
            className="flex-shrink-0 px-3 py-2 flex items-center gap-1.5 rounded-lg bg-[#eef2f6] text-[#202020] hover:bg-red-500/80 hover:text-white transition-colors text-sm font-semibold border border-[#b4bfce] hover:border-red-500"
          >
            <span className="text-base leading-none">✕</span>
            <span className="hidden sm:inline">창 닫기</span>
          </button>
        </div>
      </header>

      <main className="max-w-screen-lg mx-auto px-4 py-6 space-y-5">
        {!loaded ? (
          <div className="py-20 text-center text-[#5b6573] text-sm">불러오는 중...</div>
        ) : !payload ? (
          <div className="py-20 text-center">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-base font-semibold text-[#202020] mb-1">분석할 본문 데이터가 없습니다</p>
            <p className="text-xs text-[#5b6573] mb-5">
              본문 생성 후 메인 페이지에서 다시 시도해주세요.
            </p>
            <Link
              href="/app"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-bold rounded-xl transition-colors"
            >
              ← 메인으로
            </Link>
          </div>
        ) : (
          <>
            <SeoAnalysis content={payload.content} />
            <OriginalityChecker
              title={payload.content.title}
              body={payload.content.body}
              keyword={payload.keyword}
            />
            <NaverPreview
              title={payload.title}
              body={payload.content.body}
              keyword={payload.keyword}
            />
            <button
              type="button"
              onClick={handleClose}
              className="w-full py-3 rounded-xl bg-[#eef2f6] hover:bg-[#eef2f6] text-[#202020] text-sm font-semibold border border-[#b4bfce] hover:border-[#ff4628]/40 transition-colors"
            >
              창 닫기
            </button>
          </>
        )}
      </main>

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-3 rounded-xl bg-white border border-[#b4bfce] text-[#202020] text-sm shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)] z-50"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
