import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getProfile, getActiveBillingKey, getUserPayments } from '@/payment/lib/repository'
import { PLANS, isPaidPlanId } from '@/payment/lib/plans'
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
  const isInTrial =
    !!billingKey?.trial_until && new Date(billingKey.trial_until) > new Date()

  return (
    <main className="min-h-screen bg-[#eaeef4] text-[#202020]">
      <header className="border-b border-[#b4bfce] bg-white/85 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/app" className="text-base font-bold text-[#202020] flex items-center gap-2">
            <span>🏥</span> 닥터포스트
          </Link>
          <Link href="/app" className="text-xs text-[#5b6573] hover:text-[#202020] transition-colors">
            ← 앱으로
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">

        <div>
          <h1 className="text-2xl font-bold text-[#202020] mb-1">구독 관리</h1>
          <p className="text-sm text-[#5b6573]">현재 구독 상태와 결제 내역을 확인할 수 있습니다.</p>
        </div>

        <section className={`rounded-2xl border p-6 ${
          isActiveSubscription
            ? 'border-[#ff4628]/30 bg-[#ffece7]'
            : 'border-[#b4bfce] bg-white shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]'}`
        }>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-[#202020]">현재 구독</h2>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              isInTrial
                ? 'bg-emerald-500/20 text-emerald-600 border border-emerald-500/40'
                : isActiveSubscription
                  ? 'bg-[#ffece7] text-[#ff4628] border border-[#ff4628]/40'
                  : 'bg-[#eef2f6] text-[#5b6573]'}`
            }>
              {isInTrial ? '🎁 무료 체험 중' : isActiveSubscription ? '자동갱신 중' : '비활성'}
            </span>
          </div>

          {isInTrial && billingKey?.trial_until && (
            <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-50 px-4 py-3">
              <p className="text-sm text-emerald-700 font-semibold">
                🎁 첫 달 무료 체험 진행 중
              </p>
              <p className="text-xs text-emerald-700/80 mt-1">
                첫 정상 결제일: <strong>{formatDate(billingKey.trial_until)}</strong>
                {planInfo && <> · 결제 예정 금액 {formatAmount(planInfo.price)}</>}
              </p>
              <p className="text-[11px] text-emerald-700/60 mt-1">
                무료 기간 중 해지 시 청구 없이 즉시 종료됩니다.
              </p>
            </div>
          )}

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
                <div className="pt-4 border-t border-[#b4bfce]">
                  <p className="text-xs text-[#5b6573] mb-3">
                    {isInTrial
                      ? '무료 체험 중 해지 시 청구 없이 즉시 종료됩니다.'
                      : `해지 시 다음 결제일부터 자동 청구가 중단되며, 이미 결제한 기간(${formatDate(billingKey?.next_billing_at ?? null)} 까지)은 정상 이용할 수 있습니다.`}
                  </p>
                  <CancelButton />
                </div>
              )}

              {!isActiveSubscription && (
                <div className="pt-4 border-t border-[#b4bfce]">
                  <Link
                    href="/#pricing"
                    className="block w-full py-3 rounded-lg text-sm font-semibold text-center bg-[#ff4628] hover:bg-[#e63a1c] text-white transition-colors"
                  >
                    재구독 하기
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-[#5b6573] mb-4">활성 구독이 없습니다.</p>
              <Link
                href="/#pricing"
                className="inline-block px-6 py-2.5 rounded-lg text-sm font-semibold bg-[#ff4628] hover:bg-[#e63a1c] text-white transition-colors"
              >
                구독 시작하기
              </Link>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold text-[#202020] mb-4">결제 내역</h2>
          {payments.length === 0 ? (
            <p className="text-sm text-[#5b6573] text-center py-8 bg-white rounded-xl border border-[#b4bfce] shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
              결제 내역이 없습니다.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#b4bfce]">
              <table className="w-full text-sm">
                <thead className="bg-[#eef2f6]">
                  <tr>
                    <th className="text-left px-4 py-3 text-[#5b6573] font-medium">결제일</th>
                    <th className="text-left px-4 py-3 text-[#5b6573] font-medium">플랜</th>
                    <th className="text-right px-4 py-3 text-[#5b6573] font-medium">금액</th>
                    <th className="text-center px-4 py-3 text-[#5b6573] font-medium">상태</th>
                    <th className="text-center px-4 py-3 text-[#5b6573] font-medium">영수증</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-[#b4bfce] bg-white">
                      <td className="px-4 py-3 text-[#4a4f55]">
                        {formatDate(p.paid_at ?? p.created_at)}
                      </td>
                      <td className="px-4 py-3 text-[#4a4f55]">
                        {isPaidPlanId(p.plan) ? PLANS[p.plan].name : p.plan}
                      </td>
                      <td className="px-4 py-3 text-right text-[#4a4f55]">
                        {formatAmount(p.amount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          p.status === 'PAID'
                            ? 'bg-green-500/20 text-green-600'
                            : p.status === 'FAILED'
                              ? 'bg-red-500/20 text-red-600'
                              : 'bg-[#eef2f6] text-[#5b6573]'
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
                            className="text-xs text-[#ff4628] hover:text-[#e63a1c] underline"
                          >
                            보기
                          </a>
                        ) : (
                          <span className="text-xs text-[#73808f]">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="text-xs text-[#5b6573] space-y-1.5 pt-4 border-t border-[#b4bfce]">
          <p>· 다음 결제 7일 전 등록된 이메일로 사전 안내가 발송됩니다.</p>
          <p>· 카드 한도 초과 등으로 결제가 실패하면 3일 후 1회 재시도 후 자동 해지됩니다.</p>
          <p>· 환불 정책은{' '}
            <Link href="/refund" className="text-[#ff4628] hover:text-[#e63a1c] underline">환불·해지정책</Link>
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
      <p className="text-xs text-[#5b6573] mb-1">{label}</p>
      <p className="text-sm font-medium text-[#202020]">{value}</p>
    </div>
  )
}
