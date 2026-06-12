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
  PAID: 'text-green-400 bg-green-900/40 border-green-800',
  PENDING: 'text-yellow-400 bg-yellow-900/40 border-yellow-800',
  FAILED: 'text-red-400 bg-red-900/40 border-red-800',
  CANCELLED: 'text-gray-400 bg-gray-800 border-gray-700',
  VIRTUAL_ACCOUNT_ISSUED: 'text-blue-400 bg-blue-900/40 border-blue-800',
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
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-medium text-white">{value}</p>
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
    return <div className="py-16 text-center text-gray-400 text-sm">구독 정보를 불러오는 중...</div>;
  }

  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="text-red-400 text-sm mb-4">{error}</p>
        <button
          type="button"
          onClick={() => void fetchAll()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
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
      <section className={`rounded-xl border p-4 sm:p-6 ${
        sub?.autoRenew ? 'border-blue-700 bg-blue-950/30' : 'border-gray-800 bg-gray-900'
      }`}>
        <div className="flex items-center justify-between mb-5 gap-2">
          <h2 className="text-base sm:text-lg font-semibold text-white">현재 구독</h2>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${
            sub?.isTrial
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : sub?.autoRenew
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                : sub?.isActive
                  ? 'bg-gray-700 text-gray-300'
                  : 'bg-gray-700 text-gray-400'
          }`}>
            {sub?.isTrial ? '🎁 무료 체험 중' : sub?.autoRenew ? '자동갱신 중' : sub?.isActive ? '이용 중 (자동갱신 해지됨)' : '비활성'}
          </span>
        </div>

        {sub?.isTrial && sub.trialUntil && (
          <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
            <p className="text-sm text-emerald-200 font-semibold">🎁 첫 달 무료 체험 진행 중</p>
            <p className="text-xs text-emerald-100/80 mt-1">
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

            <div className="pt-4 border-t border-gray-800 flex flex-col sm:flex-row gap-2">
              <a
                href="/pricing"
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-center bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                플랜 변경하기
              </a>
              <a
                href="/app/subscription"
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-center border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
              >
                구독 상세 관리 (해지 포함)
              </a>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-gray-400 mb-4 text-sm">활성 구독이 없습니다.</p>
            <a
              href="/pricing"
              className="inline-block px-6 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              구독 시작하기
            </a>
          </div>
        )}
      </section>

      {/* 결제 내역 */}
      <section>
        <h2 className="text-base sm:text-lg font-semibold text-white mb-4">결제 내역</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8 bg-gray-900 rounded-xl border border-gray-800">
            결제 내역이 없습니다.
          </p>
        ) : (
          <div className="space-y-3">
            {payments.map((p) => {
              const statusLabel = STATUS_LABELS[p.status] ?? p.status;
              const statusColor = STATUS_COLORS[p.status] ?? STATUS_COLORS.PENDING;
              return (
                <div key={p.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-semibold text-sm">{getPlanName(p.plan)} 플랜</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <span className="text-white font-semibold text-sm">{formatAmount(p.amount)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>결제일 {formatDate(p.paid_at ?? p.created_at)}</span>
                    {p.card_name && <span>{p.card_name}</span>}
                    {p.failure_reason && <span className="text-red-400">{p.failure_reason}</span>}
                    {p.receipt_url && (
                      <a
                        href={p.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 underline"
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
