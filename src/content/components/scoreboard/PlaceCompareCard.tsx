'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * ③ 플레이스 상위노출 + 리뷰 수 (하이브리드).
 * - 1차: 지역검색 톱5 + 내 병원 "톱5 진입" 배지.
 * - 2차: 상세 순위·리뷰 수 (베스트에포트 — 실패 시 "상세 순위 일시 확인 불가").
 * - 스냅샷 2회 이상이면 리뷰 증감(↑N), 아니면 "추이 축적 중".
 */

interface TopFiveItem {
  name: string;
  category: string;
  address: string;
  link: string;
}

interface DeepItem {
  rank: number;
  name: string;
  visitorReviews: number | null;
  blogReviews: number | null;
  visitorDelta: number | null;
  blogDelta: number | null;
}

interface PlaceResult {
  query: string;
  topFive: TopFiveItem[];
  topFiveRank: number | null;
  deep: { items: DeepItem[]; myRank: number | null } | null;
  deepAvailable: boolean;
  trendStatus: 'ready' | 'accumulating' | 'none';
}

interface Props {
  specialty: string;
  region: string;
  hospitalName: string;
  runId: number;
}

function ReviewDelta({ value }: { value: number | null }) {
  if (value === null || value <= 0) return null;
  return <span className="text-[10px] font-bold text-[#ff4628] ml-0.5">↑{value.toLocaleString('ko-KR')}</span>;
}

export default function PlaceCompareCard({ specialty, region, hospitalName, runId }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PlaceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!specialty || !region) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/competitor-place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specialty, region, hospitalName: hospitalName || undefined }),
      });
      const data = (await res.json()) as PlaceResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? '플레이스 조회에 실패했습니다.');
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '플레이스 조회에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [specialty, region, hospitalName]);

  useEffect(() => {
    if (runId > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-5 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <div className="w-7 h-7 rounded-lg bg-[#ffece7] flex items-center justify-center flex-shrink-0">
          <span className="text-sm">📍</span>
        </div>
        <h3 className="text-sm font-bold text-[#202020]">플레이스 상위노출 · 리뷰</h3>
        {result?.topFiveRank !== null && result?.topFiveRank !== undefined && (
          <span className="text-[10px] font-bold text-white bg-[#ff4628] px-2 py-0.5 rounded-full">
            내 병원 톱5 진입 ({result.topFiveRank}위)
          </span>
        )}
      </div>
      <p className="text-[11px] text-[#73808f] mb-4">
        네이버 검색 노출 순서·공개 리뷰 수 기준의 사실 수치입니다
      </p>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <span className="w-4 h-4 border-2 border-[#ff4628] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-[#5b6573]">플레이스 조회 중...</span>
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
        <div className="space-y-4">
          {/* 상세 순위 + 리뷰 (2차 성공 시) */}
          {result.deep ? (
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <p className="text-xs font-semibold text-[#5b6573]">상세 노출 순위 · 리뷰 수</p>
                {result.trendStatus === 'accumulating' && (
                  <span className="text-[10px] text-[#73808f] bg-[#eef2f6] border border-[#b4bfce] px-2 py-0.5 rounded-full">
                    추이 축적 중 — 다음 조회부터 증감 표시
                  </span>
                )}
              </div>
              <ul className="space-y-1.5">
                {result.deep.items.map((item) => (
                  <li
                    key={`${item.rank}-${item.name}`}
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 min-h-[44px] ${
                      result.deep?.myRank === item.rank
                        ? 'bg-[#ffece7] border border-[#ff4628]/30'
                        : 'bg-[#eef2f6]'
                    }`}
                  >
                    <span className="text-[#ff4628] font-bold text-xs flex-shrink-0 w-5 text-right">
                      {item.rank}
                    </span>
                    <span className="flex-1 min-w-0 text-sm font-semibold text-[#202020] truncate">
                      {item.name}
                      {result.deep?.myRank === item.rank && (
                        <span className="text-[10px] font-bold text-[#ff4628] ml-1.5">내 병원</span>
                      )}
                    </span>
                    <span className="text-[11px] text-[#5b6573] flex-shrink-0 text-right">
                      {item.visitorReviews !== null && (
                        <span className="block">
                          방문 {item.visitorReviews.toLocaleString('ko-KR')}
                          <ReviewDelta value={item.visitorDelta} />
                        </span>
                      )}
                      {item.blogReviews !== null && (
                        <span className="block">
                          블로그 {item.blogReviews.toLocaleString('ko-KR')}
                          <ReviewDelta value={item.blogDelta} />
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[11px] text-[#73808f] bg-[#eef2f6] rounded-xl px-4 py-2.5">
              상세 순위·리뷰 수는 일시적으로 확인할 수 없습니다. 아래 톱5 결과를 참고해주세요.
            </p>
          )}

          {/* 1차 톱5 */}
          <div>
            <p className="text-xs font-semibold text-[#5b6573] mb-2">지역검색 톱5</p>
            {result.topFive.length > 0 ? (
              <ul className="space-y-1.5">
                {result.topFive.map((p, i) => (
                  <li
                    key={`${p.name}-${i}`}
                    className="flex items-center gap-3 bg-[#eef2f6] rounded-xl px-4 py-3 min-h-[44px]"
                  >
                    <span className="text-[#ff4628] font-bold text-xs flex-shrink-0 w-5 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#202020] truncate">{p.name}</p>
                      <p className="text-[11px] text-[#73808f] truncate">{p.address}</p>
                    </div>
                    {p.link && (
                      <a
                        href={p.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#73808f] hover:text-[#ff4628] text-sm flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors"
                        aria-label={`${p.name} 열기`}
                      >
                        →
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[#73808f] bg-[#eef2f6] rounded-xl px-4 py-5 text-center">
                지역검색 결과가 없습니다.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
