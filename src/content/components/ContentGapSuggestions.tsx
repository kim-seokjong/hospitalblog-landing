'use client';

/**
 * 이번 주 빈 주제 제안 — 같은 지역+진료과 경쟁 블로그는 다루는데
 * 우리 병원 글에는 아직 없는 주제를 골라 보여준다 (/api/content-plan 재사용).
 *
 * - 주 1회 갱신: localStorage 캐시 (지역·진료과·ISO주 단위 키) — 네이버 검색+Claude 분석 비용 절약
 * - 클릭 → onSelect(keyword) 로 키워드 입력란 자동 채움
 * - 실패/데이터 없음 → 조용히 숨김 (부가 기능, 생성 플로우 방해 금지)
 */

import { useEffect, useState } from 'react';

const CACHE_PREFIX = 'dp_gap_v1';
const MAX_SUGGESTIONS = 5;

interface GapItem {
  text: string;
  keyword: string;
  volume: { total: number } | null;
}

interface CacheShape {
  week: string;
  gaps: GapItem[];
}

interface Props {
  specialty: string;
  region: string;
  onSelect: (keyword: string) => void;
}

/** ISO 주 식별자 (예: 2026-W27) — 주가 바뀌면 캐시 자동 무효화 */
function isoWeek(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function readCache(key: string): GapItem[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CacheShape>;
    if (parsed.week !== isoWeek() || !Array.isArray(parsed.gaps)) return null;
    return parsed.gaps.filter(
      (g): g is GapItem => !!g && typeof g.keyword === 'string' && typeof g.text === 'string',
    );
  } catch {
    return null;
  }
}

function writeCache(key: string, gaps: GapItem[]): void {
  try {
    const value: CacheShape = { week: isoWeek(), gaps };
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage 불가 환경 무시
  }
}

export default function ContentGapSuggestions({ specialty, region, onSelect }: Props) {
  const [gaps, setGaps] = useState<GapItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // API가 지역을 요구 — 프로필에 지역 없으면 노출하지 않음
    if (!specialty || !region) return;
    const cacheKey = `${CACHE_PREFIX}:${specialty}:${region}`;

    const cached = readCache(cacheKey);
    if (cached) {
      setGaps(cached.slice(0, MAX_SUGGESTIONS));
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetch('/api/content-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ specialty, region }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('gap fetch failed');
        const data = (await res.json()) as { gaps?: GapItem[] };
        const items = (data.gaps ?? [])
          .filter((g) => g && typeof g.keyword === 'string' && g.keyword.trim())
          .slice(0, MAX_SUGGESTIONS);
        if (!cancelled) {
          setGaps(items);
          writeCache(cacheKey, items);
        }
      })
      .catch(() => {
        // 부가 기능 — 실패 시 조용히 숨김
        if (!cancelled) setGaps([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [specialty, region]);

  if (!specialty || !region) return null;
  if (!loading && gaps.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[#b4bfce] bg-white p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">📌</span>
        <h3 className="text-sm font-bold text-[#202020]">이번 주 빈 주제 제안</h3>
        <span className="text-[10px] font-semibold text-[#ff4628] bg-[#ffece7] border border-[#ff4628]/30 px-2 py-0.5 rounded-full">
          주간 갱신
        </span>
      </div>
      <p className="text-[11px] text-[#5b6573] mb-3">
        {region} {specialty} 상위 블로그는 다루는데, 우리 병원 글에는 아직 없는 주제예요. 누르면 키워드로 채워집니다.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[#73808f] py-1.5">
          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          경쟁 블로그와 비교 분석 중...
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {gaps.map((g) => (
            <button
              key={g.keyword}
              type="button"
              onClick={() => onSelect(g.keyword)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#b4bfce] bg-white text-xs font-semibold text-[#202020] hover:border-[#ff4628] hover:bg-[#ffece7] active:bg-[#ffece7] transition-colors"
              title={g.text}
            >
              {g.keyword}
              {g.volume && g.volume.total > 0 && (
                <span className="text-[10px] text-[#73808f] font-normal">
                  월 {g.volume.total.toLocaleString('ko-KR')}회
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
