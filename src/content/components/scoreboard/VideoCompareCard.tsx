'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * ② 유튜브 경쟁 채널 비교 (YouTube Data API v3).
 * - 독립 로딩·독립 실패 (다른 섹션에 영향 없음).
 * - 서버 키 미설정(501) 시 설정 안내만 표시 (페이지 안 깨짐).
 */

interface ChannelStats {
  channelId: string;
  title: string;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  viewCount: number | null;
  uploadsIn30Days: number | null;
  uploadsPerWeek: number | null;
}

interface Props {
  query: string;
  runId: number;
}

function formatNum(n: number | null): string {
  if (n === null) return '비공개';
  return n.toLocaleString('ko-KR');
}

export default function VideoCompareCard({ query, runId }: Props) {
  const [loading, setLoading] = useState(false);
  const [channels, setChannels] = useState<ChannelStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configRequired, setConfigRequired] = useState(false);

  const load = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setConfigRequired(false);
    try {
      const res = await fetch('/api/competitor-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = (await res.json()) as { channels?: ChannelStats[]; error?: string; configRequired?: boolean };
      if (res.status === 501 && data.configRequired) {
        setConfigRequired(true);
        return;
      }
      if (!res.ok) {
        throw new Error(data.error ?? '유튜브 채널 조회에 실패했습니다.');
      }
      setChannels(data.channels ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '유튜브 채널 조회에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (runId > 0) void load();
  }, [runId, load]);

  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-5 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-lg bg-[#ffece7] flex items-center justify-center flex-shrink-0">
          <span className="text-sm">📺</span>
        </div>
        <h3 className="text-sm font-bold text-[#202020]">유튜브 경쟁 채널</h3>
      </div>
      <p className="text-[11px] text-[#73808f] mb-4">
        &ldquo;{query}&rdquo; 검색 상위 채널 · 공개 통계 수치만 표시합니다
      </p>

      {configRequired ? (
        <div className="bg-[#eef2f6] border border-[#b4bfce] rounded-xl px-4 py-5 text-center">
          <p className="text-xs font-semibold text-[#5b6573] mb-1">유튜브 비교는 준비 중입니다</p>
          <p className="text-[11px] text-[#73808f]">관리자 키(YOUTUBE_API_KEY) 설정 후 이용할 수 있습니다.</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <span className="w-4 h-4 border-2 border-[#ff4628] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-[#5b6573]">유튜브 채널 조회 중...</span>
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
      ) : channels && channels.length > 0 ? (
        <ul className="space-y-2">
          {channels.map((ch) => (
            <li key={ch.channelId} className="bg-[#eef2f6] rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                {ch.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ch.thumbnailUrl}
                    alt=""
                    className="w-7 h-7 rounded-full flex-shrink-0 border border-[#b4bfce]"
                  />
                )}
                <a
                  href={`https://www.youtube.com/channel/${ch.channelId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-[#202020] hover:text-[#ff4628] transition-colors truncate min-h-[44px] flex items-center flex-1 min-w-0"
                >
                  {ch.title}
                </a>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-semibold text-[#5b6573] bg-white border border-[#b4bfce] px-2 py-0.5 rounded-full">
                  구독자 {formatNum(ch.subscriberCount)}
                </span>
                <span className="text-[10px] font-semibold text-[#5b6573] bg-white border border-[#b4bfce] px-2 py-0.5 rounded-full">
                  영상 {formatNum(ch.videoCount)}개
                </span>
                <span className="text-[10px] font-semibold text-[#5b6573] bg-white border border-[#b4bfce] px-2 py-0.5 rounded-full">
                  총조회 {formatNum(ch.viewCount)}
                </span>
                {ch.uploadsPerWeek !== null && (
                  <span className="text-[10px] font-semibold text-[#5b6573] bg-white border border-[#b4bfce] px-2 py-0.5 rounded-full">
                    최근 30일 주 {ch.uploadsPerWeek}회 업로드
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : channels ? (
        <p className="text-xs text-[#73808f] bg-[#eef2f6] rounded-xl px-4 py-5 text-center">
          검색된 채널이 없습니다.
        </p>
      ) : null}
    </div>
  );
}
