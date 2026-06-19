'use client';

import type { RegionTarget } from '@/types/admin';

interface RegionProgressProps {
  targets: RegionTarget[];
}

export default function RegionProgress({ targets }: RegionProgressProps) {
  return (
    <div className="bg-white border border-[#b4bfce] rounded-xl p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <h3 className="text-sm font-semibold text-[#202020] mb-4">
        지역별 진척률
      </h3>
      <div className="space-y-3">
        {targets.map((t) => {
          const rate =
            t.target > 0
              ? Math.min(100, Math.round((t.current / t.target) * 100))
              : 0;
          const isHigh = rate >= 90;
          const barColor = isHigh ? 'bg-orange-500' : 'bg-emerald-500';
          return (
            <div key={t.region} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#4a4f55]">{t.region}</span>
                <span className="text-sm text-[#5b6573] text-right">
                  {t.current} / {t.target}개 ({rate}%)
                </span>
              </div>
              <div className="h-1.5 bg-[#eef2f6] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${barColor}`}
                  style={{ width: `${rate}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
