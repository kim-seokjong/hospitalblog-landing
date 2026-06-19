'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/dev/lib/supabase/client';
import type { SavedPost } from '@/types';

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay(); // 0=일
}

function toDateKey(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function parseLocalDate(iso: string): { year: number; month: number; day: number } | null {
  if (!iso) return null;
  const [datePart] = iso.split('T');
  const parts = datePart.split('-');
  if (parts.length < 3) return null;
  return {
    year: parseInt(parts[0], 10),
    month: parseInt(parts[1], 10) - 1,
    day: parseInt(parts[2], 10),
  };
}

function formatScheduledDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ─── Types ────────────────────────────────────────────────────────────────────

type FetchState = 'loading' | 'ready' | 'error';
type ModalMode = 'schedule' | 'manage';

interface ScheduleModalProps {
  mode: ModalMode;
  dateKey: string;
  post?: SavedPost;
  draftPosts: SavedPost[];
  onClose: () => void;
  onSchedule: (postId: string, dateKey: string) => Promise<void>;
  onCancel: (postId: string) => Promise<void>;
  onPublish: (postId: string) => Promise<void>;
  isSaving: boolean;
}

// ─── Modal component ──────────────────────────────────────────────────────────

function ScheduleModal({
  mode,
  dateKey,
  post,
  draftPosts,
  onClose,
  onSchedule,
  onCancel,
  onPublish,
  isSaving,
}: ScheduleModalProps) {
  const [selectedPostId, setSelectedPostId] = useState('');
  const [confirmAction, setConfirmAction] = useState<'cancel' | 'publish' | null>(null);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleScheduleSubmit = async () => {
    if (!selectedPostId) return;
    await onSchedule(selectedPostId, dateKey);
  };

  const handleAction = async () => {
    if (!post) return;
    if (confirmAction === 'cancel') await onCancel(post.id);
    else if (confirmAction === 'publish') await onPublish(post.id);
  };

  const [year, monthStr, dayStr] = dateKey.split('-');
  const displayDate = `${year}년 ${parseInt(monthStr, 10)}월 ${parseInt(dayStr, 10)}일`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm bg-white border border-[#b4bfce] rounded-2xl shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)] p-5">
        {mode === 'schedule' && (
          <>
            <h2 className="text-[#202020] font-bold text-base mb-1">예약 발행 설정</h2>
            <p className="text-sm text-[#5b6573] mb-4">{displayDate}</p>

            {draftPosts.length === 0 ? (
              <p className="text-sm text-[#5b6573] py-4 text-center">예약할 수 있는 임시저장 글이 없습니다.</p>
            ) : (
              <>
                <label className="block text-xs text-[#5b6573] mb-1.5" htmlFor="post-select">
                  글 선택
                </label>
                <select
                  id="post-select"
                  value={selectedPostId}
                  onChange={(e) => setSelectedPostId(e.target.value)}
                  className="w-full bg-white border border-[#b4bfce] rounded-xl text-[#202020] text-sm px-3 py-2.5 focus:outline-none focus:border-[#ff4628]/60 appearance-none"
                >
                  <option value="" className="bg-white">— 글을 선택하세요 —</option>
                  {draftPosts.map((p) => (
                    <option key={p.id} value={p.id} className="bg-white">
                      {p.title.length > 40 ? p.title.slice(0, 40) + '…' : p.title}
                    </option>
                  ))}
                </select>
              </>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-xl border border-[#b4bfce] text-sm text-[#5b6573] hover:bg-[#eef2f6] transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleScheduleSubmit}
                disabled={!selectedPostId || isSaving}
                className="flex-1 py-2 rounded-xl bg-[#ff4628] hover:bg-[#e63a1c] disabled:bg-[#ff4628]/40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
              >
                {isSaving ? '저장 중...' : '예약 설정'}
              </button>
            </div>
          </>
        )}

        {mode === 'manage' && post && (
          <>
            <h2 className="text-[#202020] font-bold text-base mb-1 line-clamp-2">{post.title}</h2>
            <p className="text-xs text-amber-600 mb-4">
              {post.scheduled_at ? formatScheduledDate(post.scheduled_at) : displayDate} 예약됨
            </p>

            {!confirmAction ? (
              <>
                <p className="text-sm text-[#4a4f55] mb-4">이 예약 글을 어떻게 처리할까요?</p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setConfirmAction('publish')}
                    className="py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors"
                  >
                    발행 완료로 변경
                  </button>
                  <button
                    onClick={() => setConfirmAction('cancel')}
                    className="py-2.5 rounded-xl bg-red-600/80 hover:bg-red-500/80 text-white text-sm font-semibold transition-colors"
                  >
                    예약 취소 (임시저장으로)
                  </button>
                  <button
                    onClick={onClose}
                    className="py-2 rounded-xl border border-[#b4bfce] text-sm text-[#5b6573] hover:bg-[#eef2f6] transition-colors"
                  >
                    닫기
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-[#4a4f55] mb-4">
                  {confirmAction === 'cancel'
                    ? '예약을 취소하고 임시저장 상태로 변경하시겠습니까?'
                    : '발행 완료 상태로 변경하시겠습니까?'}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmAction(null)}
                    className="flex-1 py-2 rounded-xl border border-[#b4bfce] text-sm text-[#5b6573] hover:bg-[#eef2f6] transition-colors"
                  >
                    뒤로
                  </button>
                  <button
                    onClick={handleAction}
                    disabled={isSaving}
                    className={`flex-1 py-2 rounded-xl text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      confirmAction === 'cancel'
                        ? 'bg-red-600/80 hover:bg-red-500/80'
                        : 'bg-emerald-600 hover:bg-emerald-500'
                    }`}
                  >
                    {isSaving ? '처리 중...' : '확인'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Calendar grid ────────────────────────────────────────────────────────────

interface CalendarGridProps {
  year: number;
  month: number;
  scheduledByDate: Map<string, SavedPost[]>;
  today: string;
  onDayClick: (dateKey: string, posts: SavedPost[]) => void;
}

function CalendarGrid({ year, month, scheduledByDate, today, onDayClick }: CalendarGridProps) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDow = getFirstDayOfWeek(year, month);

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Pad to full weeks
  const remainder = cells.length % 7;
  if (remainder !== 0) {
    cells.push(...Array(7 - remainder).fill(null));
  }

  return (
    <div className="rounded-2xl border border-[#b4bfce] overflow-hidden bg-white">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 bg-[#eef2f6]">
        {WEEKDAYS.map((wd, i) => (
          <div
            key={wd}
            className={`py-2 text-center text-xs font-semibold tracking-wide ${
              i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-[#5b6573]'
            }`}
          >
            {wd}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 divide-x divide-y divide-[#b4bfce]">
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} className="min-h-[72px] sm:min-h-[90px] bg-[#f6f8fa]" />;
          }

          const dateKey = toDateKey(year, month, day);
          const dayPosts = scheduledByDate.get(dateKey) ?? [];
          const isToday = dateKey === today;
          const dow = (firstDow + day - 1) % 7;

          return (
            <button
              key={dateKey}
              onClick={() => onDayClick(dateKey, dayPosts)}
              className={`min-h-[72px] sm:min-h-[90px] p-1.5 sm:p-2 text-left align-top transition-colors hover:bg-[#eef2f6] focus:outline-none focus:ring-1 focus:ring-[#ff4628]/50 ${
                dayPosts.length > 0 ? 'bg-[#f6f8fa]' : ''
              }`}
              aria-label={`${dateKey}${dayPosts.length > 0 ? ` — 예약 ${dayPosts.length}건` : ''}`}
            >
              <span
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium mb-1 ${
                  isToday
                    ? 'bg-[#ff4628] text-white'
                    : dow === 0
                    ? 'text-red-500'
                    : dow === 6
                    ? 'text-blue-500'
                    : 'text-[#202020]'
                }`}
              >
                {day}
              </span>
              <div className="space-y-0.5">
                {dayPosts.slice(0, 3).map((p) => (
                  <div key={p.id} className="flex items-center gap-1 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                    <span className="text-[10px] sm:text-xs text-emerald-700 truncate leading-tight">
                      {p.title}
                    </span>
                  </div>
                ))}
                {dayPosts.length > 3 && (
                  <span className="text-[10px] text-[#5b6573]">+{dayPosts.length - 3}건</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Scheduled list ───────────────────────────────────────────────────────────

interface ScheduledListProps {
  posts: SavedPost[];
  onItemClick: (post: SavedPost) => void;
}

function ScheduledList({ posts, onItemClick }: ScheduledListProps) {
  if (posts.length === 0) {
    return (
      <div className="text-center py-10 text-[#5b6573] text-sm">
        이번 달 예약된 글이 없습니다.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {posts.map((p) => (
        <li key={p.id}>
          <button
            onClick={() => onItemClick(p)}
            className="w-full text-left bg-white border border-[#b4bfce] rounded-xl px-4 py-3 hover:border-amber-500/30 hover:bg-[#eef2f6] transition-all"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="text-xs text-amber-600 font-medium flex-shrink-0">
                {p.scheduled_at ? formatScheduledDate(p.scheduled_at) : '날짜 미정'}
              </span>
              <span className="text-[10px] text-[#5b6573] flex-shrink-0">예약됨</span>
            </div>
            <p className="text-sm text-[#202020] font-medium line-clamp-1">{p.title}</p>
            {p.keyword && (
              <span className="text-xs text-[#ff4628] mt-0.5 block">#{p.keyword}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── Mobile list view ─────────────────────────────────────────────────────────

interface MobileListViewProps {
  posts: SavedPost[];
  onItemClick: (post: SavedPost) => void;
}

function MobileListView({ posts, onItemClick }: MobileListViewProps) {
  if (posts.length === 0) {
    return (
      <div className="text-center py-16 text-[#5b6573] text-sm">
        이번 달 예약된 글이 없습니다.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {posts.map((p) => (
        <li key={p.id}>
          <button
            onClick={() => onItemClick(p)}
            className="w-full text-left bg-white border border-[#b4bfce] rounded-xl px-4 py-3.5 hover:border-amber-500/30 transition-all"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
              <span className="text-xs text-amber-600 font-medium">
                {p.scheduled_at ? formatScheduledDate(p.scheduled_at) : '날짜 미정'}
              </span>
            </div>
            <p className="text-sm text-[#202020] font-medium line-clamp-2 pl-4">{p.title}</p>
            {p.keyword && (
              <span className="text-xs text-[#ff4628] mt-0.5 block pl-4">#{p.keyword}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const todayDate = useMemo(() => {
    const now = new Date();
    return toDateKey(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const [authChecked, setAuthChecked] = useState(false);
  const [scheduledPosts, setScheduledPosts] = useState<SavedPost[]>([]);
  const [draftPosts, setDraftPosts] = useState<SavedPost[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [fetchError, setFetchError] = useState('');

  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const [modal, setModal] = useState<{
    mode: ModalMode;
    dateKey: string;
    post?: SavedPost;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Auth check
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push('/');
        return;
      }
      setAuthChecked(true);
    });
  }, [supabase, router]);

  // Load posts
  const loadPosts = useCallback(async () => {
    setFetchState('loading');
    setFetchError('');
    try {
      const [scheduledRes, draftRes] = await Promise.all([
        fetch('/api/posts?status=scheduled'),
        fetch('/api/posts?status=draft'),
      ]);

      if (!scheduledRes.ok) {
        const json = await scheduledRes.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '예약 글을 불러오지 못했습니다.');
      }
      if (!draftRes.ok) {
        const json = await draftRes.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '임시저장 글을 불러오지 못했습니다.');
      }

      const scheduledJson = await scheduledRes.json() as { posts: SavedPost[] };
      const draftJson = await draftRes.json() as { posts: SavedPost[] };

      setScheduledPosts(scheduledJson.posts ?? []);
      setDraftPosts(draftJson.posts ?? []);
      setFetchState('ready');
    } catch (err) {
      const message = err instanceof Error ? err.message : '목록을 불러오지 못했습니다.';
      setFetchError(message);
      setFetchState('error');
    }
  }, []);

  useEffect(() => {
    if (authChecked) loadPosts();
  }, [authChecked, loadPosts]);

  // Build date map for current view month
  const scheduledByDate = useMemo<Map<string, SavedPost[]>>(() => {
    const map = new Map<string, SavedPost[]>();
    for (const post of scheduledPosts) {
      if (!post.scheduled_at) continue;
      const parsed = parseLocalDate(post.scheduled_at);
      if (!parsed) continue;
      const key = toDateKey(parsed.year, parsed.month, parsed.day);
      const existing = map.get(key) ?? [];
      map.set(key, [...existing, post]);
    }
    return map;
  }, [scheduledPosts]);

  // Posts for current month list
  const monthlyPosts = useMemo(() => {
    return scheduledPosts
      .filter((p) => {
        if (!p.scheduled_at) return false;
        const parsed = parseLocalDate(p.scheduled_at);
        return parsed && parsed.year === viewYear && parsed.month === viewMonth;
      })
      .sort((a, b) => {
        const da = a.scheduled_at ?? '';
        const db = b.scheduled_at ?? '';
        return da.localeCompare(db);
      });
  }, [scheduledPosts, viewYear, viewMonth]);

  // Navigation
  const prevMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, []);

  const goToday = useCallback(() => {
    const n = new Date();
    setViewYear(n.getFullYear());
    setViewMonth(n.getMonth());
  }, []);

  // Day click handler
  const handleDayClick = useCallback((dateKey: string, posts: SavedPost[]) => {
    if (posts.length > 0) {
      setModal({ mode: 'manage', dateKey, post: posts[0] });
    } else {
      setModal({ mode: 'schedule', dateKey });
    }
  }, []);

  // Schedule a post
  const handleSchedule = useCallback(async (postId: string, dateKey: string) => {
    setIsSaving(true);
    try {
      const scheduledAt = `${dateKey}T09:00:00.000Z`;
      const res = await fetch('/api/posts/schedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: postId, scheduled_at: scheduledAt }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '예약 설정에 실패했습니다.');
      }

      const json = await res.json() as { post: SavedPost };
      const updated = json.post;

      setScheduledPosts((prev) => [...prev, updated]);
      setDraftPosts((prev) => prev.filter((p) => p.id !== postId));
      setModal(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : '예약 설정에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Cancel schedule → draft
  const handleCancelSchedule = useCallback(async (postId: string) => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/posts/schedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: postId, scheduled_at: null }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '예약 취소에 실패했습니다.');
      }

      const json = await res.json() as { post: SavedPost };
      const updated = json.post;

      setScheduledPosts((prev) => prev.filter((p) => p.id !== postId));
      setDraftPosts((prev) => [updated, ...prev]);
      setModal(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : '예약 취소에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Mark as published
  const handleMarkPublished = useCallback(async (postId: string) => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'published' }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '상태 변경에 실패했습니다.');
      }

      setScheduledPosts((prev) => prev.filter((p) => p.id !== postId));
      setModal(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : '상태 변경에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Manage click (from list)
  const handleListItemClick = useCallback((post: SavedPost) => {
    const dateKey = post.scheduled_at
      ? (() => {
          const parsed = parseLocalDate(post.scheduled_at);
          return parsed ? toDateKey(parsed.year, parsed.month, parsed.day) : toDateKey(viewYear, viewMonth, 1);
        })()
      : toDateKey(viewYear, viewMonth, 1);
    setModal({ mode: 'manage', dateKey, post });
  }, [viewYear, viewMonth]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#eef2f6] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#ff4628] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const titleLabel = `${viewYear}년 ${viewMonth + 1}월`;
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();

  return (
    <div className="min-h-screen bg-[#eef2f6] text-[#202020]">
      {/* Modal */}
      {modal && (
        <ScheduleModal
          mode={modal.mode}
          dateKey={modal.dateKey}
          post={modal.post}
          draftPosts={draftPosts}
          onClose={() => setModal(null)}
          onSchedule={handleSchedule}
          onCancel={handleCancelSchedule}
          onPublish={handleMarkPublished}
          isSaving={isSaving}
        />
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[#b4bfce] bg-white/90 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => router.push('/app')}
              className="text-[#5b6573] hover:text-[#202020] transition-colors flex-shrink-0"
              aria-label="앱으로 돌아가기"
            >
              ←
            </button>
            <h1 className="font-bold text-[#202020] text-base sm:text-lg truncate">예약 발행 캘린더</h1>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!isCurrentMonth && (
              <button
                onClick={goToday}
                className="text-xs text-[#ff4628] hover:text-[#e63a1c] border border-[#ff4628]/30 hover:bg-[#ffece7] px-2.5 py-1.5 rounded-lg transition-colors"
              >
                오늘
              </button>
            )}
            <button
              onClick={loadPosts}
              disabled={fetchState === 'loading'}
              className="text-xs text-[#5b6573] hover:text-[#202020] border border-[#b4bfce] hover:bg-[#eef2f6] px-2.5 py-1.5 rounded-lg transition-colors disabled:cursor-not-allowed"
              aria-label="새로고침"
            >
              새로고침
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Loading */}
        {fetchState === 'loading' && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-2 border-[#ff4628] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[#5b6573]">캘린더를 불러오는 중...</p>
          </div>
        )}

        {/* Error */}
        {fetchState === 'error' && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <p className="text-red-600 text-sm">{fetchError}</p>
            <button
              onClick={loadPosts}
              className="px-4 py-2 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-lg transition-colors"
            >
              다시 시도
            </button>
          </div>
        )}

        {fetchState === 'ready' && (
          <>
            {/* Month navigation */}
            <div className="flex items-center justify-between mb-5">
              <button
                onClick={prevMonth}
                className="p-2 rounded-xl border border-[#b4bfce] hover:bg-[#eef2f6] text-[#5b6573] hover:text-[#202020] transition-colors"
                aria-label="이전 달"
              >
                ‹
              </button>
              <h2 className="text-lg sm:text-xl font-bold text-[#202020]">{titleLabel}</h2>
              <button
                onClick={nextMonth}
                className="p-2 rounded-xl border border-[#b4bfce] hover:bg-[#eef2f6] text-[#5b6573] hover:text-[#202020] transition-colors"
                aria-label="다음 달"
              >
                ›
              </button>
            </div>

            {/* Desktop: calendar grid */}
            <div className="hidden sm:block mb-8">
              <CalendarGrid
                year={viewYear}
                month={viewMonth}
                scheduledByDate={scheduledByDate}
                today={todayDate}
                onDayClick={handleDayClick}
              />
            </div>

            {/* Mobile: list view instead of grid */}
            <div className="sm:hidden mb-8">
              <div className="bg-white border border-[#b4bfce] rounded-2xl p-4 mb-4">
                <p className="text-xs text-[#5b6573] mb-3">
                  이번 달 예약 글 {monthlyPosts.length}건 · 날짜를 탭해 예약을 관리하세요
                </p>
                <MobileListView posts={monthlyPosts} onItemClick={handleListItemClick} />
              </div>
              <button
                onClick={() => {
                  const n = new Date();
                  const key = toDateKey(viewYear, viewMonth, n.getDate());
                  handleDayClick(key, scheduledByDate.get(key) ?? []);
                }}
                className="w-full py-3 rounded-xl bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold transition-colors"
              >
                + 오늘 날짜에 예약 추가
              </button>
            </div>

            {/* Monthly scheduled list (desktop) */}
            <div className="hidden sm:block">
              <h3 className="text-sm font-semibold text-[#5b6573] mb-3">
                {titleLabel} 예약 목록
                {monthlyPosts.length > 0 && (
                  <span className="ml-2 text-amber-600">{monthlyPosts.length}건</span>
                )}
              </h3>
              <ScheduledList posts={monthlyPosts} onItemClick={handleListItemClick} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
