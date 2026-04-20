import Link from 'next/link'

interface Props {
  searchParams: { message?: string }
}

export default function PaymentFailPage({ searchParams }: Props) {
  return (
    <main className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">결제에 실패했습니다</h1>
        <p className="text-gray-400 mb-4">
          {searchParams.message ?? '결제 처리 중 오류가 발생했습니다.'}
        </p>
        <p className="text-gray-500 text-sm mb-8">
          문제가 지속되면 고객센터(010-2558-1115)로 문의해주세요.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/pricing"
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold transition-colors"
          >
            다시 시도하기
          </Link>
          <Link
            href="/"
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition-colors"
          >
            홈으로
          </Link>
        </div>
      </div>
    </main>
  )
}
