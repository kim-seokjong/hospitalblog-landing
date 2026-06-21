'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConversionRow } from '@/content/lib/clinicflix-usage';
import type { ClinicflixJobView } from '@/content/lib/clinicflix-client';
import {
  DownloadLink,
  ImageCarousel,
  Section,
  TextSection,
  isPlayableUrl,
} from '@/content/components/multichannel-views';

const STATUS_LABELS: Record<string, string> = {
  planning: '기획 중',
  planned: '기획 완료',
  rendering: '생성 중',
  review: '생성 완료',
  failed: '실패',
};

function statusLabel(status: string | null): string {
  if (!status) return '-';
  return STATUS_LABELS[status] ?? status;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(/\. /g, '.').replace(/\.$/, '');
}

// ── 결과 인라인 확장 ────────────────────────────────────────────────
function JobResult({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<ClinicflixJobView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    fetch(`/api/clinicflix/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('조회 실패');
        return res.json() as Promise<ClinicflixJobView>;
      })
      .then((data) => {
        if (active) setJob(data);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [jobId]);

  if (loading) {
    return <div className="py-4 text-center text-[#5b6573] text-xs">결과를 불러오는 중...</div>;
  }

  const shortsPath = job?.assets?.shorts_video_path;
  const cardnewsUrls = job?.assets?.cardnews_image_urls ?? [];
  const storyUrls = job?.assets?.story_image_urls ?? [];
  const hasVideo = isPlayableUrl(shortsPath);
  const hasThreads = job?.plan?.threads != null;
  const hasFeed = job?.plan?.feed != null;
  const hasAny = hasVideo || cardnewsUrls.length > 0 || storyUrls.length > 0 || hasThreads || hasFeed;

  if (failed || !job || !hasAny) {
    return (
      <div className="rounded-xl border border-[#b4bfce] bg-[#eef2f6] px-4 py-3 text-sm text-[#5b6573]">
        결과가 만료되었어요. 생성 시 다운로드해 주세요.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {hasVideo && (
        <Section title="🎬 쇼츠 영상">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={shortsPath} controls className="w-full rounded-xl border border-[#e2e8ef] bg-black" />
          <DownloadLink href={shortsPath} label="영상 저장" />
        </Section>
      )}
      {cardnewsUrls.length > 0 && (
        <Section title="🖼️ 카드뉴스">
          <ImageCarousel urls={cardnewsUrls} />
        </Section>
      )}
      {storyUrls.length > 0 && (
        <Section title="📱 스토리">
          <ImageCarousel urls={storyUrls} />
        </Section>
      )}
      <TextSection kind="threads" title="🧵 쓰레드" value={job.plan?.threads} />
      <TextSection kind="feed" title="📰 인스타 피드" value={job.plan?.feed} />
    </div>
  );
}

// ── 행 카드 ─────────────────────────────────────────────────────────
function ConversionCard({ row }: { row: ConversionRow }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white border border-[#b4bfce] rounded-xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-[#202020]">{formatDate(row.created_at)}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-[#eef2f6] text-[#5b6573] border border-[#b4bfce] font-medium">
          {statusLabel(row.status)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {row.consume_video && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-[#ffece7] text-[#ff4628] border border-[#ff4628]/40 font-medium">
            영상
          </span>
        )}
        {row.consume_channel && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-[#ffece7] text-[#ff4628] border border-[#ff4628]/40 font-medium">
            멀티채널 세트
          </span>
        )}
      </div>

      {row.job_id && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-[#73808f] hover:text-[#ff4628] underline underline-offset-2 transition-colors"
        >
          {open ? '결과 닫기' : '결과 보기'}
        </button>
      )}

      {open && row.job_id && <JobResult jobId={row.job_id} />}
    </div>
  );
}

/**
 * 마이페이지 — 변환 내역 탭 (멀티채널 변환 기록).
 * 과거 결과물 재조회는 best-effort: Railway 잡 만료 시 graceful 안내.
 */
export default function ConversionHistoryTab() {
  const [rows, setRows] = useState<ConversionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/clinicflix/conversions');
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? '변환 내역을 불러오지 못했습니다.');
      }
      const json = (await res.json()) as { conversions: ConversionRow[] };
      setRows(json.conversions);
    } catch (e) {
      setError(e instanceof Error ? e.message : '변환 내역을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  if (loading) {
    return <div className="py-16 text-center text-[#5b6573] text-sm">변환 내역을 불러오는 중...</div>;
  }

  if (error || !rows) {
    return (
      <div className="py-16 text-center">
        <p className="text-red-600 text-sm mb-4">{error ?? '변환 내역을 불러오지 못했습니다.'}</p>
        <button
          type="button"
          onClick={() => void fetchRows()}
          className="px-4 py-2 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-lg transition-colors"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-[#5b6573] text-sm mb-4">아직 변환 내역이 없습니다.</p>
        <a
          href="/app"
          className="inline-block px-4 py-2 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-lg transition-colors"
        >
          블로그에서 멀티채널 생성하기
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <ConversionCard key={row.conversion_id} row={row} />
      ))}
    </div>
  );
}
