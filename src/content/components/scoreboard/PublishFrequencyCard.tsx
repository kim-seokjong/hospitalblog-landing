'use client';

import type { PublishFrequencyResult } from '@/content/lib/scoreboard/publish-frequency';

/**
 * ① 블로그 발행 빈도 (프록시).
 * content-plan 결과의 postdate 만으로 계산 — 추가 로딩 없음.
 * 사실 수치만 표시 (평가 라벨 금지 — 회사 규칙).
 */
export default function PublishFrequencyCard({ data }: { data: PublishFrequencyResult | null }) {
  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-5 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-lg bg-[#ffece7] flex items-center justify-center flex-shrink-0">
          <span className="text-sm">📝</span>
        </div>
        <h3 className="text-sm font-bold text-[#202020]">경쟁 블로그 발행 빈도</h3>
      </div>
      <p className="text-[11px] text-[#73808f] mb-4">
        최근 30일 검색 결과 표본 기준 · 실제 발행량의 하한 추정치입니다
      </p>

      {data && data.bloggers.length > 0 ? (
        <ul className="space-y-2">
          {data.bloggers.map((b, i) => (
            <li
              key={b.bloggerName}
              className="flex items-center gap-3 bg-[#eef2f6] rounded-xl px-4 py-3 min-h-[44px]"
            >
              <span className="text-[#ff4628] font-bold text-xs flex-shrink-0 w-5 text-right">
                {i + 1}
              </span>
              <span className="flex-1 min-w-0 text-sm font-semibold text-[#202020] truncate">
                {b.bloggerName}
              </span>
              {i === 0 && data.bloggers.length > 1 && (
                <span className="text-[10px] font-semibold text-[#ff4628] bg-[#ffece7] border border-[#ff4628]/30 px-2 py-0.5 rounded-full flex-shrink-0">
                  발행 최다
                </span>
              )}
              <span className="text-xs text-[#5b6573] flex-shrink-0">
                주 {b.perWeek}회 <span className="text-[#73808f]">({b.postsIn30Days}건/30일)</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[#73808f] bg-[#eef2f6] rounded-xl px-4 py-5 text-center">
          최근 30일 이내 발행된 경쟁 글이 검색 결과에 없어 빈도를 계산하지 못했습니다.
        </p>
      )}
    </div>
  );
}
