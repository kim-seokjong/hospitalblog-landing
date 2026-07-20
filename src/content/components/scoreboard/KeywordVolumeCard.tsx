'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * ⑤ 키워드 검색량 · 경쟁정도 (네이버 검색광고 공개 지표).
 * - 지역+진료과 연관 키워드의 월 검색량(PC/모바일)·광고 경쟁정도(compIdx).
 * - 그레이스풀: 검색광고 env 없으면(available:false) 카드 자체를 조용히 숨긴다.
 * - 컴플라이언스: 공개 수치만 — 매출·방문자 추정치 절대 표시 금지.
 */

interface KeywordRow {
  keyword: string;
  pc: number;
  mobile: number;
  total: number;
  compIdx: string;
}

interface KeywordBoardResult {
  available: boolean;
  rows: KeywordRow[];
}

interface Props {
  specialty: string;
  region: string;
  runId: number;
}

const COMP_BADGE: Record<string, string> = {
  낮음: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  중간: 'bg-amber-50 text-amber-600 border-amber-200',
  높음: 'bg-red-50 text-red-500 border-red-200',
};

export default function KeywordVolumeCard({ specialty, region, runId }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<KeywordBoardResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 실행 번호 — 재분석·재시도 연속 실행 시 이전 응답이 최신 결과를 덮지 않도록 가드 */
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    if (!specialty || !region) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/competitor-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specialty, region }),
      });
      const data = (await res.json()) as KeywordBoardResult & { error?: string };
      if (reqId !== reqRef.current) return;
      if (!res.ok) {
        throw new Error(data.error ?? '키워드 데이터 조회에 실패했습니다.');
      }
      setResult(data);
    } catch (err) {
      if (reqId !== reqRef.current) return;
      setError(err instanceof Error ? err.message : '키워드 데이터 조회에 실패했습니다.');
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  }, [specialty, region]);

  useEffect(() => {
    if (runId > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // 그레이스풀: 검색광고 env 미설정 → 카드 자체를 조용히 숨김
  if (result && !result.available) return null;
  if (!loading && !error && result && result.rows.length === 0) return null;

  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-5 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <div className="w-7 h-7 rounded-lg bg-[#ffece7] flex items-center justify-center flex-shrink-0">
          <span className="text-sm">🔑</span>
        </div>
        <h3 className="text-sm font-bold text-[#202020]">키워드 검색량 · 경쟁정도</h3>
      </div>
      <p className="text-[11px] text-[#73808f] mb-4">
        {region} {specialty} 관련 키워드의 네이버 공개 지표(월 검색량·광고 경쟁정도)입니다
      </p>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <span className="w-4 h-4 border-2 border-[#ff4628] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-[#5b6573]">키워드 데이터 조회 중...</span>
        </div>
      ) : error ? (
        <div className="bg-yellow-50 border border-yellow-500/30 rounded-xl px-4 py-3 flex items-start gap-2">
          <span className="text-yellow-600 text-xs flex-shrink-0 mt-0.5">⚠</span>
          <p className="text-xs text-yellow-700 flex-1">{error}</p>
          <button
            onClick={() => void load()}
            className="text-xs font-semibold text-yellow-700 underline min-h-[44px] px-2 flex-shrink-0"
          >
            재시도
          </button>
        </div>
      ) : result ? (
        <ul className="space-y-1.5">
          {result.rows.map((row, i) => (
            <li
              key={row.keyword}
              className="flex items-center gap-3 bg-[#eef2f6] rounded-xl px-4 py-3 min-h-[44px]"
            >
              <span className="text-[#ff4628] font-bold text-xs flex-shrink-0 w-5 text-right">
                {i + 1}
              </span>
              <span className="flex-1 min-w-0 text-sm font-semibold text-[#202020] truncate">
                {row.keyword}
              </span>
              {COMP_BADGE[row.compIdx] && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${COMP_BADGE[row.compIdx]}`}>
                  광고경쟁 {row.compIdx}
                </span>
              )}
              <span className="text-[11px] text-[#5b6573] flex-shrink-0 text-right">
                <span className="block font-bold text-[#202020]">
                  월 {row.total.toLocaleString('ko-KR')}회
                </span>
                <span className="block text-[10px]">
                  PC {row.pc.toLocaleString('ko-KR')} · 모바일 {row.mobile.toLocaleString('ko-KR')}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
