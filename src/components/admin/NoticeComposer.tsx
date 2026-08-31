'use client';

import { useMemo, useState } from 'react';
import type { MemberRow } from '@/types/admin';

interface NoticeComposerProps {
  members: MemberRow[];
}

type TargetMode = 'all' | 'individual';

const MAX_TITLE_LEN = 100;
const MAX_MESSAGE_LEN = 1000;
const SEARCH_RESULT_LIMIT = 8;

function memberLabel(m: MemberRow): string {
  const hospital = m.hospital_name || '병원명 없음';
  const name = m.full_name || '담당자 없음';
  return `${hospital} · ${name}`;
}

export default function NoticeComposer({ members }: NoticeComposerProps) {
  const [mode, setMode] = useState<TargetMode>('all');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MemberRow | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return members
      .filter((m) => {
        const haystack = [
          m.email ?? '',
          m.full_name ?? '',
          m.hospital_name ?? '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, SEARCH_RESULT_LIMIT);
  }, [members, search]);

  const canSubmit =
    title.trim().length > 0 &&
    message.trim().length > 0 &&
    (mode === 'all' || selected !== null) &&
    !submitting;

  const handleSelect = (m: MemberRow) => {
    setSelected(m);
    setSearch('');
  };

  const handleSubmit = async () => {
    setError(null);
    setResult(null);

    if (mode === 'individual' && !selected) {
      setError('대상 회원을 선택하세요.');
      return;
    }

    const target = mode === 'all' ? 'all' : selected!.id;
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/notices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          target,
        }),
      });
      const data = (await res.json()) as { delivered?: number; error?: string };
      if (!res.ok) {
        setError(data.error ?? '공지 발송에 실패했습니다.');
        return;
      }
      setResult(
        mode === 'all'
          ? `전체 공지가 발송되었습니다. (${data.delivered ?? 0}명 전달)`
          : `${memberLabel(selected!)} 님에게 공지가 발송되었습니다.`
      );
      setTitle('');
      setMessage('');
      setSelected(null);
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 bg-white border border-[#b4bfce] rounded text-sm text-[#202020] placeholder-[#5b6573] focus:outline-none focus:border-[#ff4628]';

  return (
    <div className="bg-white border border-[#b4bfce] rounded-xl overflow-hidden shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="p-4 border-b border-[#b4bfce]">
        <h3 className="text-sm font-semibold text-[#202020]">공지 발송</h3>
        <p className="text-xs text-[#5b6573] mt-0.5">
          회원에게 알림(공지)을 발송합니다. 회원은 알림 벨에서 확인합니다.
        </p>
      </div>

      <div className="p-4 space-y-4">
        {/* 대상 선택 */}
        <div>
          <p className="text-xs font-semibold text-[#4a4f55] mb-2">전송 대상</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('all')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                mode === 'all'
                  ? 'bg-[#ff4628] text-white'
                  : 'bg-[#eef2f6] text-[#4a4f55] hover:bg-[#b4bfce]'
              }`}
            >
              전체 회원
            </button>
            <button
              type="button"
              onClick={() => setMode('individual')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                mode === 'individual'
                  ? 'bg-[#ff4628] text-white'
                  : 'bg-[#eef2f6] text-[#4a4f55] hover:bg-[#b4bfce]'
              }`}
            >
              특정 회원
            </button>
          </div>
        </div>

        {/* 개별 회원 검색/선택 */}
        {mode === 'individual' && (
          <div>
            <p className="text-xs font-semibold text-[#4a4f55] mb-2">
              대상 회원
            </p>
            {selected ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#eef2f6] border border-[#b4bfce] rounded">
                <div className="min-w-0">
                  <p className="text-sm text-[#202020] truncate">
                    {memberLabel(selected)}
                  </p>
                  <p className="text-xs text-[#5b6573] truncate">
                    {selected.email ?? '-'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-xs text-[#ff4628] hover:text-[#e63a1c] font-medium flex-shrink-0"
                >
                  변경
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="이름·이메일·병원명 검색"
                  className={inputClass}
                />
                {searchResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-[#b4bfce] rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {searchResults.map((m) => (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => handleSelect(m)}
                        className="w-full text-left px-3 py-2 hover:bg-[#eef2f6] border-b border-[#eef2f6] last:border-b-0"
                      >
                        <p className="text-sm text-[#202020] truncate">
                          {memberLabel(m)}
                        </p>
                        <p className="text-xs text-[#5b6573] truncate">
                          {m.email ?? '-'}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
                {search.trim() && searchResults.length === 0 && (
                  <p className="mt-1 text-xs text-[#5b6573]">검색 결과 없음</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* 제목 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-[#4a4f55]">제목</label>
            <span className="text-[10px] text-[#5b6573]">
              {title.length}/{MAX_TITLE_LEN}
            </span>
          </div>
          <input
            type="text"
            value={title}
            maxLength={MAX_TITLE_LEN}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="공지 제목"
            className={inputClass}
          />
        </div>

        {/* 내용 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-[#4a4f55]">내용</label>
            <span className="text-[10px] text-[#5b6573]">
              {message.length}/{MAX_MESSAGE_LEN}
            </span>
          </div>
          <textarea
            value={message}
            maxLength={MAX_MESSAGE_LEN}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="회원에게 전달할 공지 내용을 입력하세요."
            rows={4}
            className={`${inputClass} resize-y min-h-[96px]`}
          />
        </div>

        {/* 발송 */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 bg-[#ff4628] hover:bg-[#e63a1c] disabled:bg-[#eef2f6] disabled:text-[#5b6573] text-white text-sm font-bold rounded transition-colors"
          >
            {submitting
              ? '발송 중...'
              : mode === 'all'
                ? '전체 회원에게 발송'
                : '발송'}
          </button>
          {result && <p className="text-xs text-emerald-600">✓ {result}</p>}
          {error && <p className="text-xs text-rose-600">✕ {error}</p>}
        </div>
      </div>
    </div>
  );
}
