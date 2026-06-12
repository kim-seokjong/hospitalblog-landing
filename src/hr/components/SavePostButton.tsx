'use client';

import { useState } from 'react';
import type { TargetSite } from '@/types';

interface SavePostButtonProps {
  title: string;
  content: string;
  keyword: string;
  tags: string[];
  seoScore: number;
  /** 게시 사이트 ('naver' | 'google') — 미전달 시 body에서 생략되어 target_site는 null로 저장됨 */
  targetSite?: TargetSite;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function SavePostButton({
  title,
  content,
  keyword,
  tags,
  seoScore,
  targetSite,
}: SavePostButtonProps) {
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSave = async () => {
    if (saveState === 'saving') return;

    setSaveState('saving');
    setErrorMessage('');

    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content,
          keyword,
          tags,
          seo_score: seoScore,
          ...(targetSite ? { target_site: targetSite } : {}),
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? '저장에 실패했습니다.');
      }

      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : '저장에 실패했습니다.';
      setErrorMessage(message);
      setSaveState('error');
      setTimeout(() => {
        setSaveState('idle');
        setErrorMessage('');
      }, 3000);
    }
  };

  const buttonContent = () => {
    switch (saveState) {
      case 'saving':
        return (
          <span className="flex items-center gap-2">
            <svg
              className="w-4 h-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            저장 중...
          </span>
        );
      case 'saved':
        return <span>저장됨 ✓</span>;
      case 'error':
        return <span>저장 실패</span>;
      default:
        return <span>저장함에 보관</span>;
    }
  };

  const colorClass = () => {
    switch (saveState) {
      case 'saved':
        return 'bg-emerald-700 text-white cursor-default';
      case 'error':
        return 'bg-red-600 hover:bg-red-500 text-white';
      case 'saving':
        return 'bg-emerald-700 text-white cursor-wait';
      default:
        return 'bg-emerald-600 hover:bg-emerald-500 text-white';
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={handleSave}
        disabled={saveState === 'saving' || saveState === 'saved'}
        className={`
          inline-flex items-center justify-center
          px-4 py-2 rounded-lg text-sm font-semibold
          transition-colors duration-150
          disabled:cursor-not-allowed
          ${colorClass()}
        `}
        aria-label="글을 저장함에 보관"
      >
        {buttonContent()}
      </button>
      {saveState === 'error' && errorMessage && (
        <p className="text-xs text-red-400">{errorMessage}</p>
      )}
    </div>
  );
}
