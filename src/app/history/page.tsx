'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/dev/lib/supabase/client';
import PostEditor from '@/content/components/PostEditor';
import type { SavedPost } from '@/types';

type FetchState = 'loading' | 'ready' | 'error';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function statusLabel(status: SavedPost['status']): { text: string; className: string } {
  switch (status) {
    case 'published':
      return { text: '발행됨', className: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' };
    case 'scheduled':
      return { text: '예약됨', className: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' };
    default:
      return { text: '임시저장', className: 'bg-gray-500/20 text-gray-400 border border-gray-500/30' };
  }
}

interface PostCardProps {
  post: SavedPost;
  onEdit: (post: SavedPost) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
}

function PostCard({ post, onEdit, onDelete, deleting }: PostCardProps) {
  const status = statusLabel(post.status);
  const charCount = post.content.replace(/\[이미지\s*\d+:[^\]]*\]/g, '').length;

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(post.id);
  };

  return (
    <div
      className="relative bg-white/5 border border-white/10 rounded-2xl p-4 sm:p-5 hover:border-blue-500/30 hover:bg-white/[0.07] transition-all cursor-pointer group"
      onClick={() => onEdit(post)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onEdit(post); }}
      aria-label={`${post.title} 수정하기`}
    >
      {/* 상태 뱃지 */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${status.className}`}>
          {status.text}
        </span>
        <button
          onClick={handleDeleteClick}
          disabled={deleting}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-600 hover:text-red-400 disabled:text-gray-700 text-xs transition-all px-2 py-1 rounded-lg hover:bg-red-500/10 disabled:cursor-not-allowed"
          aria-label="글 삭제"
        >
          {deleting ? '삭제 중...' : '삭제'}
        </button>
      </div>

      {/* 제목 */}
      <h3 className="font-semibold text-white text-sm sm:text-base leading-snug mb-2 line-clamp-2">
        {post.title}
      </h3>

      {/* 메타 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        {post.keyword && (
          <span className="text-blue-400">#{post.keyword}</span>
        )}
        <span>{charCount.toLocaleString()}자</span>
        {post.seo_score != null && (
          <span className="text-amber-400">SEO {post.seo_score}</span>
        )}
        <span>{formatDate(post.created_at)}</span>
      </div>

      {/* 태그 */}
      {post.tags && post.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {post.tags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              className="inline-block text-xs text-gray-500 bg-white/5 border border-white/10 rounded-full px-2 py-0.5"
            >
              #{tag}
            </span>
          ))}
          {post.tags.length > 5 && (
            <span className="text-xs text-gray-600">+{post.tags.length - 5}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [authChecked, setAuthChecked] = useState(false);
  const [posts, setPosts] = useState<SavedPost[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [fetchError, setFetchError] = useState('');
  const [editingPost, setEditingPost] = useState<SavedPost | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 인증 확인
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push('/');
        return;
      }
      setAuthChecked(true);
    });
  }, [supabase, router]);

  // 글 목록 불러오기
  const loadPosts = useCallback(async () => {
    setFetchState('loading');
    setFetchError('');
    try {
      const res = await fetch('/api/posts');
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? '목록을 불러오지 못했습니다.');
      }
      const json = await res.json() as { posts: SavedPost[] };
      setPosts(json.posts);
      setFetchState('ready');
    } catch (err) {
      const message = err instanceof Error ? err.message : '목록을 불러오지 못했습니다.';
      setFetchError(message);
      setFetchState('error');
    }
  }, []);

  useEffect(() => {
    if (authChecked) {
      loadPosts();
    }
  }, [authChecked, loadPosts]);

  // 저장 완료 콜백
  const handleSave = useCallback((updated: Partial<SavedPost>) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
    );
    if (editingPost && updated.id === editingPost.id) {
      setEditingPost((prev) => prev ? { ...prev, ...updated } : prev);
    }
    setEditingPost(null);
  }, [editingPost]);

  // 삭제
  const handleDelete = useCallback(async (id: string) => {
    const confirmed = window.confirm('이 글을 삭제하시겠습니까? 삭제 후 복구할 수 없습니다.');
    if (!confirmed) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/posts/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? '삭제에 실패했습니다.');
      }
      setPosts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      const message = err instanceof Error ? err.message : '삭제에 실패했습니다.';
      alert(message);
    } finally {
      setDeletingId(null);
    }
  }, []);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0b0f1a] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-white">
      {/* 에디터 모달 */}
      {editingPost && (
        <PostEditor
          post={editingPost}
          onSave={handleSave}
          onClose={() => setEditingPost(null)}
        />
      )}

      {/* 헤더 */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b0f1a]/80 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => router.push('/app')}
              className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
              aria-label="앱으로 돌아가기"
            >
              ←
            </button>
            <h1 className="font-bold text-white text-base sm:text-lg truncate">콘텐츠 저장함</h1>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {fetchState === 'ready' && (
              <span className="text-xs text-gray-500 hidden sm:inline">
                {posts.length}편 저장됨
              </span>
            )}
            <button
              onClick={loadPosts}
              disabled={fetchState === 'loading'}
              className="text-xs text-gray-400 hover:text-white border border-white/10 hover:bg-white/10 px-2.5 py-1.5 rounded-lg transition-colors disabled:cursor-not-allowed"
              aria-label="새로고침"
            >
              새로고침
            </button>
          </div>
        </div>
      </header>

      {/* 메인 */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* 로딩 */}
        {fetchState === 'loading' && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">글 목록을 불러오는 중...</p>
          </div>
        )}

        {/* 에러 */}
        {fetchState === 'error' && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <p className="text-red-400 text-sm">{fetchError}</p>
            <button
              onClick={loadPosts}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              다시 시도
            </button>
          </div>
        )}

        {/* 빈 상태 */}
        {fetchState === 'ready' && posts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl">
              📂
            </div>
            <div>
              <p className="text-white font-semibold mb-1">아직 저장된 글이 없습니다</p>
              <p className="text-sm text-gray-500">글을 작성한 후 저장함에 보관해보세요.</p>
            </div>
            <button
              onClick={() => router.push('/app')}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              글 작성하러 가기
            </button>
          </div>
        )}

        {/* 글 목록 */}
        {fetchState === 'ready' && posts.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onEdit={setEditingPost}
                onDelete={handleDelete}
                deleting={deletingId === post.id}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
