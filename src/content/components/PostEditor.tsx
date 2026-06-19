'use client';

import { useState, useEffect, useCallback } from 'react';
import type { SavedPost } from '@/types';

interface PostEditorProps {
  post: SavedPost;
  onSave: (updated: Partial<SavedPost>) => void;
  onClose: () => void;
}

export default function PostEditor({ post, onSave, onClose }: PostEditorProps) {
  const [title, setTitle] = useState(post.title);
  const [content, setContent] = useState(post.content);
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>(post.tags ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setTitle(post.title);
    setContent(post.content);
    setTags(post.tags ?? []);
    setDirty(false);
  }, [post]);

  const handleTitleChange = (v: string) => {
    setTitle(v);
    setDirty(true);
  };

  const handleContentChange = (v: string) => {
    setContent(v);
    setDirty(true);
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    if (tags.includes(trimmed)) {
      setTagInput('');
      return;
    }
    setTags([...tags, trimmed]);
    setTagInput('');
    setDirty(true);
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
    setDirty(true);
  };

  const handleSave = useCallback(async () => {
    if (saving) return;

    if (!title.trim()) {
      setError('제목을 입력해주세요.');
      return;
    }
    if (!content.trim()) {
      setError('본문을 입력해주세요.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), tags }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? '수정에 실패했습니다.');
      }

      const json = await res.json() as { post: SavedPost };
      onSave(json.post);
      setDirty(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : '수정에 실패했습니다.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [saving, title, content, tags, post.id, onSave]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      if (dirty) {
        const confirmed = window.confirm('저장하지 않은 변경사항이 있습니다. 닫으시겠습니까?');
        if (!confirmed) return;
      }
      onClose();
    }
  };

  const handleClose = () => {
    if (dirty) {
      const confirmed = window.confirm('저장하지 않은 변경사항이 있습니다. 닫으시겠습니까?');
      if (!confirmed) return;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-start justify-center overflow-y-auto py-4 px-2 sm:px-4"
      onClick={handleOverlayClick}
      aria-modal="true"
      role="dialog"
      aria-label="글 수정 에디터"
    >
      <div
        className="relative w-full max-w-3xl bg-white border border-[#b4bfce] rounded-2xl shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-[#b4bfce]">
          <h2 className="text-base sm:text-lg font-bold text-[#202020]">글 수정</h2>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#5b6573] hover:text-[#202020] hover:bg-[#eef2f6] transition-colors"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">
          {/* 제목 */}
          <div>
            <label className="block text-xs font-semibold text-[#5b6573] mb-1.5" htmlFor="post-title">
              제목
            </label>
            <input
              id="post-title"
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              maxLength={200}
              className="w-full bg-white border border-[#b4bfce] rounded-lg px-3 py-2.5 text-sm text-[#202020] placeholder-[#73808f] focus:outline-none focus:border-[#ff4628] focus:bg-white transition-colors"
              placeholder="글 제목을 입력하세요"
            />
            <p className="text-right text-xs text-[#73808f] mt-1">{title.length} / 200</p>
          </div>

          {/* 본문 */}
          <div>
            <label className="block text-xs font-semibold text-[#5b6573] mb-1.5" htmlFor="post-content">
              본문
            </label>
            <textarea
              id="post-content"
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              style={{ minHeight: '400px' }}
              className="w-full bg-white border border-[#b4bfce] rounded-lg px-3 py-2.5 text-sm text-[#202020] placeholder-[#73808f] focus:outline-none focus:border-[#ff4628] focus:bg-white transition-colors resize-y leading-relaxed"
              placeholder="블로그 본문을 입력하세요"
            />
            <p className="text-right text-xs text-[#73808f] mt-1">{content.length.toLocaleString()}자</p>
          </div>

          {/* 태그 */}
          <div>
            <label className="block text-xs font-semibold text-[#5b6573] mb-1.5">
              태그
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                maxLength={50}
                className="flex-1 bg-white border border-[#b4bfce] rounded-lg px-3 py-2 text-sm text-[#202020] placeholder-[#73808f] focus:outline-none focus:border-[#ff4628] focus:bg-white transition-colors"
                placeholder="태그 입력 후 Enter"
              />
              <button
                onClick={handleAddTag}
                type="button"
                className="px-3 py-2 bg-[#eef2f6] hover:bg-[#b4bfce] text-[#4a4f55] text-sm rounded-lg transition-colors"
              >
                추가
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs rounded-full border border-blue-200"
                  >
                    #{tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-red-500 transition-colors leading-none"
                      aria-label={`${tag} 태그 삭제`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 에러 메시지 */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-[#b4bfce]">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm text-[#4a4f55] hover:text-[#202020] border border-[#b4bfce] hover:bg-[#eef2f6] rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="px-5 py-2 bg-[#ff4628] hover:bg-[#e63a1c] disabled:bg-[#b4bfce] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
          >
            {saving ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                저장 중...
              </>
            ) : (
              '저장하기'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
