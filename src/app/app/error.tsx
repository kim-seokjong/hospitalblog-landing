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
    <div className="min-h-screen bg-white text-[#202020] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="text-5xl">⚠️</div>
        <div>
          <h2 className="text-xl font-bold text-[#202020] mb-2">일시적인 오류가 발생했습니다</h2>
          <p className="text-sm text-[#8a93a0]">
            작업 중 예기치 않은 오류가 발생했습니다.<br />
            다시 시도하거나 새로고침해 주세요.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-3 bg-[#ff4628] hover:bg-[#e63a1c] text-white font-bold rounded-xl transition-colors"
          >
            다시 시도
          </button>
          <Link
            href="/app"
            className="px-6 py-3 bg-white hover:bg-[#eef2f6] text-[#202020] font-semibold rounded-xl transition-colors border border-[#dbe2ea]"
          >
            새로고침
          </Link>
        </div>
        <p className="text-xs text-[#b8c8d7]">
          문제가 계속되면{' '}
          <a
            href="https://pf.kakao.com/_xefMRX"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#ff4628] underline"
          >
            카카오톡 채널
          </a>
          로 문의해 주세요.
        </p>
      </div>
    </div>
  );
}
