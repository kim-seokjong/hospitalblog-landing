'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Payment, PaymentStatus } from '@/payment/lib/types';
import type { PlanId } from '@/payment/lib/plans';
import { PLANS, isPaidPlanId, isUpgrade, isCarePlanId, PAID_PLAN_IDS } from '@/payment/lib/plans';
import type { SubscriptionInfo } from '@/hr/lib/mypage-types';

interface UpgradePreview {
  amount: number;
  isTrial: boolean;
  currentPlan: string;
  targetPlan: string;
  cardLast4: string | null;
  nextBillingAt: string | null;
}

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
 * 업그레이드 모달.
 * 현재 플랜에서 상향 가능한 대상 플랜을 고르면 GET 미리보기로 일할 차액을 확인하고,
 * 기존에 등록된 카드로 즉시 차액 결제(또는 무료체험 시 결제 없이 전환)한다.
 */
function UpgradeModal({
  currentPlan,
  targets,
  onClose,
  onUpgraded,
}: {
  currentPlan: PlanId;
  targets: PlanId[];
  onClose: () => void;
  onUpgraded: (planName: string) => void;
}) {
  const [selected, setSelected] = useState<PlanId | null>(targets.length === 1 ? targets[0] : null);
  const [preview, setPreview] = useState<UpgradePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 케어 플랜 전환 시 특약(약관 제8조의2) 동의 체크 — 서버(change-plan)가 필수 검증한다
  const [careAgreed, setCareAgreed] = useState(false);
  const needsCareConsent = selected != null && isCarePlanId(selected);

  const loadPreview = useCallback(async (target: PlanId) => {
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch(`/api/payment/change-plan?plan=${encodeURIComponent(target)}`);
      const json = (await res.json().catch(() => ({}))) as UpgradePreview & { error?: string };
      if (!res.ok) throw new Error(json.error ?? '미리보기를 불러오지 못했습니다.');
      setPreview(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '미리보기를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) void loadPreview(selected);
    setCareAgreed(false); // 대상 플랜이 바뀌면 특약 동의를 다시 받는다
  }, [selected, loadPreview]);

  const handleConfirm = useCallback(async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/payment/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isCarePlanId(selected) ? { plan: selected, careTermsAgreed: true } : { plan: selected },
        ),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; plan?: string };
      if (!res.ok) throw new Error(json.error ?? '업그레이드에 실패했습니다.');
      onUpgraded(PLANS[selected].name);
    } catch (e) {
      setError(e instanceof Error ? e.message : '업그레이드에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }, [selected, onUpgraded]);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 sm:p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base sm:text-lg font-semibold text-[#202020]">⬆ 플랜 업그레이드</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[#5b6573] hover:text-[#202020] text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <p className="text-xs text-[#5b6573] mb-4">
          업그레이드하면 새 기능을 지금 바로 사용할 수 있습니다. 등록된 카드로 결제되며, 카드를 다시
          입력할 필요가 없습니다.
        </p>

        {/* 대상 플랜 선택 */}
        <div className="space-y-2 mb-4">
          {targets.map((t) => {
            const p = PLANS[t];
            const active = selected === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setSelected(t)}
                className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                  active
                    ? 'border-[#ff4628] bg-[#ffece7]'
                    : 'border-[#b4bfce] bg-white hover:bg-[#f7f9fb]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#202020]">{p.name}</span>
                  <span className="text-sm font-semibold text-[#ff4628]">
                    {formatAmount(p.price)}/월
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* 미리보기 */}
        {selected && (
          <div className="rounded-xl border border-[#b4bfce] bg-[#f7f9fb] p-4 mb-4">
            {loading ? (
              <p className="text-sm text-[#5b6573] text-center py-2">차액을 계산하는 중...</p>
            ) : preview ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#5b6573]">전환 플랜</span>
                  <span className="font-medium text-[#202020]">{preview.targetPlan}</span>
                </div>
                {preview.isTrial ? (
                  <div className="flex justify-between">
                    <span className="text-[#5b6573]">지금 결제</span>
                    <span className="font-semibold text-green-700">
                      추가 결제 없음 — 무료체험 종료 후 정상가
                    </span>
                  </div>
                ) : (
                  <div className="flex justify-between">
                    <span className="text-[#5b6573]">지금 결제 (차액 일할)</span>
                    <span className="font-semibold text-[#ff4628]">
                      {formatAmount(preview.amount)}
                    </span>
                  </div>
                )}
                {preview.cardLast4 && (
                  <div className="flex justify-between">
                    <span className="text-[#5b6573]">결제 카드</span>
                    <span className="font-medium text-[#202020]">끝 4자리 {preview.cardLast4}</span>
                  </div>
                )}
                {!preview.isTrial && (
                  <p className="text-xs text-[#5b6573] pt-1">
                    남은 구독 기간에 대한 차액만 청구되며, 다음 결제일부터는 새 플랜 정상가가
                    적용됩니다.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* 케어 플랜 특약 동의 (필수) */}
        {needsCareConsent && (
          <label className="flex items-start gap-2.5 mb-4 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={careAgreed}
              onChange={(e) => setCareAgreed(e.target.checked)}
              className="mt-0.5 w-4 h-4 shrink-0 accent-[#ff4628] cursor-pointer"
            />
            <span className="text-xs leading-relaxed text-[#4a4f55]">
              케어 플랜의{' '}
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#ff4628] underline hover:text-[#e63a1c]"
              >
                계정 위임·발행 대행 특약(이용약관 제8조의2)
              </a>
              에 동의합니다. 계정 정보 전달 등 위임 절차는 전환 후 안내에 따라 진행됩니다.{' '}
              <span className="text-red-600">(필수)</span>
            </span>
          </label>
        )}

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={!selected || loading || submitting || !preview || (needsCareConsent && !careAgreed)}
          className="w-full py-2.5 rounded-lg text-sm font-semibold bg-[#ff4628] hover:bg-[#e63a1c] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? '처리 중...' : '기존 카드로 업그레이드'}
        </button>
      </div>
    </div>
  );
}

/**
 * 마이페이지 — 구독·결제 탭.
 * 구독 요약은 /api/mypage/subscription, 결제 내역은 기존 /api/payment/history 사용.
 * 업그레이드는 /api/payment/change-plan (기존 카드 재사용), 그 외 변경은 /pricing 링크.
 */
export default function SubscriptionTab() {
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeSuccess, setUpgradeSuccess] = useState<string | null>(null);

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

  // 현재 플랜에서 업그레이드 가능한 대상 (basic 은 대상에서 제외 — 레거시 숨김)
  const currentPlanId = sub?.plan && isPaidPlanId(sub.plan) ? (sub.plan as PlanId) : null;
  const upgradeTargets: PlanId[] = currentPlanId
    ? PAID_PLAN_IDS.filter((t) => t !== 'basic' && isUpgrade(currentPlanId, t))
    : [];
  // 업그레이드는 활성 구독(자동갱신 또는 무료체험) + 등록 카드가 있을 때만 노출
  const canUpgrade = upgradeTargets.length > 0 && !!sub?.autoRenew;

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

            {upgradeSuccess && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                <p className="text-sm text-green-700 font-semibold">
                  ✅ {upgradeSuccess} 플랜으로 업그레이드되었습니다.
                </p>
                <p className="text-xs text-green-600 mt-1">
                  새 기능을 지금 바로 사용할 수 있습니다.
                </p>
              </div>
            )}

            <div className="pt-4 border-t border-[#b4bfce] flex flex-col sm:flex-row gap-2">
              {canUpgrade && (
                <button
                  type="button"
                  onClick={() => {
                    setUpgradeSuccess(null);
                    setShowUpgrade(true);
                  }}
                  className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-center bg-[#ff4628] hover:bg-[#e63a1c] text-white transition-colors"
                >
                  ⬆ 업그레이드
                </button>
              )}
              <a
                href="/pricing"
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold text-center transition-colors ${
                  canUpgrade
                    ? 'border border-[#b4bfce] text-[#4a4f55] hover:bg-[#eef2f6]'
                    : 'bg-[#ff4628] hover:bg-[#e63a1c] text-white'
                }`}
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

      {showUpgrade && currentPlanId && upgradeTargets.length > 0 && (
        <UpgradeModal
          currentPlan={currentPlanId}
          targets={upgradeTargets}
          onClose={() => setShowUpgrade(false)}
          onUpgraded={(planName) => {
            setShowUpgrade(false);
            setUpgradeSuccess(planName);
            void fetchAll();
          }}
        />
      )}
    </div>
  );
}
