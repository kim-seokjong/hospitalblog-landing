'use client';

import { useCallback, useState } from 'react';

/**
 * ④ 인스타/쓰레드 공개 지표 (베스트에포트).
 * 회원이 경쟁 병원 핸들을 직접 입력 (최대 5개).
 * 실패 항목은 "확인 불가"로 표시 — 다른 항목·섹션에 영향 없음.
 */

type Platform = 'instagram' | 'threads';

interface HandleRow {
  platform: Platform;
  handle: string;
}

interface SocialMetric {
  platform: Platform;
  handle: string;
  status: 'ok' | 'unavailable';
  followers: number | null;
  posts: number | null;
}

const MAX_HANDLES = 5;
const HANDLE_RE = /^@?[A-Za-z0-9._]{1,30}$/;

const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: '인스타그램',
  threads: '쓰레드',
};

export default function SocialCompareCard() {
  const [rows, setRows] = useState<HandleRow[]>([{ platform: 'instagram', handle: '' }]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SocialMetric[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateRow = useCallback((index: number, patch: Partial<HandleRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) =>
      prev.length >= MAX_HANDLES ? prev : [...prev, { platform: 'instagram', handle: '' }]
    );
  }, []);

  const removeRow = useCallback((index: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }, []);

  const lookup = useCallback(async () => {
    const filled = rows.filter((r) => r.handle.trim().length > 0);
    if (filled.length === 0) {
      setError('핸들을 1개 이상 입력해주세요.');
      return;
    }
    const invalid = filled.find((r) => !HANDLE_RE.test(r.handle.trim()));
    if (invalid) {
      setError(`잘못된 핸들 형식입니다: ${invalid.handle} (영문·숫자·밑줄·마침표만)`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/competitor-social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handles: filled.map((r) => ({ platform: r.platform, handle: r.handle.trim() })),
        }),
      });
      const data = (await res.json()) as { results?: SocialMetric[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? '소셜 지표 조회에 실패했습니다.');
      }
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '소셜 지표 조회에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [rows]);

  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-5 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-lg bg-[#ffece7] flex items-center justify-center flex-shrink-0">
          <span className="text-sm">📱</span>
        </div>
        <h3 className="text-sm font-bold text-[#202020]">인스타 · 쓰레드 공개 지표</h3>
      </div>
      <p className="text-[11px] text-[#73808f] mb-4">
        경쟁 병원 계정 핸들을 입력하면 공개 프로필의 팔로워·게시물 수를 확인합니다 (최대 {MAX_HANDLES}개)
      </p>

      {/* 핸들 입력 */}
      <div className="space-y-2 mb-3">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={row.platform}
              onChange={(e) => updateRow(i, { platform: e.target.value as Platform })}
              className="bg-white border border-[#b4bfce] text-[#202020] text-xs rounded-xl px-2.5 py-3 min-h-[44px] focus:outline-none focus:border-[#ff4628] transition-colors appearance-none flex-shrink-0"
              aria-label="플랫폼 선택"
            >
              <option value="instagram">인스타그램</option>
              <option value="threads">쓰레드</option>
            </select>
            <input
              type="text"
              value={row.handle}
              onChange={(e) => updateRow(i, { handle: e.target.value })}
              placeholder="@핸들 (예: hospital_official)"
              className="flex-1 min-w-0 bg-white border border-[#b4bfce] text-[#202020] text-sm rounded-xl px-3 py-3 min-h-[44px] focus:outline-none focus:border-[#ff4628] placeholder-[#73808f] transition-colors"
              onKeyDown={(e) => { if (e.key === 'Enter') void lookup(); }}
            />
            {rows.length > 1 && (
              <button
                onClick={() => removeRow(i)}
                className="text-[#73808f] hover:text-red-600 text-lg min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0 transition-colors"
                aria-label="핸들 삭제"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {rows.length < MAX_HANDLES && (
          <button
            onClick={addRow}
            className="px-3 py-2.5 min-h-[44px] border border-[#b4bfce] hover:border-[#ff4628]/50 text-[#4a4f55] hover:text-[#202020] text-xs font-semibold rounded-xl transition-colors"
          >
            + 핸들 추가
          </button>
        )}
        <button
          onClick={() => void lookup()}
          disabled={loading}
          className="px-5 py-2.5 min-h-[44px] bg-[#ff4628] hover:bg-[#e63a1c] active:bg-[#e63a1c] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-colors"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              조회 중...
            </span>
          ) : (
            '지표 조회'
          )}
        </button>
      </div>

      {error && (
        <div className="mb-3 bg-yellow-50 border border-yellow-500/30 rounded-xl px-4 py-2.5">
          <p className="text-xs text-yellow-700">{error}</p>
        </div>
      )}

      {results && (
        <ul className="space-y-2">
          {results.map((r, i) => (
            <li
              key={`${r.platform}-${r.handle}-${i}`}
              className="flex items-center gap-3 bg-[#eef2f6] rounded-xl px-4 py-3 min-h-[44px] flex-wrap"
            >
              <span className="text-[10px] font-semibold text-[#5b6573] bg-white border border-[#b4bfce] px-2 py-0.5 rounded-full flex-shrink-0">
                {PLATFORM_LABEL[r.platform]}
              </span>
              <span className="flex-1 min-w-0 text-sm font-semibold text-[#202020] truncate">
                @{r.handle}
              </span>
              {r.status === 'ok' ? (
                <span className="text-xs text-[#5b6573] flex-shrink-0">
                  {r.followers !== null && <>팔로워 {r.followers.toLocaleString('ko-KR')}</>}
                  {r.followers !== null && r.posts !== null && ' · '}
                  {r.posts !== null && <>게시물 {r.posts.toLocaleString('ko-KR')}</>}
                </span>
              ) : (
                <span className="text-[11px] text-[#73808f] flex-shrink-0">
                  일시 확인 불가 (비공개 또는 접근 제한)
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
