'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/dev/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import type { Payment, PaymentStatus } from '@/payment/lib/types';
import type { PlanId } from '@/payment/lib/plans';
import { PLANS } from '@/payment/lib/plans';

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
  return `₩${amount.toLocaleString()}`;
}

function getPlanName(planId: PlanId): string {
  return PLANS[planId]?.name ?? planId;
}

function printReceipt(payment: Payment) {
  const planName = getPlanName(payment.plan as PlanId);
  const paidAt = formatDate(payment.paid_at ?? payment.created_at);
  const amount = payment.amount;
  const vat = Math.round(amount / 11);
  const supply = amount - vat;

  const receiptHtml = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8" />
      <title>닥터포스트 영수증</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; padding: 40px; color: #1e293b; max-width: 480px; margin: 0 auto; }
        .logo { font-size: 22px; font-weight: 700; color: #2563eb; margin-bottom: 4px; }
        .subtitle { font-size: 13px; color: #64748b; margin-bottom: 24px; }
        .divider { border: none; border-top: 1px solid #e2e8f0; margin: 16px 0; }
        .divider-bold { border: none; border-top: 2px solid #1e293b; margin: 16px 0; }
        .row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 14px; }
        .row .label { color: #64748b; }
        .row .value { font-weight: 500; }
        .total-row { display: flex; justify-content: space-between; align-items: center; font-size: 17px; font-weight: 700; }
        .total-row .amount { color: #2563eb; }
        .bizno { font-size: 12px; color: #94a3b8; margin-bottom: 20px; }
        .footer { font-size: 11px; color: #94a3b8; text-align: center; margin-top: 32px; }
        @media print { body { padding: 20px; } }
      </style>
    </head>
    <body>
      <div class="logo">닥터포스트</div>
      <div class="subtitle">의료광고법 준수 병원 블로그 자동화</div>
      <div class="bizno">사업자번호: 추후 입력 예정</div>
      <hr class="divider-bold" />
      <div class="row"><span class="label">결제일</span><span class="value">${paidAt}</span></div>
      <div class="row"><span class="label">플랜</span><span class="value">${planName}</span></div>
      <div class="row"><span class="label">결제 수단</span><span class="value">${payment.payment_method ?? '-'}</span></div>
      ${payment.card_name ? `<div class="row"><span class="label">카드사</span><span class="value">${payment.card_name}</span></div>` : ''}
      <div class="row"><span class="label">결제 ID</span><span class="value" style="font-size:11px;color:#94a3b8">${payment.id}</span></div>
      <hr class="divider" />
      <div class="row"><span class="label">공급가액</span><span class="value">₩${supply.toLocaleString()}</span></div>
      <div class="row"><span class="label">부가세 (10%)</span><span class="value">₩${vat.toLocaleString()}</span></div>
      <hr class="divider-bold" />
      <div class="total-row"><span>합계</span><span class="amount">₩${amount.toLocaleString()}</span></div>
      <div class="footer">본 영수증은 닥터포스트 서비스 이용에 대한 전자 영수증입니다.</div>
    </body>
    </html>
  `;

  const win = window.open('', '_blank', 'width=520,height=700');
  if (!win) return;
  win.document.write(receiptHtml);
  win.document.close();
  win.focus();
  win.print();
}

export default function PaymentHistoryPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: d }) => {
      setUser(d.user);
      setAuthChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/payment/history');
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? '서버 오류');
      }
      const json = await res.json() as { payments: Payment[] };
      setPayments(json.payments ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void fetchPayments();
  }, [user, fetchPayments]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-sm">로딩 중...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-white font-semibold text-base mb-2">로그인이 필요합니다</div>
          <div className="text-gray-400 text-sm mb-6">결제 내역은 로그인 후 이용할 수 있습니다.</div>
          <a href="/" className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">
            앱으로 이동해서 로그인
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-white">결제 내역</h1>
            <p className="text-gray-400 text-sm mt-0.5">{user.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void fetchPayments()}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-700 transition-colors"
            >
              새로고침
            </button>
            <a href="/usage" className="text-sm text-gray-400 hover:text-gray-200 transition-colors">
              ← 사용량
            </a>
            <a href="/" className="text-sm text-gray-400 hover:text-gray-200 transition-colors">
              앱으로 →
            </a>
          </div>
        </div>

        {/* 내비게이션 탭 */}
        <div className="flex gap-1 mb-6 bg-gray-900 border border-gray-800 rounded-xl p-1">
          <a
            href="/usage"
            className="flex-1 text-center py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            사용량
          </a>
          <span className="flex-1 text-center py-2 rounded-lg text-sm bg-blue-600 text-white font-medium">
            결제 내역
          </span>
          <a
            href="/settings/profile"
            className="flex-1 text-center py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            프로필 설정
          </a>
        </div>

        {/* 로딩 */}
        {loading && (
          <div className="text-center text-gray-400 py-16 text-sm">불러오는 중...</div>
        )}

        {/* 에러 */}
        {error && (
          <div className="bg-red-900/40 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">
            오류: {error}
          </div>
        )}

        {/* 결제 목록 */}
        {!loading && !error && (
          <>
            {payments.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center">
                <div className="text-gray-500 text-4xl mb-4">🧾</div>
                <div className="text-gray-300 font-medium mb-1">결제 내역이 없습니다</div>
                <div className="text-gray-500 text-sm">플랜을 구독하면 결제 내역이 여기에 표시됩니다.</div>
                <a
                  href="/pricing"
                  className="inline-block mt-4 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  플랜 보기
                </a>
              </div>
            ) : (
              <div className="space-y-3">
                {payments.map(payment => (
                  <PaymentCard key={payment.id} payment={payment} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PaymentCard({ payment }: { payment: Payment }) {
  const planName = getPlanName(payment.plan as PlanId);
  const status = payment.status;
  const statusLabel = STATUS_LABELS[status] ?? status;
  const statusColor = STATUS_COLORS[status] ?? STATUS_COLORS.PENDING;
  const paidAt = formatDate(payment.paid_at ?? payment.created_at);
  const createdAt = formatDate(payment.created_at);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* 플랜 + 상태 */}
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-white font-semibold">{planName} 플랜</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor}`}>
              {statusLabel}
            </span>
          </div>

          {/* 상세 정보 */}
          <div className="space-y-1 text-sm">
            <InfoRow label="결제일" value={status === 'PAID' ? paidAt : createdAt} />
            <InfoRow label="금액" value={formatAmount(payment.amount)} bold />
            {payment.payment_method && (
              <InfoRow label="결제 수단" value={payment.payment_method} />
            )}
            {payment.card_name && (
              <InfoRow label="카드사" value={payment.card_name} />
            )}
            {payment.failure_reason && (
              <InfoRow label="실패 사유" value={payment.failure_reason} error />
            )}
          </div>
        </div>

        {/* 영수증 버튼 */}
        {status === 'PAID' && (
          <button
            type="button"
            onClick={() => printReceipt(payment)}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg text-xs font-medium hover:bg-gray-700 hover:text-white transition-colors"
          >
            <span>🖨</span>
            <span className="hidden sm:inline">영수증</span>
          </button>
        )}
      </div>

      {/* 영수증 URL */}
      {payment.receipt_url && (
        <div className="mt-3 pt-3 border-t border-gray-800">
          <a
            href={payment.receipt_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            PG사 영수증 보기 →
          </a>
        </div>
      )}
    </div>
  );
}

function InfoRow({
  label,
  value,
  bold,
  error,
}: {
  label: string;
  value: string;
  bold?: boolean;
  error?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-500 w-20 flex-shrink-0">{label}</span>
      <span className={`${bold ? 'text-white font-semibold' : error ? 'text-red-400' : 'text-gray-300'}`}>
        {value}
      </span>
    </div>
  );
}
