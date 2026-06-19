import Link from 'next/link'

interface Props {
  searchParams: { paymentId?: string }
}

export default function PaymentSuccessPage({ searchParams }: Props) {
  return (
    <main className="min-h-screen bg-[#eef2f6] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-[#202020] mb-2">자동갱신 구독이 시작되었습니다</h1>
        <p className="text-[#4a4f55] mb-2">
          첫 달 결제가 완료되었고, 구독이 활성화되었습니다.
        </p>
        <p className="text-[#ff4628] text-sm mb-6">
          매월 같은 날 자동 결제됩니다 · 다음 결제 7일 전 안내 메일을 보내드립니다
        </p>

        {searchParams.paymentId && (
          <p className="text-xs text-[#73808f] mb-6">
            결제 ID: {searchParams.paymentId}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/app"
            className="px-6 py-3 bg-[#ff4628] hover:bg-[#e63a1c] text-white rounded-lg font-semibold transition-colors"
          >
            서비스 이용하기
          </Link>
          <Link
            href="/app/subscription"
            className="px-6 py-3 bg-[#eef2f6] border border-[#b4bfce] hover:bg-[#b4bfce] text-[#202020] rounded-lg font-semibold transition-colors"
          >
            구독 관리
          </Link>
        </div>

        <p className="text-xs text-[#5b6573] mt-6">
          언제든 마이페이지에서 1클릭으로 해지할 수 있습니다.
        </p>
      </div>
    </main>
  )
}
