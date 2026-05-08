import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getProfile, getActiveBillingKey, getUserPayments } from '@/lib/payment/repository'
import { PLANS, isPaidPlanId } from '@/lib/payment/plans'
import CancelButton from './CancelButton'

export const dynamic = 'force-dynamic'

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatAmount(amount: number): string {
  return amount.toLocaleString('ko-KR') + '원'
}

const STATUS_LABEL: Record<string, string> = {
  PAID: '완료',
  PENDING: '대기',
  FAILED: '실패',
  CANCELLED: '취소',
  VIRTUAL_ACCOUNT_ISSUED: '가상계좌',
}

export default async function SubscriptionPage() {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const [profile, billingKey, payments] = await Promise.all([
    getProfile(user.id),
    getActiveBillingKey(user.id),
    getUserPayments(user.id),
  ])

  const planInfo = isPaidPlanId(profile?.plan) ? PLANS[profile!.plan] : null
  const isActiveSubscription = billingKey?.status === 'ACTIVE'

  return (
    <main className="min-h-screen bg-gray-950 text-gray-200">
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/app" className="text-base font-bold text-white flex items-center gap-2">
            <span>🏥</span> 닥터포스트
          </Link>
          <Link href="/app" className="text-xs text-gray-400 hover:text-gray-200 transition-colors">
            ← 앱으로
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">

        <div>
          <h1 className="text-2xl font-bold text-white mb-1">구독 관리</h1>
          <p className="text-sm text-gray-500">현재 구독 상태와 결제 내역을 확인할 수 있습니다.</p>
        </div>

        <section className={`rounded-2xl border p-6 ${
          isActiveSubscription
            ? 'border-blue-700 bg-blue-950/30'
            : 'border-gray-800 bg-gray-900'}`
        }>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-white">현재 구독</h2>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              isActiveSubscription
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                : 'bg-gray-700 text-gray-400'}`
            }>
              {isActiveSubscription ? '자동갱신 중' : '비활성'}
            </span>
          </div>

          {planInfo ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <Field label="플랜" value={planInfo.name} />
                <Field label="월 요금" value={formatAmount(planInfo.price)} />
                <Field
                  label="이번 달 사용량"
                  value={
                    planInfo.usageLimit === -1
                      ? `${profile?.usage_count ?? 0}건 (무제한)`
                      : `${profile?.usage_count ?? 0} / ${planInfo.usageLimit}건`
                  }
                />
                <Field label="구독 만료일" value={formatDate(profile?.plan_expires_at ?? null)} />
                {billingKey && (
                  <>
                    <Field label="다음 결제일" value={formatDate(billingKey.next_billing_at)} />
                    <Field
                      label="등록 카드"
                      value={billingKey.card_name ?? '카드'}
                    />
                  </>
                )}
              </div>

              {isActiveSubscription && (
                <div className="pt-4 border-t border-gray-800">
                  <p className="text-xs text-gray-400 mb-3">
                    해지 시 다음 결제일부터 자동 청구가 중단되며,
                    이미 결제한 기간({formatDate(billingKey?.next_billing_at ?? null)} 까지)은 정상 이용할 수 있습니다.
                  </p>
                  <CancelButton />
                </div>
              )}

              {!isActiveSubscription && (
                <div className="pt-4 border-t border-gray-800">
                  <Link
                    href="/#pricing"
                    className="block w-full py-3 rounded-lg text-sm font-semibold text-center bg-blue-500 hover:bg-blue-600 text-white transition-colors"
                  >
                    재구독 하기
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-gray-400 mb-4">활성 구독이 없습니다.</p>
              <Link
                href="/#pricing"
                className="inline-block px-6 py-2.5 rounded-lg text-sm font-semibold bg-blue-500 hover:bg-blue-600 text-white transition-colors"
              >
                구독 시작하기
              </Link>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-4">결제 내역</h2>
          {payments.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8 bg-gray-900 rounded-xl border border-gray-800">
              결제 내역이 없습니다.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="w-full text-sm">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">결제일</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">플랜</th>
                    <th className="text-right px-4 py-3 text-gray-400 font-medium">금액</th>
                    <th className="text-center px-4 py-3 text-gray-400 font-medium">상태</th>
                    <th className="text-center px-4 py-3 text-gray-400 font-medium">영수증</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-gray-800 bg-gray-950/40">
                      <td className="px-4 py-3 text-gray-300">
                        {formatDate(p.paid_at ?? p.created_at)}
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        {isPaidPlanId(p.plan) ? PLANS[p.plan].name : p.plan}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {formatAmount(p.amount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          p.status === 'PAID'
                            ? 'bg-green-500/20 text-green-300'
                            : p.status === 'FAILED'
                              ? 'bg-red-500/20 text-red-300'
                              : 'bg-gray-700 text-gray-400'
                        }`}>
                          {STATUS_LABEL[p.status] ?? p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.receipt_url ? (
                          <a
                            href={p.receipt_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:text-blue-300 underline"
                          >
                            보기
                          </a>
                        ) : (
                          <span className="text-xs text-gray-600">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="text-xs text-gray-500 space-y-1.5 pt-4 border-t border-gray-800">
          <p>· 다음 결제 7일 전 등록된 이메일로 사전 안내가 발송됩니다.</p>
          <p>· 카드 한도 초과 등으로 결제가 실패하면 3일 후 1회 재시도 후 자동 해지됩니다.</p>
          <p>· 환불 정책은{' '}
            <Link href="/refund" className="text-blue-400 hover:text-blue-300 underline">환불·해지정책</Link>
            을 확인하세요.
          </p>
        </section>
      </div>
    </main>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-medium text-white">{value}</p>
    </div>
  )
}
