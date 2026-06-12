'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import PostEditor from '@/content/components/PostEditor';
import type { SavedPost } from '@/types';

type FetchState = 'loading' | 'ready' | 'error';
type StatusFilter = 'all' | SavedPost['status'];

const ARCHIVE_MONTHS = 6;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function statusBadge(status: SavedPost['status']): { text: string; className: string } {
  switch (status) {
    case 'published':
      return { text: '발행됨', className: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' };
    case 'scheduled':
      return { text: '예약됨', className: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' };
    default:
      return { text: '임시저장', className: 'bg-gray-500/20 text-gray-400 border border-gray-500/30' };
  }
}

function siteBadge(targetSite: SavedPost['target_site']): { text: string; className: string } {
  if (targetSite === 'google') {
    return { text: '구글', className: 'bg-blue-500/20 text-blue-300 border border-blue-500/30' };
  }
  return { text: '네이버', className: 'bg-green-500/20 text-green-300 border border-green-500/30' };
}

interface DetailModalProps {
  post: SavedPost;
  onClose: () => void;
  onEdit: (post: SavedPost) => void;
}

function DetailModal({ post, onClose, onEdit }: DetailModalProps) {
  const [copied, setCopied] = useState(false);
  const status = statusBadge(post.status);
  const site = siteBadge(post.target_site);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(post.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 권한이 없는 환경 폴백
      const textarea = document.createElement('textarea');
      textarea.value = post.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/80 flex items-start justify-center overflow-y-auto py-4 px-2 sm:px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      aria-modal="true"
      role="dialog"
      aria-label="콘텐츠 상세 보기"
    >
      <div className="relative w-full max-w-3xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col">
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-800">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${status.className}`}>{status.text}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${site.className}`}>{site.text}</span>
              {post.keyword && <span className="text-xs text-blue-400">#{post.keyword}</span>}
            </div>
            <h2 className="text-base sm:text-lg font-bold text-white leading-snug">{post.title}</h2>
            <p className="text-xs text-gray-500 mt-1">{formatDate(post.published_at ?? post.created_at)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/* 본문 전문 */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 max-h-[55vh]">
          <pre className="whitespace-pre-wrap break-words text-sm text-gray-200 leading-relaxed font-sans">
            {post.content}
          </pre>
        </div>

        {/* 푸터 */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center sm:justify-end gap-2 px-4 sm:px-6 py-4 border-t border-gray-800">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className={`px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
              copied
                ? 'bg-emerald-700 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {copied ? '복사됨 ✓' : '본문 복사'}
          </button>
          <button
            type="button"
            onClick={() => onEdit(post)}
            className="px-4 py-2.5 text-sm font-semibold text-gray-300 border border-gray-700 hover:bg-gray-800 rounded-lg transition-colors"
          >
            수정하기
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 마이페이지 — 콘텐츠 보관함 탭.
 * 기존 /history 페이지 기능 통합: 최근 6개월 목록 + 검색 + 상세(전문·복사) + 수정·삭제.
 * 목록은 기존 /api/posts 사용 (RLS + user_id 필터로 본인 글만).
 */
export default function ContentArchiveTab() {
  const [posts, setPosts] = useState<SavedPost[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [fetchError, setFetchError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [detailPost, setDetailPost] = useState<SavedPost | null>(null);
  const [editingPost, setEditingPost] = useState<SavedPost | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadPosts = useCallback(async () => {
    setFetchState('loading');
    setFetchError('');
    try {
      const res = await fetch('/api/posts');
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '목록을 불러오지 못했습니다.');
      }
      const json = await res.json() as { posts: SavedPost[] | null };
      setPosts(json.posts ?? []);
      setFetchState('ready');
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : '목록을 불러오지 못했습니다.');
      setFetchState('error');
    }
  }, []);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  // 최근 6개월 + 검색 + 상태 필터
  const filtered = useMemo(() => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - ARCHIVE_MONTHS);
    const q = search.trim().toLowerCase();

    return posts.filter((p) => {
      if (new Date(p.created_at) < cutoff) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      const inTitle = p.title.toLowerCase().includes(q);
      const inKeyword = (p.keyword ?? '').toLowerCase().includes(q);
      return inTitle || inKeyword;
    });
  }, [posts, search, statusFilter]);

  const handleEditSave = useCallback((updated: Partial<SavedPost>) => {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
    setDetailPost((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
    setEditingPost(null);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const confirmed = window.confirm('이 글을 삭제하시겠습니까? 삭제 후 복구할 수 없습니다.');
    if (!confirmed) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/posts/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '삭제에 실패했습니다.');
      }
      setPosts((prev) => prev.filter((p) => p.id !== id));
      setDetailPost((prev) => (prev && prev.id === id ? null : prev));
    } catch (err) {
      alert(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    } finally {
      setDeletingId(null);
    }
  }, []);

  return (
    <div>
      {/* 에디터 모달 (수정) */}
      {editingPost && (
        <PostEditor
          post={editingPost}
          onSave={handleEditSave}
          onClose={() => setEditingPost(null)}
        />
      )}

      {/* 상세 보기 모달 */}
      {detailPost && !editingPost && (
        <DetailModal
          post={detailPost}
          onClose={() => setDetailPost(null)}
          onEdit={(p) => setEditingPost(p)}
        />
      )}

      {/* 검색 + 필터 */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="제목·키워드 검색"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
          aria-label="제목 또는 키워드 검색"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors appearance-none sm:w-36"
          aria-label="상태 필터"
        >
          <option value="all" className="bg-gray-800">전체 상태</option>
          <option value="published" className="bg-gray-800">발행됨</option>
          <option value="scheduled" className="bg-gray-800">예약됨</option>
          <option value="draft" className="bg-gray-800">임시저장</option>
        </select>
      </div>

      {/* 로딩 */}
      {fetchState === 'loading' && (
        <div className="py-16 text-center text-gray-400 text-sm">콘텐츠를 불러오는 중...</div>
      )}

      {/* 에러 */}
      {fetchState === 'error' && (
        <div className="py-16 text-center">
          <p className="text-red-400 text-sm mb-4">{fetchError}</p>
          <button
            type="button"
            onClick={() => void loadPosts()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 빈 상태 */}
      {fetchState === 'ready' && filtered.length === 0 && (
        <div className="py-16 text-center bg-gray-900 border border-gray-800 rounded-xl">
          <p className="text-white font-semibold mb-1">
            {posts.length === 0 ? '아직 저장된 글이 없습니다' : '조건에 맞는 글이 없습니다'}
          </p>
          <p className="text-sm text-gray-500 mb-4">
            {posts.length === 0
              ? '글을 작성한 후 저장함에 보관해보세요. (최근 6개월 콘텐츠가 표시됩니다)'
              : '검색어나 상태 필터를 변경해보세요.'}
          </p>
          {posts.length === 0 && (
            <a
              href="/app"
              className="inline-block px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              글 작성하러 가기
            </a>
          )}
        </div>
      )}

      {/* 목록 */}
      {fetchState === 'ready' && filtered.length > 0 && (
        <>
          <p className="text-xs text-gray-500 mb-3">최근 6개월 · {filtered.length}편</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.map((post) => {
              const status = statusBadge(post.status);
              const site = siteBadge(post.target_site);
              return (
                <div
                  key={post.id}
                  className="relative bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-blue-500/40 transition-colors cursor-pointer group"
                  onClick={() => setDetailPost(post)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setDetailPost(post); }}
                  aria-label={`${post.title} 상세 보기`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${status.className}`}>
                        {status.text}
                      </span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${site.className}`}>
                        {site.text}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handleDelete(post.id); }}
                      disabled={deletingId === post.id}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-600 hover:text-red-400 disabled:text-gray-700 text-xs transition-all px-2 py-1 rounded-lg hover:bg-red-500/10 disabled:cursor-not-allowed flex-shrink-0"
                      aria-label="글 삭제"
                    >
                      {deletingId === post.id ? '삭제 중...' : '삭제'}
                    </button>
                  </div>

                  <h3 className="font-semibold text-white text-sm leading-snug mb-2 line-clamp-2">
                    {post.title}
                  </h3>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    {post.keyword && <span className="text-blue-400">#{post.keyword}</span>}
                    <span>{formatDate(post.published_at ?? post.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
