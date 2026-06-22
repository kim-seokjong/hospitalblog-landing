'use client';

import { useEffect, useState, useCallback } from 'react';
import { ctrForRank } from '@/content/lib/roi-estimate';
import type { PostRankingItem, RankPoint } from '@/app/api/mypage/rankings/route';

type FetchState = 'loading' | 'ready' | 'error';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function rankLabel(rank: number | null): string {
  return rank === null ? '100위 밖' : `${rank}위`;
}

/** 최신 대비 직전 순위 증감 (낮을수록 좋음). 데이터 부족 시 null. */
function rankTrend(history: readonly RankPoint[]): 'up' | 'down' | 'same' | null {
  const ranked = history.filter((h) => h.rank !== null) as { rank: number; checkedAt: string }[];
  if (ranked.length < 2) return null;
  const latest = ranked[ranked.length - 1].rank;
  const prev = ranked[ranked.length - 2].rank;
  if (latest < prev) return 'up';   // 순위 숫자 감소 = 상승
  if (latest > prev) return 'down';
  return 'same';
}

/** 추정 월 도달 = 검색량 × 순위 CTR. 순위/검색량 없으면 null. */
function estimateMonthlyReach(rank: number | null, totalVolume: number | undefined): number | null {
  if (rank === null || totalVolume === undefined || totalVolume <= 0) return null;
  return Math.round(totalVolume * ctrForRank(rank));
}

/** 간단 스파크라인 — 순위(낮을수록 높이 큼). null(미발견)은 바닥. */
function Sparkline({ history }: { history: readonly RankPoint[] }) {
  const points = history.slice(-8);
  if (points.length === 0) {
    return <span className="text-xs text-[#5b6573]">추적 데이터 없음</span>;
  }
  // 순위를 0~1 높이로: 1위=가장 높음, 100위/null=가장 낮음
  const toHeight = (rank: number | null): number => {
    if (rank === null) return 6;
    const clamped = Math.min(Math.max(rank, 1), 100);
    return Math.round(6 + (1 - (clamped - 1) / 99) * 26); // 6~32px
  };
  return (
    <div className="flex items-end gap-0.5 h-8" aria-hidden>
      {points.map((p, i) => (
        <div
          key={i}
          className={`w-1.5 rounded-t-sm ${p.rank === null ? 'bg-[#b4bfce]' : 'bg-[#ff4628]/70'}`}
          style={{ height: `${toHeight(p.rank)}px` }}
          title={`${rankLabel(p.rank)}`}
        />
      ))}
    </div>
  );
}

function TrendArrow({ trend }: { trend: 'up' | 'down' | 'same' | null }) {
  if (trend === null) return null;
  if (trend === 'up') return <span className="text-green-600 text-xs font-semibold" title="순위 상승">▲ 상승</span>;
  if (trend === 'down') return <span className="text-red-500 text-xs font-semibold" title="순위 하락">▼ 하락</span>;
  return <span className="text-[#5b6573] text-xs" title="변동 없음">– 유지</span>;
}

function siteBadge(site: PostRankingItem['targetSite']): { text: string; className: string } {
  if (site === 'google') {
    return { text: '구글', className: 'bg-blue-50 text-blue-600 border border-blue-200' };
  }
  return { text: '네이버', className: 'bg-green-50 text-green-700 border border-green-200' };
}

function RankingCard({ item }: { item: PostRankingItem }) {
  const site = siteBadge(item.targetSite);
  const trend = rankTrend(item.history);
  const reach = estimateMonthlyReach(item.latestRank, item.volume?.total);
  const hasHistory = item.history.length > 0;

  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${site.className}`}>{site.text}</span>
          {item.keyword && <span className="text-xs text-[#ff4628]">#{item.keyword}</span>}
        </div>
        <span className="text-xs text-[#5b6573] flex-shrink-0">{formatDate(item.publishedAt)}</span>
      </div>

      <h3 className="font-semibold text-[#202020] text-sm leading-snug mb-3 line-clamp-2">
        {item.publishedUrl ? (
          <a href={item.publishedUrl} target="_blank" rel="noopener noreferrer" className="hover:text-[#ff4628] underline-offset-2 hover:underline">
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </h3>

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] text-[#5b6573] mb-0.5">추정 순위</p>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-[#202020]">{hasHistory ? rankLabel(item.latestRank) : '-'}</span>
            <TrendArrow trend={trend} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Sparkline history={item.history} />
          <span className="text-[10px] text-[#5b6573]">최근 추세</span>
        </div>
      </div>

      {/* 추정 대비 실측 맥락 */}
      <div className="mt-3 pt-3 border-t border-[#eef2f6] grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-[#5b6573]">월 검색량</p>
          <p className="font-semibold text-[#202020]">
            {item.volume ? `${item.volume.total.toLocaleString('ko-KR')}회` : '집계 없음'}
          </p>
        </div>
        <div>
          <p className="text-[#5b6573]">추정 월 도달</p>
          <p className="font-semibold text-[#202020]">
            {reach !== null ? `${reach.toLocaleString('ko-KR')}회` : '–'}
          </p>
        </div>
      </div>

      {!hasHistory && (
        <p className="mt-3 text-[11px] text-[#5b6573]">
          {item.publishedUrl || item.keyword
            ? '다음 자동 추적에서 순위가 수집됩니다.'
            : '발행 URL·키워드가 없어 추적 대상이 아닙니다.'}
        </p>
      )}
    </div>
  );
}

/**
 * 마이페이지 — 성과 리포트 탭.
 * 발행글별 네이버 검색 추정순위 + 추세 + 검색량 + 추정 월 도달(ROI 시뮬레이터 CTR 곡선 연동).
 * 순위는 cron이 매일 수집(post_rankings). 추정치이며 실제 성과를 보장하지 않는다.
 */
export default function RankingsTab() {
  const [items, setItems] = useState<PostRankingItem[]>([]);
  const [volumeAvailable, setVolumeAvailable] = useState(false);
  const [blogConfigured, setBlogConfigured] = useState(true);
  const [state, setState] = useState<FetchState>('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const res = await fetch('/api/mypage/rankings');
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '성과 리포트를 불러오지 못했습니다.');
      }
      const json = await res.json() as { items: PostRankingItem[]; volumeAvailable: boolean; blogConfigured?: boolean };
      setItems(json.items ?? []);
      setVolumeAvailable(Boolean(json.volumeAvailable));
      setBlogConfigured(json.blogConfigured !== false);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : '성과 리포트를 불러오지 못했습니다.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return <div className="py-16 text-center text-[#5b6573] text-sm">성과 리포트를 불러오는 중...</div>;
  }

  if (state === 'error') {
    return (
      <div className="py-16 text-center">
        <p className="text-red-600 text-sm mb-4">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="px-4 py-2 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-lg transition-colors"
        >
          다시 시도
        </button>
      </div>
    );
  }

  const trackedCount = items.filter((i) => i.history.length > 0).length;

  return (
    <div className="space-y-4">
      {/* 요약 헤더 */}
      <div className="bg-white border border-[#b4bfce] rounded-2xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
        <h3 className="text-sm font-semibold text-[#202020] mb-1">발행글 검색 성과 (추정)</h3>
        <p className="text-xs text-[#5b6573] leading-relaxed">
          최근 3개월 발행글의 네이버 블로그 검색 추정 순위를 매일 자동 추적합니다.
          {' '}
          {trackedCount > 0
            ? `현재 ${trackedCount}편 추적 중입니다.`
            : '아직 추적 데이터가 없습니다. 다음 자동 추적 후 수집됩니다.'}
        </p>
      </div>

      {/* 블로그 주소 미설정 안내 — 추적의 전제 (자동발행 연동과 무관) */}
      {!blogConfigured && (
        <div className="bg-[#ffece7] border border-[#ff4628]/30 rounded-2xl p-4 sm:p-5">
          <p className="text-sm font-semibold text-[#202020] mb-1">내 블로그 주소를 입력하면 순위 추적이 시작됩니다</p>
          <p className="text-xs text-[#5b6573] leading-relaxed mb-3">
            공개 블로그 주소만 있으면 됩니다. 자동발행 연동은 필요 없습니다. 생성글을 직접 발행하는 경우에도 추적됩니다.
          </p>
          <a
            href="/mypage?tab=profile"
            className="inline-block px-4 py-2 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-xl transition-colors"
          >
            내 정보에서 블로그 주소 입력하기
          </a>
        </div>
      )}

      {items.length === 0 ? (
        <div className="py-16 text-center bg-white border border-[#b4bfce] rounded-2xl shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          <p className="text-[#202020] font-semibold mb-1">아직 발행한 글이 없습니다</p>
          <p className="text-sm text-[#5b6573] mb-4">글을 작성해 발행하면 검색 순위가 자동으로 추적됩니다.</p>
          <a
            href="/app"
            className="inline-block px-5 py-2.5 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-xl transition-colors"
          >
            글 작성하러 가기
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map((item) => (
            <RankingCard key={item.postId} item={item} />
          ))}
        </div>
      )}

      {/* 검색량 미연동 안내 (그레이스풀) */}
      {items.length > 0 && !volumeAvailable && (
        <p className="text-[11px] text-[#5b6573]">
          · 검색량 데이터는 네이버 검색광고 연동 시 표시됩니다.
        </p>
      )}

      {/* 면책 */}
      <div className="rounded-xl border border-[#b4bfce] bg-[#eef2f6] px-4 py-3">
        <p className="text-[11px] text-[#5b6573] leading-relaxed">
          순위는 네이버 블로그 검색 관련도(sort=sim) 기준 <strong className="text-[#4a4f55]">추정치</strong>이며, 실제 노출·방문·문의 성과를 보장하지 않습니다.
          {' '}
          추정 월 도달은 업계 통용 CTR 곡선에 기반한 시뮬레이션입니다. 방문·문의 실측은 별도 분석도구가 필요합니다.
        </p>
      </div>
    </div>
  );
}
