'use client';

// 성과·안전 그룹 요약 스트립 — 원장이 들어와서 3초 안에 "잘 되고 있다"가 보이는 한 줄.
// 그룹 진입 시 1회만 조회하고, 실패한 카드는 조용히 숨긴다(에러 노출 절대 금지).

import { useEffect, useState } from 'react';
import type { MyPageTabId } from './mypage-tab-groups';

interface RankingsSummary {
  /** 추적 대상 발행 글 수 */
  total: number;
  /** 최신 추정순위 10위 이내 글 수 */
  top10: number;
}

interface GeoSummary {
  /** 최근 회차 체크 질문 수 */
  checked: number;
  /** 그중 AI 가 병원을 인용한 건수 */
  cited: number;
}

interface AuditSummary {
  /** 진단 이력 존재 여부 */
  hasAudit: boolean;
  /** 위반 소지(MEDIUM 이상) 글 수 */
  riskyPosts: number;
  /** 최근 진단에서 검사한 글 수 */
  totalPosts: number;
}

interface StripData {
  rankings: RankingsSummary | null;
  geo: GeoSummary | null;
  audit: AuditSummary | null;
}

const TOP_RANK_THRESHOLD = 10;

/** 성과 리포트 요약 — /api/mypage/rankings (RankingsTab 과 동일 API). 실패 시 null. */
async function fetchRankingsSummary(): Promise<RankingsSummary | null> {
  try {
    const res = await fetch('/api/mypage/rankings');
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items?: Array<{ latestRank: number | null }>;
    };
    if (!Array.isArray(data.items)) return null;
    const top10 = data.items.filter(
      (it) => it.latestRank !== null && it.latestRank <= TOP_RANK_THRESHOLD,
    ).length;
    return { total: data.items.length, top10 };
  } catch {
    return null;
  }
}

/** AI 검색 인용 요약 — /api/mypage/geo GET. 실패 시 null. */
async function fetchGeoSummary(): Promise<GeoSummary | null> {
  try {
    const res = await fetch('/api/mypage/geo');
    if (!res.ok) return null;
    const data = (await res.json()) as { latest?: Array<{ cited: boolean }> };
    if (!Array.isArray(data.latest)) return null;
    const cited = data.latest.filter((it) => it.cited).length;
    return { checked: data.latest.length, cited };
  } catch {
    return null;
  }
}

/** 블로그 진단 요약 — /api/blog-audit GET (최신 캐시). 실패 시 null. */
async function fetchAuditSummary(): Promise<AuditSummary | null> {
  try {
    const res = await fetch('/api/blog-audit');
    if (!res.ok) return null;
    const data = (await res.json()) as {
      audit?: { riskyPosts?: number; totalPosts?: number } | null;
    };
    if (data.audit === undefined) return null;
    if (data.audit === null) return { hasAudit: false, riskyPosts: 0, totalPosts: 0 };
    return {
      hasAudit: true,
      riskyPosts: typeof data.audit.riskyPosts === 'number' ? data.audit.riskyPosts : 0,
      totalPosts: typeof data.audit.totalPosts === 'number' ? data.audit.totalPosts : 0,
    };
  } catch {
    return null;
  }
}

interface SummaryCardProps {
  label: string;
  value: string;
  valueTone: 'good' | 'warn' | 'neutral';
  sub: string;
  onClick: () => void;
}

function SummaryCard({ label, value, valueTone, sub, onClick }: SummaryCardProps) {
  const toneClass =
    valueTone === 'good'
      ? 'text-green-600'
      : valueTone === 'warn'
        ? 'text-[#ff4628]'
        : 'text-[#202020]';
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-0 text-left bg-white border border-[#b4bfce] rounded-xl px-3 py-2.5 hover:border-[#ff4628]/60 transition-colors"
    >
      <p className="text-[11px] text-[#5b6573] truncate">{label}</p>
      <p className={`text-sm font-bold mt-0.5 truncate ${toneClass}`}>{value}</p>
      <p className="text-[11px] text-[#5b6573] mt-0.5 truncate">{sub}</p>
    </button>
  );
}

function rankingsCard(summary: RankingsSummary): Omit<SummaryCardProps, 'onClick'> {
  if (summary.top10 > 0) {
    return {
      label: '검색 순위',
      value: `상위 10위권 ${summary.top10}편`,
      valueTone: 'good',
      sub: `추적 중 ${summary.total}편`,
    };
  }
  if (summary.total > 0) {
    return {
      label: '검색 순위',
      value: '상위권 진입 전',
      valueTone: 'neutral',
      sub: `추적 중 ${summary.total}편`,
    };
  }
  return {
    label: '검색 순위',
    value: '추적 글 없음',
    valueTone: 'neutral',
    sub: '발행하면 순위를 추적합니다',
  };
}

function geoCard(summary: GeoSummary): Omit<SummaryCardProps, 'onClick'> {
  if (summary.checked === 0) {
    return {
      label: 'AI 검색 인용',
      value: '체크 전',
      valueTone: 'neutral',
      sub: 'AI 검색 탭에서 확인',
    };
  }
  if (summary.cited > 0) {
    return {
      label: 'AI 검색 인용',
      value: `AI가 ${summary.cited}건 인용`,
      valueTone: 'good',
      sub: `최근 체크 ${summary.checked}건`,
    };
  }
  return {
    label: 'AI 검색 인용',
    value: '아직 인용 없음',
    valueTone: 'neutral',
    sub: `최근 체크 ${summary.checked}건`,
  };
}

function auditCard(summary: AuditSummary): Omit<SummaryCardProps, 'onClick'> {
  if (!summary.hasAudit) {
    return {
      label: '블로그 진단',
      value: '진단 전',
      valueTone: 'neutral',
      sub: '진단을 실행해보세요',
    };
  }
  if (summary.riskyPosts > 0) {
    return {
      label: '블로그 진단',
      value: `위험 글 ${summary.riskyPosts}편`,
      valueTone: 'warn',
      sub: `최근 진단 ${summary.totalPosts}편 검사`,
    };
  }
  return {
    label: '블로그 진단',
    value: '위험 글 없음',
    valueTone: 'good',
    sub: `최근 진단 ${summary.totalPosts}편 검사`,
  };
}

interface PerformanceSummaryStripProps {
  /** 카드 클릭 시 해당 서브탭으로 이동 */
  onNavigate: (tab: MyPageTabId) => void;
}

export default function PerformanceSummaryStrip({ onNavigate }: PerformanceSummaryStripProps) {
  const [data, setData] = useState<StripData | null>(null);

  // 그룹 진입 시 1회만 조회 — 서브탭 전환에는 재조회하지 않는다(컴포넌트 유지).
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchRankingsSummary(), fetchGeoSummary(), fetchAuditSummary()]).then(
      ([rankings, geo, audit]) => {
        if (!cancelled) setData({ rankings, geo, audit });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // 로딩 중이거나 전부 실패하면 스트립 자체를 조용히 숨긴다.
  if (!data) return null;
  if (!data.rankings && !data.geo && !data.audit) return null;

  return (
    <div className="grid grid-cols-3 gap-2 mt-3">
      {data.rankings && (
        <SummaryCard {...rankingsCard(data.rankings)} onClick={() => onNavigate('rankings')} />
      )}
      {data.geo && <SummaryCard {...geoCard(data.geo)} onClick={() => onNavigate('geo')} />}
      {data.audit && (
        <SummaryCard {...auditCard(data.audit)} onClick={() => onNavigate('audit')} />
      )}
    </div>
  );
}
