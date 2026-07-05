'use client';

import { useEffect, useState } from 'react';
import { periodLabel } from '@/content/lib/monthly-report';
import type { MonthlyReportListItem } from '@/app/api/mypage/monthly-reports/route';

type FetchState = 'loading' | 'ready' | 'error';

/**
 * 성과 리포트 탭 — 월간 리포트 목록 섹션.
 * 매월 1일 cron이 생성한 지난달 리포트를 최신순으로 나열하고,
 * 인쇄 최적화 페이지(/app/monthly-report/[period])로 연결한다.
 */
export default function MonthlyReportsSection() {
  const [items, setItems] = useState<MonthlyReportListItem[]>([]);
  const [state, setState] = useState<FetchState>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/mypage/monthly-reports');
        if (!res.ok) throw new Error('load failed');
        const json = await res.json() as { items?: MonthlyReportListItem[] };
        if (!cancelled) {
          setItems(json.items ?? []);
          setState('ready');
        }
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-[#202020]">월간 리포트</h3>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#ffece7] text-[#ff4628]">
          매월 1일 자동 생성
        </span>
      </div>
      <p className="text-xs text-[#5b6573] leading-relaxed mb-3">
        지난달 닥터포스트가 해낸 일(글 생성·발행·의료광고법 검사·순위 변동)을 한 장으로 정리합니다. PDF 저장도 가능합니다.
      </p>

      {state === 'loading' && (
        <p className="text-xs text-[#5b6573] py-2">월간 리포트를 불러오는 중...</p>
      )}

      {state === 'error' && (
        <p className="text-xs text-red-600 py-2">월간 리포트를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>
      )}

      {state === 'ready' && items.length === 0 && (
        <p className="text-xs text-[#5b6573] py-2">
          아직 생성된 월간 리포트가 없습니다. 다음 달 1일에 첫 리포트가 도착합니다.
        </p>
      )}

      {state === 'ready' && items.length > 0 && (
        <ul className="divide-y divide-[#eef2f6]">
          {items.map((item) => (
            <li key={item.period}>
              <a
                href={`/app/monthly-report/${item.period}`}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 py-2.5 group"
              >
                <span className="text-sm font-semibold text-[#202020] group-hover:text-[#ff4628] transition-colors">
                  {periodLabel(item.period)} 리포트
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#5b6573]">
                  <span>생성 {item.summary.generated}회</span>
                  <span>발행 {item.summary.published}건</span>
                  <span>검사 {item.summary.complianceChecked}건</span>
                  {item.summary.top10Count > 0 && (
                    <span className="text-[#ff4628] font-medium">상위 10위 {item.summary.top10Count}건</span>
                  )}
                  <span className="text-[#ff4628] font-semibold group-hover:underline underline-offset-2">보기 →</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
