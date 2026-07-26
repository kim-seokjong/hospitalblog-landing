'use client';

import { useEffect, useState, useCallback } from 'react';
import { ctrForRank } from '@/content/lib/roi-estimate';
import MonthlyReportsSection from '@/hr/components/mypage/MonthlyReportsSection';
import type {
  PostRankingItem,
  KeywordRankItem,
  RankPoint,
  RankStatus,
} from '@/app/api/mypage/rankings/route';

type FetchState = 'loading' | 'ready' | 'error';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** 기본 스캔 깊이 — scanned_depth 가 없는 구 데이터의 표시 기준. */
const DEFAULT_SCAN_DEPTH = 100;

interface RankDisplay {
  text: string;
  /** 순위가 확정된 경우만 강조 */
  tone: 'rank' | 'muted' | 'warn';
  hint: string;
}

/**
 * ★ "측정 실패" 와 "N위 밖" 을 절대 같게 보여주지 않는다.
 *   예전에는 둘 다 rank=null → "100위 밖" 으로 표시돼, 측정이 두 달간 죽어 있는데도
 *   화면은 "순위권 밖"이라고 말하고 있었다.
 */
function rankDisplay(
  status: RankStatus | null,
  rank: number | null,
  scannedDepth: number | null,
): RankDisplay {
  const depth = scannedDepth && scannedDepth > 0 ? scannedDepth : DEFAULT_SCAN_DEPTH;
  if (status === 'failed') {
    return {
      text: '측정 실패',
      tone: 'warn',
      hint: '네이버 검색 조회에 실패해 이번 회차 순위를 확인하지 못했습니다. 다음 자동 추적에서 다시 시도합니다.',
    };
  }
  if (status === 'ambiguous') {
    return {
      text: '확인 필요',
      tone: 'warn',
      hint: '이 키워드에서 같은 블로그의 글이 여러 편 검색돼 어느 글인지 특정하지 못했습니다.',
    };
  }
  if (status === 'not_found') {
    return {
      text: `${depth.toLocaleString('ko-KR')}위 밖`,
      tone: 'muted',
      hint: `${depth.toLocaleString('ko-KR')}위까지 확인했으나 이 글이 검색되지 않았습니다.`,
    };
  }
  if (rank !== null) {
    return { text: `${rank}위`, tone: 'rank', hint: '네이버 검색 API 기준 추정 순위입니다.' };
  }
  return { text: '집계 전', tone: 'muted', hint: '아직 유효한 측정 기록이 없습니다.' };
}

/** 최신 대비 직전 순위 증감 (낮을수록 좋음). 데이터 부족 시 null. */
function rankTrend(history: readonly RankPoint[]): 'up' | 'down' | 'same' | null {
  const ranked = history.filter(
    (h): h is RankPoint & { rank: number } => h.rank !== null && h.status !== 'failed',
  );
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

/** 간단 스파크라인 — 순위(낮을수록 높이 큼). 미발견은 바닥, 측정 실패는 회색 점선 톤. */
function Sparkline({ history }: { history: readonly RankPoint[] }) {
  const points = history.slice(-8);
  if (points.length === 0) {
    return <span className="text-xs text-[#5b6573]">추적 데이터 없음</span>;
  }
  const toHeight = (p: RankPoint): number => {
    if (p.rank === null) return 6;
    const clamped = Math.min(Math.max(p.rank, 1), 100);
    return Math.round(6 + (1 - (clamped - 1) / 99) * 26); // 6~32px
  };
  return (
    <div className="flex items-end gap-0.5 h-8" aria-hidden>
      {points.map((p, i) => {
        const failed = p.status === 'failed' || p.status === 'ambiguous';
        const label = rankDisplay(p.status, p.rank, p.scannedDepth).text;
        return (
          <div
            key={i}
            className={`w-1.5 rounded-t-sm ${
              failed ? 'bg-[#d9a441]/50' : p.rank === null ? 'bg-[#b4bfce]' : 'bg-[#ff4628]/70'
            }`}
            style={{ height: `${toHeight(p)}px` }}
            title={label}
          />
        );
      })}
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

/** 네이버 검색 결과 페이지로 바로 보내는 링크 — 원장이 직접 눈으로 확인할 수 있게. */
function naverSearchUrl(keyword: string): string {
  return `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(keyword)}`;
}

/** 키워드 1개 행 — 콤마로 여러 개 입력했으면 각각 따로 추적된다. */
function KeywordRow({ item }: { item: KeywordRankItem }) {
  const display = rankDisplay(item.latestStatus, item.latestRank, item.latestScannedDepth);
  const trend = rankTrend(item.history);
  const reach = estimateMonthlyReach(
    item.latestStatus === 'failed' ? null : item.latestRank,
    item.volume?.total,
  );
  const toneClass =
    display.tone === 'rank'
      ? 'text-[#202020]'
      : display.tone === 'warn'
        ? 'text-[#b26a00]'
        : 'text-[#5b6573]';

  return (
    <div className="py-2.5 border-t border-[#eef2f6] first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <a
            href={naverSearchUrl(item.keyword)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#ff4628] hover:underline underline-offset-2 break-keep"
            title="네이버에서 이 키워드로 직접 검색해 보기"
          >
            #{item.keyword}
          </a>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mt-0.5">
            <span className={`text-lg font-bold ${toneClass}`} title={display.hint}>
              {display.text}
            </span>
            <TrendArrow trend={trend} />
          </div>
          {(display.tone === 'warn' || item.history.length === 0) && (
            <p className="text-[11px] text-[#5b6573] mt-0.5 leading-snug">
              {item.history.length === 0 ? '다음 자동 추적에서 수집됩니다.' : display.hint}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <Sparkline history={item.history} />
          <span className="text-[10px] text-[#5b6573]">
            {item.volume ? `검색 ${item.volume.total.toLocaleString('ko-KR')}회` : '최근 추세'}
          </span>
        </div>
      </div>
      {reach !== null && (
        <p className="text-[11px] text-[#5b6573] mt-1">
          추정 월 도달 <span className="font-semibold text-[#202020]">{reach.toLocaleString('ko-KR')}회</span>
        </p>
      )}
    </div>
  );
}

function RankingCard({ item }: { item: PostRankingItem }) {
  const site = siteBadge(item.targetSite);
  const hasKeywords = item.keywords.length > 0;

  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${site.className}`}>{site.text}</span>
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

      {hasKeywords ? (
        <div className="rounded-xl bg-[#f8fafc] border border-[#eef2f6] px-3 py-2">
          {item.keywords.map((kw) => (
            <KeywordRow key={kw.keyword} item={kw} />
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-[#5b6573]">
          키워드가 없어 추적 대상이 아닙니다.
        </p>
      )}
    </div>
  );
}

/**
 * 마이페이지 — 성과 리포트 탭.
 * 발행글의 키워드별 네이버 검색 추정순위 + 추세 + 검색량 + 추정 월 도달.
 * 순위는 cron이 매일 수집(post_rankings).
 *
 * ★ 네이버는 실제 검색 화면 순위를 주는 공식 API 를 제공하지 않는다.
 *   여기 값은 검색 API(sort=sim) 기준 추정치이며, 실측에서 같은 글이
 *   API 5위 / 실제 화면 2위로 나온 사례가 있다. 크롤링은 약관 위반이라 하지 않는다.
 *   → 화면에 이 사실을 담백하게 명시하고, 직접 검색해 확인할 수 있게 링크를 건다.
 */
export default function RankingsTab() {
  const [items, setItems] = useState<PostRankingItem[]>([]);
  const [volumeAvailable, setVolumeAvailable] = useState(false);
  const [blogConfigured, setBlogConfigured] = useState(true);
  const [failedCount, setFailedCount] = useState(0);
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
      const json = await res.json() as {
        items: PostRankingItem[];
        volumeAvailable: boolean;
        blogConfigured?: boolean;
        failedCount?: number;
      };
      setItems(json.items ?? []);
      setVolumeAvailable(Boolean(json.volumeAvailable));
      setBlogConfigured(json.blogConfigured !== false);
      setFailedCount(typeof json.failedCount === 'number' ? json.failedCount : 0);
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

  const trackedCount = items.reduce(
    (sum, it) => sum + it.keywords.filter((k) => k.history.length > 0).length,
    0,
  );

  return (
    <div className="space-y-4">
      {/* 월간 리포트 — 매월 1일 자동 생성, 인쇄 페이지로 연결 */}
      <MonthlyReportsSection />

      {/* 요약 헤더 */}
      <div className="bg-white border border-[#b4bfce] rounded-2xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
        <h3 className="text-sm font-semibold text-[#202020] mb-1">발행글 검색 성과 (추정)</h3>
        <p className="text-xs text-[#5b6573] leading-relaxed">
          최근 3개월 발행글의 네이버 블로그 검색 추정 순위를 키워드별로 매일 자동 추적합니다.
          {' '}
          {trackedCount > 0
            ? `현재 키워드 ${trackedCount}개를 추적 중입니다.`
            : '아직 추적 데이터가 없습니다. 다음 자동 추적 후 수집됩니다.'}
        </p>

        {/* ★ 추정치 안내 — 원장이 직접 검색해 다르게 나와도 납득되도록 담백하게 */}
        <div className="mt-3 rounded-xl bg-[#eef2f6] border border-[#b4bfce]/60 px-3 py-2.5">
          <p className="text-[11px] sm:text-xs text-[#4a4f55] leading-relaxed break-keep">
            여기 표시되는 순위는 <strong className="font-semibold">네이버 검색 API 기준 추정치</strong>입니다.
            네이버는 실제 검색 화면의 순위를 알려주는 공식 API를 제공하지 않아,
            직접 검색해 보신 순위와는 차이가 날 수 있습니다.
            {' '}
            <span className="text-[#5b6573]">
              추세(오르는지 내리는지)를 보는 용도로 활용하시고, 정확한 위치는 키워드를 눌러 네이버에서 직접 확인해 주세요.
            </span>
          </p>
        </div>

        {/* 측정 실패 안내 — "순위권 밖"과 절대 섞어 보여주지 않는다 */}
        {failedCount > 0 && (
          <div className="mt-2 rounded-xl bg-[#fff8e8] border border-[#d9a441]/40 px-3 py-2.5">
            <p className="text-[11px] sm:text-xs text-[#7a5200] leading-relaxed break-keep">
              키워드 {failedCount}개는 이번 회차에 <strong className="font-semibold">순위를 측정하지 못했습니다</strong>
              (검색 조회 실패). 순위권 밖이라는 뜻이 아니며, 다음 자동 추적에서 다시 확인합니다.
            </p>
          </div>
        )}
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
        <p className="text-[11px] text-[#5b6573] leading-relaxed break-keep">
          순위는 네이버 블로그 검색 API(관련도 sort=sim) 응답에서 내 글의 위치를 찾은 <strong className="text-[#4a4f55]">추정치</strong>입니다.
          네이버 검색 화면은 관련도 외에 최신성·사용자 맥락 등 공개되지 않은 기준을 함께 반영하므로 실제 노출 순서와 다를 수 있으며,
          노출·방문·문의 성과를 보장하지 않습니다.
          {' '}
          추정 월 도달은 업계 통용 CTR 곡선에 기반한 시뮬레이션입니다. 방문·문의 실측은 별도 분석도구가 필요합니다.
        </p>
      </div>
    </div>
  );
}
