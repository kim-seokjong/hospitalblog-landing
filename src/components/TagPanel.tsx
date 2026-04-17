'use client';

import { useState } from 'react';
import type { TagResult } from '@/types';

interface TagPanelProps {
  tags: TagResult;
  onRegenerate: () => void;
  isLoading: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  '질환': 'bg-red-100 text-red-700',
  '치료': 'bg-blue-100 text-blue-700',
  '병원': 'bg-green-100 text-green-700',
  '지역': 'bg-yellow-100 text-yellow-700',
  '증상': 'bg-orange-100 text-orange-700',
  '정보': 'bg-purple-100 text-purple-700',
};

const VOLUME_BADGES: Record<string, string> = {
  '높음': '🔴',
  '중간': '🟡',
  '낮음': '🟢',
};

export default function TagPanel({ tags, onRegenerate, isLoading }: TagPanelProps) {
  const [copiedType, setCopiedType] = useState<string | null>(null);

  const copy = async (text: string, type: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const naverTagsText = tags.naverTags.join(' ');
  const hashtagsText = tags.hashtags.join(' ');

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
      <div className="bg-gradient-to-r from-emerald-500 to-teal-500 p-5">
        <h3 className="text-white font-bold text-base">태그 & 해시태그</h3>
        <p className="text-emerald-100 text-xs mt-0.5">네이버 색인 최적화 · 모바일 탭 유입</p>
      </div>

      <div className="p-5 space-y-5">
        {/* 네이버 블로그 태그 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-sm font-bold text-gray-700">네이버 블로그 태그</h4>
              <p className="text-xs text-gray-400">색인 + 모바일 탭 유입 목적</p>
            </div>
            <button
              onClick={() => copy(naverTagsText, 'naver')}
              className="text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-bold px-3 py-1.5 rounded-lg transition-colors"
            >
              {copiedType === 'naver' ? '✓ 복사됨' : '복사'}
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {tags.tags.map((tag, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${CATEGORY_COLORS[tag.category] || 'bg-gray-100 text-gray-700'}`}>
                  {tag.tag}
                </span>
                <span className="text-xs" title={`검색량: ${tag.searchVolume}`}>{VOLUME_BADGES[tag.searchVolume]}</span>
              </div>
            ))}
          </div>
          <div className="text-xs text-gray-400">
            🔴 검색량 높음 · 🟡 보통 · 🟢 낮음
          </div>
        </div>

        {/* 해시태그 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-sm font-bold text-gray-700">해시태그</h4>
              <p className="text-xs text-gray-400">본문 하단 삽입용</p>
            </div>
            <button
              onClick={() => copy(hashtagsText, 'hash')}
              className="text-xs bg-teal-100 hover:bg-teal-200 text-teal-700 font-bold px-3 py-1.5 rounded-lg transition-colors"
            >
              {copiedType === 'hash' ? '✓ 복사됨' : '복사'}
            </button>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 font-mono text-sm text-teal-700 leading-relaxed break-all">
            {hashtagsText}
          </div>
        </div>

        {/* 태그 사용 팁 */}
        <div className="bg-blue-50 rounded-xl p-3">
          <p className="text-xs font-bold text-blue-700 mb-1">📌 네이버 태그 사용 팁</p>
          <ul className="text-xs text-blue-600 space-y-0.5">
            <li>• 태그는 7~10개 이내 사용 (과도하면 역효과)</li>
            <li>• 검색량 높은 태그 우선 배치</li>
            <li>• 모바일에서 #태그 탭으로 동일 태그 글 노출</li>
          </ul>
        </div>

        <button
          onClick={onRegenerate}
          disabled={isLoading}
          className="w-full py-2.5 border-2 border-emerald-200 hover:border-emerald-400 text-emerald-700 hover:bg-emerald-50 font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              재생성 중...
            </>
          ) : (
            <><span>🔄</span> 태그 재생성</>
          )}
        </button>
      </div>
    </div>
  );
}
