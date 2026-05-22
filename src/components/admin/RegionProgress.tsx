'use client';

import type { RegionTarget } from '@/types/admin';

interface RegionProgressProps {
  targets: RegionTarget[];
}

export default function RegionProgress({ targets }: RegionProgressProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h3 className="text-sm font-semibold text-gray-100 mb-4">
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
                <span className="text-sm text-gray-300">{t.region}</span>
                <span className="text-sm text-gray-400 text-right">
                  {t.current} / {t.target}개 ({rate}%)
                </span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
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
