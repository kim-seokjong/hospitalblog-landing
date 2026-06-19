'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';

function FailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const message = searchParams.get('message');

  return (
    <main className="min-h-screen bg-[#eef2f6] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-[#202020] mb-2">결제에 실패했습니다</h1>
        <p className="text-[#4a4f55] mb-4">
          {message ?? '결제 처리 중 오류가 발생했습니다.'}
        </p>
        <p className="text-[#5b6573] text-sm mb-8">
          문제가 지속되면 고객센터(010-2558-1115)로 문의해주세요.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => router.back()}
            className="px-6 py-3 bg-[#eef2f6] border border-[#b4bfce] hover:bg-[#b4bfce] text-[#202020] rounded-lg font-semibold transition-colors"
          >
            뒤로 가기
          </button>
          <Link
            href="/pricing"
            className="px-6 py-3 bg-[#ff4628] hover:bg-[#e63a1c] text-white rounded-lg font-semibold transition-colors"
          >
            다시 시도하기
          </Link>
          <Link
            href="/"
            className="px-6 py-3 bg-[#eef2f6] border border-[#b4bfce] hover:bg-[#b4bfce] text-[#202020] rounded-lg font-semibold transition-colors"
          >
            홈으로
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function PaymentFailPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#eef2f6]" />}>
      <FailContent />
    </Suspense>
  );
}
