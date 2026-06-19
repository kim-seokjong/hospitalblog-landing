'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Payment, PaymentStatus } from '@/payment/lib/types';
import type { PlanId } from '@/payment/lib/plans';
import { PLANS, isPaidPlanId } from '@/payment/lib/plans';
import type { SubscriptionInfo } from '@/hr/lib/mypage-types';

const STATUS_LABELS: Record<PaymentStatus, string> = {
  PAID: '결제 완료',
  PENDING: '처리 중',
  FAILED: '결제 실패',
  CANCELLED: '취소됨',
  VIRTUAL_ACCOUNT_ISSUED: '가상계좌 발급',
};

const STATUS_COLORS: Record<PaymentStatus, string> = {
  PAID: 'text-green-700 bg-green-50 border-green-200',
  PENDING: 'text-yellow-700 bg-yellow-50 border-yellow-200',
  FAILED: 'text-red-600 bg-red-50 border-red-200',
  CANCELLED: 'text-[#5b6573] bg-[#eef2f6] border-[#b4bfce]',
  VIRTUAL_ACCOUNT_ISSUED: 'text-blue-600 bg-blue-50 border-blue-200',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function formatAmount(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

function getPlanName(plan: string): string {
  return isPaidPlanId(plan) ? PLANS[plan as PlanId].name : plan;
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[#5b6573] mb-1">{label}</p>
      <p className="text-sm font-medium text-[#202020]">{value}</p>
    </div>
  );
}

/**
 * 마이페이지 — 구독·결제 탭.
 * 구독 요약은 /api/mypage/subscription, 결제 내역은 기존 /api/payment/history 사용.
 * 플랜 변경은 /pricing 페이지로 링크 (신규 결제 로직 없음).
 */
export default function SubscriptionTab() {
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [subRes, payRes] = await Promise.all([
        fetch('/api/mypage/subscription'),
        fetch('/api/payment/history'),
      ]);

      if (!subRes.ok) {
        const json = await subRes.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '구독 정보를 불러오지 못했습니다.');
      }
      if (!payRes.ok) {
        const json = await payRes.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '결제 내역을 불러오지 못했습니다.');
      }

      const subJson = await subRes.json() as { subscription: SubscriptionInfo };
      const payJson = await payRes.json() as { payments: Payment[] };
      setSubscription(subJson.subscription);
      setPayments(payJson.payments ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  if (loading) {
    return <div className="py-16 text-center text-[#5b6573] text-sm">구독 정보를 불러오는 중...</div>;
  }

  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="text-red-600 text-sm mb-4">{error}</p>
        <button
          type="button"
          onClick={() => void fetchAll()}
          className="px-4 py-2 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-lg transition-colors"
        >
          다시 시도
        </button>
      </div>
    );
  }

  const sub = subscription;
  const cardLabel = sub?.cardName
    ? `${sub.cardName}${sub.cardLast4 ? ` (끝 4자리 ${sub.cardLast4})` : ''}`
    : sub?.cardLast4
      ? `카드 (끝 4자리 ${sub.cardLast4})`
      : null;

  return (
    <div className="space-y-6">
      {/* 현재 구독 카드 */}
      <section className={`rounded-xl border p-4 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)] ${
        sub?.autoRenew ? 'border-[#ff4628] bg-[#ffece7]' : 'border-[#b4bfce] bg-white'
      }`}>
        <div className="flex items-center justify-between mb-5 gap-2">
          <h2 className="text-base sm:text-lg font-semibold text-[#202020]">현재 구독</h2>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${
            sub?.isTrial
              ? 'bg-green-50 text-green-700 border border-green-200'
              : sub?.autoRenew
                ? 'bg-[#ffece7] text-[#ff4628] border border-[#ff4628]/40'
                : sub?.isActive
                  ? 'bg-[#eef2f6] text-[#4a4f55]'
                  : 'bg-[#eef2f6] text-[#5b6573]'
          }`}>
            {sub?.isTrial ? '🎁 무료 체험 중' : sub?.autoRenew ? '자동갱신 중' : sub?.isActive ? '이용 중 (자동갱신 해지됨)' : '비활성'}
          </span>
        </div>

        {sub?.isTrial && sub.trialUntil && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-sm text-green-700 font-semibold">🎁 첫 달 무료 체험 진행 중</p>
            <p className="text-xs text-green-600 mt-1">
              첫 정상 결제일: <strong>{formatDate(sub.trialUntil)}</strong>
              {sub.price != null && <> · 결제 예정 금액 {formatAmount(sub.price)}</>}
            </p>
          </div>
        )}

        {sub?.planName ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <InfoField label="플랜" value={sub.planName} />
              <InfoField label="월 요금" value={sub.price != null ? formatAmount(sub.price) : '-'} />
              <InfoField label="구독 만료일" value={formatDate(sub.planExpiresAt)} />
              {sub.autoRenew && (
                <InfoField label="다음 결제일" value={formatDate(sub.nextBillingAt)} />
              )}
              {cardLabel && <InfoField label="결제 수단" value={cardLabel} />}
            </div>

            <div className="pt-4 border-t border-[#b4bfce] flex flex-col sm:flex-row gap-2">
              <a
                href="/pricing"
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-center bg-[#ff4628] hover:bg-[#e63a1c] text-white transition-colors"
              >
                플랜 변경하기
              </a>
              <a
                href="/app/subscription"
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-center border border-[#b4bfce] text-[#4a4f55] hover:bg-[#eef2f6] transition-colors"
              >
                구독 상세 관리 (해지 포함)
              </a>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-[#5b6573] mb-4 text-sm">활성 구독이 없습니다.</p>
            <a
              href="/pricing"
              className="inline-block px-6 py-2.5 rounded-lg text-sm font-semibold bg-[#ff4628] hover:bg-[#e63a1c] text-white transition-colors"
            >
              구독 시작하기
            </a>
          </div>
        )}
      </section>

      {/* 결제 내역 */}
      <section>
        <h2 className="text-base sm:text-lg font-semibold text-[#202020] mb-4">결제 내역</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-[#5b6573] text-center py-8 bg-white rounded-xl border border-[#b4bfce] shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
            결제 내역이 없습니다.
          </p>
        ) : (
          <div className="space-y-3">
            {payments.map((p) => {
              const statusLabel = STATUS_LABELS[p.status] ?? p.status;
              const statusColor = STATUS_COLORS[p.status] ?? STATUS_COLORS.PENDING;
              return (
                <div key={p.id} className="bg-white border border-[#b4bfce] rounded-xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[#202020] font-semibold text-sm">{getPlanName(p.plan)} 플랜</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <span className="text-[#202020] font-semibold text-sm">{formatAmount(p.amount)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#5b6573]">
                    <span>결제일 {formatDate(p.paid_at ?? p.created_at)}</span>
                    {p.card_name && <span>{p.card_name}</span>}
                    {p.failure_reason && <span className="text-red-600">{p.failure_reason}</span>}
                    {p.receipt_url && (
                      <a
                        href={p.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#ff4628] hover:text-[#e63a1c] underline"
                      >
                        영수증 보기
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
