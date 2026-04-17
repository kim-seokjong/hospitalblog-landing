'use client';

import { useState, useEffect } from 'react';
import type { BlogContent, TagResult } from '@/types';

const LS_CATEGORY_KEY = 'naver_blog_category';

interface NaverPublisherProps {
  title: string;
  content: BlogContent;
  tags: TagResult | null;
}

type PublishStatus = 'idle' | 'publishing' | 'success' | 'error';

export default function NaverPublisher({ title, content, tags }: NaverPublisherProps) {
  const [status, setStatus] = useState<PublishStatus>('idle');
  const [resultUrl, setResultUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [category, setCategory] = useState('');

  useEffect(() => {
    setCategory(localStorage.getItem(LS_CATEGORY_KEY) ?? '');
  }, []);

  const handlePublish = async () => {
    setStatus('publishing');
    setErrorMsg('');
    setResultUrl('');

    const tagList = tags?.naverTags?.slice(0, 10) ?? [];

    try {
      const res = await fetch('/api/publish-naver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body: content.body,
          tags: tagList,
          category,          // localStorage에서 읽은 카테고리
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '발행에 실패했습니다.');

      setResultUrl(data.url);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '알 수 없는 오류');
      setStatus('error');
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 flex items-center gap-3 border-b border-gray-100">
        <div className="w-9 h-9 bg-green-500 rounded-xl flex items-center justify-center">
          <span className="text-white text-base font-bold">N</span>
        </div>
        <div>
          <h3 className="text-sm font-bold text-gray-900">네이버 블로그 자동발행</h3>
          <p className="text-xs text-gray-500">저장된 계정으로 즉시 발행</p>
        </div>
      </div>

      <div className="px-5 py-4 space-y-3">
        {/* 발행 미리보기 */}
        <div className="bg-gray-50 rounded-xl p-3 space-y-1">
          <p className="text-xs font-semibold text-gray-500">발행 예정 글</p>
          <p className="text-sm font-bold text-gray-800 truncate">{title}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">
              {content.charCount.toLocaleString()}자
              {tags?.naverTags?.length ? ` · 태그 ${Math.min(tags.naverTags.length, 10)}개` : ''}
            </span>
            {category && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                📁 {category}
              </span>
            )}
            {!category && (
              <span className="text-xs text-gray-400">카테고리 미설정 (설정에서 입력)</span>
            )}
          </div>
        </div>

        {/* 발행 버튼 */}
        {(status === 'idle' || status === 'error') && (
          <button
            onClick={handlePublish}
            className="w-full py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl text-sm transition-colors"
          >
            네이버 블로그에 발행하기
          </button>
        )}

        {/* 발행 중 */}
        {status === 'publishing' && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-semibold text-blue-700">발행 중... (최대 3~4분 소요)</p>
            </div>
            <p className="text-xs text-blue-600">
              서버에서 브라우저가 자동으로 네이버 블로그에 글을 작성합니다.
            </p>
            <p className="text-xs text-blue-500">
              첫 발행 시 서버 시작으로 30초 추가 소요될 수 있습니다.
            </p>
          </div>
        )}

        {/* 성공 */}
        {status === 'success' && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-green-600 text-xl">✓</span>
              <p className="text-sm font-bold text-green-800">발행 완료!</p>
            </div>
            {resultUrl && (
              <a href={resultUrl} target="_blank" rel="noopener noreferrer"
                className="block text-xs text-green-700 underline truncate">
                {resultUrl}
              </a>
            )}
            <button
              onClick={() => setStatus('idle')}
              className="w-full py-2 border border-green-300 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100"
            >
              다시 발행하기
            </button>
          </div>
        )}

        {/* 오류 */}
        {status === 'error' && errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-red-700 mb-1">발행 실패</p>
            <p className="text-xs text-red-600">{errorMsg}</p>
          </div>
        )}
      </div>
    </div>
  );
}
