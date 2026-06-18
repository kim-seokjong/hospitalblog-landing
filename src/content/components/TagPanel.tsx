'use client';

import { useState } from 'react';
import type { TagResult } from '@/types';

interface TagPanelProps {
  tags: TagResult;
  onRegenerate: () => void;
  isLoading: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  '질환': 'bg-red-500/25 text-white border border-red-400/60',
  '치료': 'bg-blue-500/25 text-white border border-blue-400/60',
  '병원': 'bg-emerald-500/25 text-white border border-emerald-400/60',
  '지역': 'bg-yellow-500/25 text-white border border-yellow-400/60',
  '증상': 'bg-orange-500/25 text-white border border-orange-400/60',
  '정보': 'bg-purple-500/25 text-white border border-purple-400/60',
};

const VOLUME_BADGES: Record<string, string> = {
  '높음': '🔴',
  '중간': '🟡',
  '낮음': '🟢',
};

export default function TagPanel({ tags, onRegenerate, isLoading }: TagPanelProps) {
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [prevTags, setPrevTags] = useState<TagResult | null>(null);
  const [showPrev, setShowPrev] = useState(false);

  const handleRegenerate = () => {
    setPrevTags(tags);
    setShowPrev(false);
    onRegenerate();
  };

  const copy = async (text: string, type: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const naverTagsText = tags.naverTags.join(' ');
  const hashtagsText = tags.hashtags.join(' ');

  return (
    <div className="bg-white rounded-2xl shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)] border border-[#dbe2ea] overflow-hidden">
      <div className="bg-emerald-800 p-4 sm:p-5" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>
        <h3 className="text-white font-bold text-base">태그 & 해시태그</h3>
        <p className="text-emerald-100 text-xs mt-0.5">네이버 색인 최적화 · 모바일 탭 유입</p>
      </div>

      <div className="p-4 sm:p-5 space-y-5">
        {/* 네이버 블로그 태그 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-sm font-bold text-[#202020]">네이버 블로그 태그</h4>
              <p className="text-xs text-[#8a93a0]">색인 + 모바일 탭 유입 목적</p>
            </div>
            <button
              onClick={() => copy(naverTagsText, 'naver')}
              className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold px-3 py-1.5 rounded-lg border border-emerald-300 transition-colors min-h-[36px]"
            >
              {copiedType === 'naver' ? '✓ 복사됨' : '복사'}
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {tags.tags.map((tag, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${CATEGORY_COLORS[tag.category] || 'bg-[#eef2f6] text-[#202020] border border-[#dbe2ea]'}`}>
                  {tag.tag}
                </span>
                <span className="text-xs" title={`검색량: ${tag.searchVolume}`}>{VOLUME_BADGES[tag.searchVolume]}</span>
              </div>
            ))}
          </div>
          <div className="text-xs text-[#4a4f55]">
            🔴 검색량 높음 · 🟡 보통 · 🟢 낮음
          </div>
        </div>

        {/* 해시태그 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-sm font-bold text-[#202020]">해시태그</h4>
              <p className="text-xs text-[#8a93a0]">본문 하단 삽입용</p>
            </div>
            <button
              onClick={() => copy(hashtagsText, 'hash')}
              className="text-xs bg-teal-50 hover:bg-teal-100 text-teal-700 font-bold px-3 py-1.5 rounded-lg border border-teal-300 transition-colors min-h-[36px]"
            >
              {copiedType === 'hash' ? '✓ 복사됨' : '복사'}
            </button>
          </div>
          <div className="bg-[#eef2f6] border border-[#dbe2ea] rounded-xl p-3 font-mono text-sm font-semibold text-teal-700 leading-relaxed break-all">
            {hashtagsText}
          </div>
        </div>

        {/* 태그 사용 팁 */}
        <div className="bg-blue-50 border border-blue-300 rounded-xl p-3">
          <p className="text-xs font-bold text-blue-700 mb-1">📌 네이버 태그 사용 팁</p>
          <ul className="text-xs text-blue-800 space-y-0.5">
            <li>• 태그는 7~10개 이내 사용 (과도하면 역효과)</li>
            <li>• 검색량 높은 태그 우선 배치</li>
            <li>• 모바일에서 #태그 탭으로 동일 태그 글 노출</li>
          </ul>
        </div>

        {prevTags && (
          <div className="border border-[#dbe2ea] rounded-xl overflow-hidden">
            <button
              onClick={() => setShowPrev(!showPrev)}
              className="w-full flex items-center justify-between px-3 py-2 bg-[#eef2f6] hover:bg-[#e2e8ef] transition-colors text-xs font-semibold text-[#4a4f55] min-h-[40px]"
            >
              <span>🕐 이전 태그 보기</span>
              <span>{showPrev ? '▲' : '▼'}</span>
            </button>
            {showPrev && (
              <div className="px-3 py-2 space-y-2 bg-[#eef2f6]">
                <div className="flex flex-wrap gap-1.5">
                  {prevTags.tags.map((tag, i) => (
                    <span key={i} className={`text-xs font-semibold px-2 py-0.5 rounded-full opacity-70 ${CATEGORY_COLORS[tag.category] || 'bg-[#dbe2ea] text-[#202020] border border-[#c2ccd6]'}`}>
                      {tag.tag}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-[#8a93a0] font-mono break-all">{prevTags.naverTags.join(' ')}</p>
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleRegenerate}
          disabled={isLoading}
          className="w-full py-2.5 border-2 border-emerald-300 hover:border-emerald-400 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 min-h-[44px]"
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
