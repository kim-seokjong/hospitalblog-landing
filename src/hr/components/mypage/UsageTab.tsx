'use client';

import { useEffect, useState, useCallback } from 'react';
import type { UsageSummary } from '@/hr/lib/mypage-types';

const UPGRADE_WARNING_RATIO = 0.9;

function monthLabel(key: string): string {
  const parts = key.split('-');
  return `${Number(parts[1])}월`;
}

/**
 * 마이페이지 — 사용량 탭 (고객 친화 버전).
 * 내부 원가 뷰(/usage, 토큰·달러)와 별개로 글/이미지 건수만 보여준다.
 */
export default function UsageTab() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/mypage/usage');
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '사용량을 불러오지 못했습니다.');
      }
      const json = await res.json() as { usage: UsageSummary };
      setUsage(json.usage);
    } catch (e) {
      setError(e instanceof Error ? e.message : '사용량을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsage();
  }, [fetchUsage]);

  if (loading) {
    return <div className="py-16 text-center text-[#8a93a0] text-sm">사용량을 불러오는 중...</div>;
  }

  if (error || !usage) {
    return (
      <div className="py-16 text-center">
        <p className="text-red-600 text-sm mb-4">{error ?? '사용량을 불러오지 못했습니다.'}</p>
        <button
          type="button"
          onClick={() => void fetchUsage()}
          className="px-4 py-2 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-lg transition-colors"
        >
          다시 시도
        </button>
      </div>
    );
  }

  const isUnlimited = usage.monthlyLimit === -1;
  const hasPlan = usage.monthlyLimit !== 0;
  const ratio = !isUnlimited && usage.monthlyLimit > 0
    ? Math.min(usage.usageCount / usage.monthlyLimit, 1)
    : 0;
  const nearLimit = !isUnlimited && usage.monthlyLimit > 0 && ratio >= UPGRADE_WARNING_RATIO;
  const maxTrend = Math.max(1, ...usage.monthly.map((m) => m.posts));

  return (
    <div className="space-y-4">
      {/* 한도 임박 배너 */}
      {nearLimit && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-700">이번 달 사용 한도에 거의 도달했습니다</p>
            <p className="text-xs text-amber-600 mt-0.5">
              {usage.usageCount} / {usage.monthlyLimit}건 사용 — 상위 플랜으로 업그레이드하면 더 많은 글을 생성할 수 있습니다.
            </p>
          </div>
          <a
            href="/pricing"
            className="flex-shrink-0 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg text-center transition-colors"
          >
            플랜 업그레이드
          </a>
        </div>
      )}

      {/* 이번 달 글 생성 게이지 */}
      <div className="bg-white border border-[#dbe2ea] rounded-xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-sm font-semibold text-[#202020]">이번 달 글 생성</h3>
          {usage.planName && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#ffece7] text-[#ff4628] border border-[#ff4628]/40 font-medium">
              {usage.planName} 플랜
            </span>
          )}
        </div>

        <div className="flex items-end gap-2 mb-3">
          <span className="text-3xl font-bold text-[#202020]">{usage.usageCount}</span>
          <span className="text-sm text-[#8a93a0] mb-1">
            {isUnlimited ? '건 (무제한)' : hasPlan ? `/ ${usage.monthlyLimit}건` : '건'}
          </span>
        </div>

        {!isUnlimited && hasPlan && (
          <div className="w-full h-2.5 bg-[#eef2f6] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                nearLimit ? 'bg-amber-500' : 'bg-[#ff4628]'
              }`}
              style={{ width: `${Math.round(ratio * 100)}%` }}
              role="progressbar"
              aria-valuenow={usage.usageCount}
              aria-valuemin={0}
              aria-valuemax={usage.monthlyLimit}
              aria-label="이번 달 글 생성 사용량"
            />
          </div>
        )}

        {!hasPlan && (
          <p className="text-xs text-[#8a93a0]">
            활성 플랜이 없습니다.{' '}
            <a href="/pricing" className="text-[#ff4628] hover:text-[#e63a1c] underline">요금제 보기</a>
          </p>
        )}
      </div>

      {/* 이번 달 이미지 생성 */}
      <div className="bg-white border border-[#dbe2ea] rounded-xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
        <h3 className="text-sm font-semibold text-[#202020] mb-3">이번 달 이미지 생성</h3>
        <div className="flex items-end gap-2">
          <span className="text-3xl font-bold text-[#202020]">{usage.imageCount}</span>
          <span className="text-sm text-[#8a93a0] mb-1">장</span>
        </div>
      </div>

      {/* 최근 6개월 추이 */}
      <div className="bg-white border border-[#dbe2ea] rounded-xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
        <h3 className="text-sm font-semibold text-[#202020] mb-4">최근 6개월 글 생성 추이</h3>
        <div className="flex items-end justify-between gap-2 h-32">
          {usage.monthly.map((m) => (
            <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full">
              <span className="text-[11px] text-[#4a4f55] font-medium">{m.posts}</span>
              <div
                className="w-full max-w-[36px] bg-[#ff4628]/70 rounded-t-md"
                style={{ height: `${Math.max(4, Math.round((m.posts / maxTrend) * 80))}%` }}
                aria-label={`${monthLabel(m.month)} 글 ${m.posts}건`}
              />
              <span className="text-[11px] text-[#8a93a0]">{monthLabel(m.month)}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[#8a93a0] mt-3">
          · 글 생성 기록 기준 집계이며, 집계 시스템 도입 이전의 사용량은 포함되지 않을 수 있습니다.
        </p>
      </div>
    </div>
  );
}
