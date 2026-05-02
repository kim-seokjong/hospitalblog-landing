'use client';

import { useState } from 'react';

type Platform = 'instagram' | 'kakao';

interface SnsCopyPanelProps {
  title: string;
  content: string;
  keyword: string;
}

interface SnsResponse {
  copy?: string;
  error?: string;
}

const PLATFORM_TABS: { value: Platform; label: string; icon: string }[] = [
  { value: 'instagram', label: '인스타그램', icon: '📸' },
  { value: 'kakao', label: '카카오채널', icon: '💬' },
];

export default function SnsCopyPanel({ title, content, keyword }: SnsCopyPanelProps) {
  const [activePlatform, setActivePlatform] = useState<Platform>('instagram');
  const [copies, setCopies] = useState<Partial<Record<Platform, string>>>({});
  const [loading, setLoading] = useState<Partial<Record<Platform, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<Platform, string>>>({});
  const [copied, setCopied] = useState<Partial<Record<Platform, boolean>>>({});

  const handleGenerate = async () => {
    setLoading((prev) => ({ ...prev, [activePlatform]: true }));
    setErrors((prev) => ({ ...prev, [activePlatform]: undefined }));
    setCopies((prev) => ({ ...prev, [activePlatform]: undefined }));

    try {
      const res = await fetch('/api/generate-sns-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, keyword, platform: activePlatform }),
      });

      const data = await res.json() as SnsResponse;

      if (!res.ok) {
        throw new Error(data.error ?? 'SNS 카피 생성에 실패했습니다.');
      }

      setCopies((prev) => ({ ...prev, [activePlatform]: data.copy ?? '' }));
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [activePlatform]: err instanceof Error ? err.message : '오류가 발생했습니다.',
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [activePlatform]: false }));
    }
  };

  const handleCopy = async () => {
    const text = copies[activePlatform];
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopied((prev) => ({ ...prev, [activePlatform]: true }));
      setTimeout(() => {
        setCopied((prev) => ({ ...prev, [activePlatform]: false }));
      }, 2000);
    } catch {
      setErrors((prev) => ({ ...prev, [activePlatform]: '클립보드 복사에 실패했습니다.' }));
    }
  };

  const isLoading = loading[activePlatform] ?? false;
  const currentCopy = copies[activePlatform];
  const currentError = errors[activePlatform];
  const isCopied = copied[activePlatform] ?? false;

  return (
    <div className="rounded-2xl border border-[#2a2b6e] bg-[#12153d] p-4 sm:p-5">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-xl bg-[#191970] border border-[#4f6ef7]/30 flex items-center justify-center flex-shrink-0">
          <span className="text-base">📱</span>
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">SNS 카피 생성</h3>
          <p className="text-[10px] text-[#8891bd]">블로그 글을 SNS 게시물로 변환</p>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1.5 mb-4 bg-[#0b0d2b] p-1 rounded-xl border border-[#2a2b6e]">
        {PLATFORM_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActivePlatform(tab.value)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
              activePlatform === tab.value
                ? 'bg-[#4f6ef7] text-white shadow-sm'
                : 'text-[#8891bd] hover:text-white hover:bg-[#191970]/50'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 플랫폼 힌트 */}
      <div className="mb-3 px-3 py-2 bg-[#0b0d2b] rounded-xl border border-[#2a2b6e]">
        {activePlatform === 'instagram' ? (
          <p className="text-[10px] text-[#8891bd]">
            이모지 포함 · 해시태그 10개 · 공감 유도 문구 · 150자 이내 캡션
          </p>
        ) : (
          <p className="text-[10px] text-[#8891bd]">
            이모지 포함 · 친근한 말투 · 채널 친구추가 유도 · 200자 이내
          </p>
        )}
      </div>

      {/* 생성 버튼 */}
      <button
        onClick={handleGenerate}
        disabled={isLoading || !title || !content || !keyword}
        className="w-full py-3 bg-[#4f6ef7] hover:bg-[#3d5ef0] active:bg-[#2d4ee0] disabled:bg-[#2a2b6e] disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2 min-h-[46px] mb-3"
      >
        {isLoading ? (
          <>
            <svg className="animate-spin h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            카피 생성 중...
          </>
        ) : (
          <>
            <span>✨</span>
            {PLATFORM_TABS.find((t) => t.value === activePlatform)?.label} 카피 생성
          </>
        )}
      </button>

      {/* 에러 */}
      {currentError && (
        <div className="mb-3 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-xs text-red-400">{currentError}</p>
        </div>
      )}

      {/* 결과 */}
      {currentCopy && (
        <div className="space-y-2">
          <div className="relative">
            <textarea
              readOnly
              value={currentCopy}
              rows={activePlatform === 'instagram' ? 8 : 6}
              className="w-full px-4 py-3 rounded-xl bg-[#0b0d2b] border border-[#2a2b6e] text-white text-xs leading-relaxed resize-none focus:outline-none focus:border-[#4f6ef7]/50"
            />
          </div>
          <button
            onClick={handleCopy}
            className={`w-full py-2.5 rounded-xl text-xs font-semibold border transition-all min-h-[40px] ${
              isCopied
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-[#0b0d2b] border-[#2a2b6e] text-[#8891bd] hover:border-[#4f6ef7]/50 hover:text-white'
            }`}
          >
            {isCopied ? '✓ 복사됨' : '클립보드에 복사'}
          </button>
        </div>
      )}

      {!currentCopy && !isLoading && !currentError && (
        <p className="text-xs text-[#555d8a] text-center py-3">
          &quot;카피 생성&quot; 버튼을 눌러 SNS 게시물을 만들어보세요
        </p>
      )}
    </div>
  );
}
