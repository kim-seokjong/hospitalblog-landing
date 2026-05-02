'use client';

import { useState } from 'react';

type MessageType = 'sms' | 'alimtalk';

interface SmsCopyPanelProps {
  title: string;
  content: string;
  keyword: string;
}

interface SmsResponse {
  copy?: string;
  byteCount?: number;
  error?: string;
}

const MESSAGE_TABS: { value: MessageType; label: string; icon: string; maxBytes: number }[] = [
  { value: 'sms', label: '문자(SMS)', icon: '📲', maxBytes: 90 },
  { value: 'alimtalk', label: '알림톡', icon: '🔔', maxBytes: 400 },
];

function ByteIndicator({ byteCount, maxBytes }: { byteCount: number; maxBytes: number }) {
  const ratio = byteCount / maxBytes;
  const isOver = byteCount > maxBytes;
  const isWarning = ratio > 0.8 && !isOver;

  return (
    <div className="flex items-center justify-between mt-1.5">
      <div className="flex-1 h-1 bg-[#2a2b6e] rounded-full overflow-hidden mr-2">
        <div
          className={`h-full rounded-full transition-all ${
            isOver ? 'bg-red-500' : isWarning ? 'bg-amber-400' : 'bg-[#4f6ef7]'
          }`}
          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
        />
      </div>
      <span
        className={`text-[10px] font-mono flex-shrink-0 ${
          isOver ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-[#8891bd]'
        }`}
      >
        {byteCount} / {maxBytes} bytes
        {isOver && ' ⚠️'}
      </span>
    </div>
  );
}

export default function SmsCopyPanel({ title, content, keyword }: SmsCopyPanelProps) {
  const [activeType, setActiveType] = useState<MessageType>('sms');
  const [copies, setCopies] = useState<Partial<Record<MessageType, string>>>({});
  const [byteCounts, setByteCounts] = useState<Partial<Record<MessageType, number>>>({});
  const [loading, setLoading] = useState<Partial<Record<MessageType, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<MessageType, string>>>({});
  const [copied, setCopied] = useState<Partial<Record<MessageType, boolean>>>({});

  const handleGenerate = async () => {
    setLoading((prev) => ({ ...prev, [activeType]: true }));
    setErrors((prev) => ({ ...prev, [activeType]: undefined }));
    setCopies((prev) => ({ ...prev, [activeType]: undefined }));
    setByteCounts((prev) => ({ ...prev, [activeType]: undefined }));

    try {
      const res = await fetch('/api/generate-sms-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, keyword, type: activeType }),
      });

      const data = await res.json() as SmsResponse;

      if (!res.ok) {
        throw new Error(data.error ?? '문구 생성에 실패했습니다.');
      }

      setCopies((prev) => ({ ...prev, [activeType]: data.copy ?? '' }));
      setByteCounts((prev) => ({ ...prev, [activeType]: data.byteCount ?? 0 }));
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [activeType]: err instanceof Error ? err.message : '오류가 발생했습니다.',
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [activeType]: false }));
    }
  };

  const handleCopy = async () => {
    const text = copies[activeType];
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopied((prev) => ({ ...prev, [activeType]: true }));
      setTimeout(() => {
        setCopied((prev) => ({ ...prev, [activeType]: false }));
      }, 2000);
    } catch {
      setErrors((prev) => ({ ...prev, [activeType]: '클립보드 복사에 실패했습니다.' }));
    }
  };

  const isLoading = loading[activeType] ?? false;
  const currentCopy = copies[activeType];
  const currentByteCount = byteCounts[activeType];
  const currentError = errors[activeType];
  const isCopied = copied[activeType] ?? false;
  const activeTab = MESSAGE_TABS.find((t) => t.value === activeType)!;

  return (
    <div className="rounded-2xl border border-[#2a2b6e] bg-[#12153d] p-4 sm:p-5">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-xl bg-[#191970] border border-[#4f6ef7]/30 flex items-center justify-center flex-shrink-0">
          <span className="text-base">✉️</span>
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">문자 / 알림톡 문구 생성</h3>
          <p className="text-[10px] text-[#8891bd]">환자 안내 문자 및 알림톡 문구 자동 생성</p>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1.5 mb-4 bg-[#0b0d2b] p-1 rounded-xl border border-[#2a2b6e]">
        {MESSAGE_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveType(tab.value)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
              activeType === tab.value
                ? 'bg-[#4f6ef7] text-white shadow-sm'
                : 'text-[#8891bd] hover:text-white hover:bg-[#191970]/50'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 유형 힌트 */}
      <div className="mb-3 px-3 py-2 bg-[#0b0d2b] rounded-xl border border-[#2a2b6e]">
        {activeType === 'sms' ? (
          <p className="text-[10px] text-[#8891bd]">
            90바이트 이내 (한글 약 45자) · 병원명/링크 자리표시자 포함
          </p>
        ) : (
          <p className="text-[10px] text-[#8891bd]">
            200자 이내 · 공식적 말투 · 전화번호 자리표시자 포함
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
            문구 생성 중...
          </>
        ) : (
          <>
            <span>✨</span>
            {activeTab.label} 문구 생성
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
              rows={activeType === 'sms' ? 3 : 5}
              className="w-full px-4 py-3 rounded-xl bg-[#0b0d2b] border border-[#2a2b6e] text-white text-xs leading-relaxed resize-none focus:outline-none focus:border-[#4f6ef7]/50"
            />
          </div>

          {/* 바이트 수 표시 */}
          {currentByteCount !== undefined && (
            <ByteIndicator byteCount={currentByteCount} maxBytes={activeTab.maxBytes} />
          )}

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
          &quot;문구 생성&quot; 버튼을 눌러 메시지를 만들어보세요
        </p>
      )}

      {/* 의료법 고지 */}
      <div className="mt-3 px-2.5 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl">
        <p className="text-[9px] text-amber-300/70 leading-relaxed">
          의료법 제56조 준수 자동 적용 · [병원명], [링크], [전화번호]는 실제 정보로 교체 필요
        </p>
      </div>
    </div>
  );
}
