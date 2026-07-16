'use client';

import { useState } from 'react';

/**
 * 황금 키워드 찾기 — 입력한 주제 키워드의 연관 키워드 중
 * "검색량은 충분한데 블로그 문서수(경쟁)는 적은" 키워드를 추천한다.
 * + 데이터랩 기반 "지금 뜨는 계절 키워드" 섹션 (진료과 기준, 실패 시 조용히 숨김).
 *
 * 배지: 월 검색량 · 블로그 문서수 · 경쟁도(문서수÷검색량) · 계절🔥
 * 클릭 시 핵심 키워드를 클릭한 키워드 1개로 교체(단일 선택) — 씨앗 키워드와
 * 동시 선택되는 혼란 방지. (SpecialtyKeywordSuggester 의 추가/제거 UX 와 다름)
 */

interface GoldenItem {
  keyword: string;
  volume: { pc: number; mobile: number; total: number; compIdx: string };
  docCount: number | null;
  ratio: number | null;
  competition: '낮음' | '중간' | '높음' | null;
  seasonal: { keyword: string; boost: number } | null;
}

interface SeasonalItem {
  keyword: string;
  boost: number;
}

interface GoldenResponse {
  available?: boolean;
  docAvailable?: boolean;
  items?: GoldenItem[];
  seasonal?: { available?: boolean; items?: SeasonalItem[] };
  error?: string;
}

interface Props {
  /** 키워드 입력창의 현재 값 (콤마 구분 시 마지막 항목을 주제로 사용) */
  seedKeyword: string;
  region: string;
  specialty: string;
  /** 클릭한 키워드로 핵심 키워드를 교체 (append 아님 — 항상 단일 선택) */
  onReplace: (keyword: string) => void;
}

const COMPETITION_BADGE: Record<'낮음' | '중간' | '높음', string> = {
  낮음: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  중간: 'bg-amber-50 text-amber-600 border-amber-200',
  높음: 'bg-red-50 text-red-500 border-red-200',
};

/** 입력창 값에서 주제 키워드 추출 — 콤마 구분 마지막 비어있지 않은 항목 */
function extractSeed(raw: string): string {
  const parts = raw.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

export default function GoldenKeywordFinder({ seedKeyword, region, specialty, onReplace }: Props) {
  const [items, setItems] = useState<GoldenItem[]>([]);
  const [seasonalItems, setSeasonalItems] = useState<SeasonalItem[]>([]);
  const [docAvailable, setDocAvailable] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [searched, setSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 단일 선택 — 클릭한 키워드 1개만 하이라이트 (핵심 키워드 교체와 동기) */
  const [selected, setSelected] = useState<string | null>(null);

  const seed = extractSeed(seedKeyword);

  const handleFind = async () => {
    if (!seed) {
      setError('주제 키워드를 먼저 입력해주세요.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setItems([]);
    setSeasonalItems([]);
    setUnavailable(false);
    setSelected(null);

    try {
      const res = await fetch('/api/keywords/golden', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: seed,
          region: region.trim(),
          specialty: specialty.trim(),
        }),
      });

      const data = (await res.json()) as GoldenResponse;
      if (!res.ok) {
        throw new Error(data.error ?? '황금 키워드 조회에 실패했습니다.');
      }

      setSearched(true);
      if (data.available === false) {
        // 그레이스풀: 검색량 데이터 없음 — 조용히 안내만
        setUnavailable(true);
        return;
      }
      setItems(data.items ?? []);
      setDocAvailable(data.docAvailable !== false);
      setSeasonalItems(data.seasonal?.available === false ? [] : (data.seasonal?.items ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 클릭 = 핵심 키워드를 그 키워드 1개로 교체. 다른 항목 클릭 시 다시 교체.
  const handleChipClick = (keyword: string) => {
    setSelected(keyword);
    onReplace(keyword);
  };

  return (
    <div className="rounded-2xl border border-[#b4bfce] bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#ffece7] border border-[#ff4628]/30 flex items-center justify-center flex-shrink-0">
            <span className="text-[#ff4628] text-xs">⛏️</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#202020]">황금 키워드 찾기</h3>
            <p className="text-[10px] text-[#5b6573]">검색량은 충분한데 경쟁(문서수)은 적은 키워드</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleFind}
          disabled={isLoading || !seed}
          className="flex-shrink-0 px-3 py-2 bg-[#ff4628] hover:bg-[#e63a1c] active:bg-[#e63a1c] disabled:bg-[#b4bfce] disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 min-h-[36px]"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-3 w-3 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>분석 중...</span>
            </>
          ) : (
            <span>황금 키워드 찾기</span>
          )}
        </button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {unavailable && (
        <p className="text-xs text-[#73808f] bg-[#eef2f6] rounded-xl px-4 py-2.5">
          검색량 데이터를 일시적으로 사용할 수 없어요. 잠시 후 다시 시도해주세요.
        </p>
      )}

      {/* 🔥 지금 뜨는 계절 키워드 (데이터랩 상승 국면 — 실패 시 조용히 숨김) */}
      {seasonalItems.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[11px] font-bold text-[#ff4628]">🔥 지금 뜨는 계절 키워드</span>
            <span className="text-[9px] text-[#73808f]">이번 달·다음 달 검색 상승 국면</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {seasonalItems.map((s) => (
              <button
                key={s.keyword}
                type="button"
                onClick={() => handleChipClick(s.keyword)}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-all active:scale-95 ${
                  selected === s.keyword
                    ? 'bg-[#ff4628] border-[#ff4628] text-white'
                    : 'bg-white border-[#ff4628]/40 text-[#202020] hover:bg-[#ffece7]'
                }`}
              >
                {s.keyword}
                <span className={`text-[9px] font-bold ${selected === s.keyword ? 'text-white/80' : 'text-[#ff4628]'}`}>
                  ×{s.boost}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div>
          <p className="text-[10px] text-[#5b6573] mb-2">
            경쟁이 낮은 순서예요. 키워드를 누르면 핵심 키워드로 설정됩니다 ({items.length}개)
          </p>
          <ul className="space-y-1.5">
            {items.map((item) => (
              <li key={item.keyword}>
                <button
                  type="button"
                  onClick={() => handleChipClick(item.keyword)}
                  title={item.volume.compIdx !== '-' ? `광고 경쟁정도: ${item.volume.compIdx}` : undefined}
                  className={`w-full flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 rounded-xl border text-left transition-all active:scale-[0.99] min-h-[44px] ${
                    selected === item.keyword
                      ? 'border-[#ff4628] bg-[#ffece7]'
                      : 'border-[#e3e9f0] bg-white hover:border-[#ff4628]/50'
                  }`}
                >
                  <span className="text-xs font-bold text-[#202020] flex-1 min-w-0 truncate">
                    {item.keyword}
                  </span>
                  {item.seasonal && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-[#ffece7] text-[#ff4628] border-[#ff4628]/30">
                      계절🔥 ×{item.seasonal.boost}
                    </span>
                  )}
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#ffece7] text-[#ff4628]">
                    월 {item.volume.total.toLocaleString('ko-KR')}회
                  </span>
                  {item.docCount !== null && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#eef2f6] text-[#5b6573]">
                      문서 {item.docCount.toLocaleString('ko-KR')}
                    </span>
                  )}
                  {item.competition && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${COMPETITION_BADGE[item.competition]}`}>
                      경쟁 {item.competition}
                    </span>
                  )}
                  {/* 이 항목만 문서수 조회 실패 — 전체 실패(docAvailable=false)면 하단 안내문이 있으니 중복 표시 안 함 */}
                  {docAvailable && item.competition === null && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-[#eef2f6] text-[#73808f] border-[#d6dee8]">
                      경쟁 확인불가
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {!docAvailable && (
            <p className="text-[10px] text-[#73808f] mt-2">
              블로그 문서수는 일시적으로 확인할 수 없어 검색량 기준으로 정렬했어요.
            </p>
          )}
        </div>
      )}

      {searched && !isLoading && !unavailable && items.length === 0 && !error && (
        <p className="text-xs text-[#73808f] text-center py-2">
          연관 키워드를 찾지 못했어요. 더 일반적인 키워드로 시도해보세요.
        </p>
      )}

      {!searched && !isLoading && !error && (
        <p className="text-xs text-[#73808f] text-center py-2">
          키워드 입력 후 &quot;황금 키워드 찾기&quot;를 눌러보세요
        </p>
      )}
    </div>
  );
}
