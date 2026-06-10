'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[/app] client error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#0b0d2b] text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="text-5xl">⚠️</div>
        <div>
          <h2 className="text-xl font-bold text-white mb-2">일시적인 오류가 발생했습니다</h2>
          <p className="text-sm text-[#8891bd]">
            작업 중 예기치 않은 오류가 발생했습니다.<br />
            다시 시도하거나 새로고침해 주세요.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-3 bg-[#4f6ef7] hover:bg-[#3d5ef0] text-white font-bold rounded-xl transition-colors"
          >
            다시 시도
          </button>
          <Link
            href="/app"
            className="px-6 py-3 bg-[#191970] hover:bg-[#22227a] text-white font-semibold rounded-xl transition-colors border border-[#2a2b6e]"
          >
            새로고침
          </Link>
        </div>
        <p className="text-xs text-[#555d8a]">
          문제가 계속되면{' '}
          <a
            href="https://pf.kakao.com/_xefMRX"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#4f6ef7] underline"
          >
            카카오톡 채널
          </a>
          로 문의해 주세요.
        </p>
      </div>
    </div>
  );
}
