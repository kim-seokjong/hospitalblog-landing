import Link from 'next/link'

interface Props {
  searchParams: { paymentId?: string }
}

export default function PaymentSuccessPage({ searchParams }: Props) {
  return (
    <main className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">결제가 완료되었습니다!</h1>
        <p className="text-gray-400 mb-8">
          구독이 활성화되었습니다. 지금 바로 AI 블로그 자동화를 시작하세요.
        </p>

        {searchParams.paymentId && (
          <p className="text-xs text-gray-600 mb-6">
            결제 ID: {searchParams.paymentId}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/app"
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold transition-colors"
          >
            서비스 이용하기
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
