'use client';

import { useState } from 'react';
import type { BlogTitle } from '@/types';

interface TitleSelectorProps {
  titles: BlogTitle[];
  selectedTitle: BlogTitle | null;
  onSelect: (title: BlogTitle) => void;
  onGenerate: () => void;
  isLoading: boolean;
}

const FORMAT_COLORS: Record<string, string> = {
  '질문형': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  '정보형': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  '가이드형': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  '노하우형': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  '숫자형': 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  '비교형': 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
};

function SeoScoreBar({ label, score }: { label: string; score: number }) {
  const color = score >= 80 ? 'bg-emerald-400' : score >= 60 ? 'bg-amber-400' : 'bg-red-400';
  const textColor = score >= 80 ? 'text-emerald-300' : score >= 60 ? 'text-amber-300' : 'text-red-300';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-white w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-[#0b0d2b] rounded-full h-2 border border-[#2a2b6e]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-bold w-8 text-right ${textColor}`}>{score}</span>
    </div>
  );
}

export default function TitleSelector({ titles, selectedTitle, onSelect, onGenerate, isLoading }: TitleSelectorProps) {
  const [tab, setTab] = useState<'ai' | 'manual'>('ai');
  const [manualTitle, setManualTitle] = useState('');

  const EMPTY_SEO_DETAILS = {
    keywordPlacement: 0, titleLength: 0, clickability: 0,
    compliance: 0, format: '정보형' as const, explanation: '',
  };

  const handleManualChange = (value: string) => {
    setManualTitle(value);
    onSelect({ id: 'manual', title: value.trim(), seoScore: 0, keyword: '', seoDetails: EMPTY_SEO_DETAILS });
  };

  return (
    <div className="rounded-2xl border border-[#2a2b6e] bg-[#12153d] p-4 sm:p-6 shadow-xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 flex-shrink-0 rounded-xl bg-[#191970] border border-[#7c3aed]/30 flex items-center justify-center">
          <span className="text-purple-400 font-bold text-sm">2</span>
        </div>
        <div>
          <h2 className="text-base font-bold text-white">제목 선택</h2>
          <p className="text-xs text-[#8891bd]">AI 생성 제목 선택 또는 직접 입력</p>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-4 bg-[#0b0d2b] p-1 rounded-xl">
        {(['ai', 'manual'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors min-h-[40px] ${
              tab === t ? 'bg-[#191970] text-white shadow-sm' : 'text-[#8891bd] hover:text-white active:bg-[#191970]/50'
            }`}
          >
            {t === 'ai' ? 'AI 생성 제목' : '직접 입력'}
          </button>
        ))}
      </div>

      {tab === 'manual' && (
        <div className="space-y-3">
          <textarea
            value={manualTitle}
            onChange={(e) => handleManualChange(e.target.value)}
            placeholder="원하는 제목을 직접 입력하세요"
            rows={3}
            className="w-full px-4 py-3 rounded-xl bg-[#0b0d2b] border-2 border-[#2a2b6e] text-white placeholder-[#555d8a] text-sm focus:outline-none focus:border-purple-500/60 transition-colors resize-none"
          />
          <p className="text-[10px] text-[#8891bd]">
            {manualTitle.length}자
            {manualTitle.length >= 25 && manualTitle.length <= 35
              ? <span className="text-emerald-400 ml-1">✓ 적정 길이</span>
              : <span className="text-amber-400 ml-1">⚠ 25~35자 권장</span>
            }
          </p>
          <button
            onClick={onGenerate}
            disabled={!manualTitle.trim() || isLoading}
            className="w-full py-4 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 disabled:bg-[#2a2b6e] disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 min-h-[52px] border-2 border-yellow-400"
          >
            {isLoading ? (
              <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> 본문 생성 중...</>
            ) : (
              <><span>📝</span> 이 제목으로 본문 생성</>
            )}
          </button>
        </div>
      )}

      {tab === 'ai' && (
        <div>
          {titles.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[#555d8a] text-sm">키워드를 입력하면 AI 제목이 생성됩니다</p>
            </div>
          ) : (
            <>
              <div className="space-y-2.5 mb-4">
                {titles.map((title) => {
                  const isSelected = selectedTitle?.id === title.id;
                  const formatColor = FORMAT_COLORS[title.seoDetails?.format] || 'bg-gray-500/20 text-gray-300 border-gray-500/30';

                  return (
                    <button
                      key={title.id}
                      onClick={() => onSelect(title)}
                      className={`w-full text-left p-3.5 rounded-xl border-2 transition-all active:scale-[0.99] ${
                        isSelected
                          ? 'border-yellow-400 bg-yellow-400/10 shadow-lg shadow-yellow-400/10'
                          : 'border-[#2a2b6e] hover:border-yellow-400/40 hover:bg-[#191970]/30 active:bg-[#191970]/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
                            isSelected ? 'border-yellow-400 bg-yellow-400' : 'border-[#555d8a]'
                          }`}>
                            {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-[#0b0d2b]" />}
                          </div>
                          <span className={`text-sm font-medium leading-relaxed ${isSelected ? 'text-white' : 'text-[#c5caf0]'}`}>
                            {title.title}
                            <span className="text-[10px] text-[#8891bd] ml-1.5 whitespace-nowrap">
                              ({title.title.length}자
                              {title.title.length >= 25 && title.title.length <= 35
                                ? <span className="text-emerald-400 ml-0.5">✓</span>
                                : <span className="text-amber-400 ml-0.5">⚠</span>
                              })
                            </span>
                          </span>
                        </div>
                        {/* 배지: 모바일에서 줄바꿈 허용 */}
                        <div className="flex flex-wrap items-center gap-1 flex-shrink-0 justify-end">
                          {title.seoDetails?.format && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${formatColor}`}>
                              {title.seoDetails.format}
                            </span>
                          )}
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                            title.seoScore >= 80 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                            title.seoScore >= 60 ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                            'bg-red-500/20 text-red-300 border-red-500/30'
                          }`}>
                            {title.seoScore}점
                          </span>
                        </div>
                      </div>

                      {isSelected && title.seoDetails && (
                        <div className="ml-6 mt-3 space-y-2 border-t border-yellow-400/30 pt-3">
                          <SeoScoreBar label="키워드 배치" score={title.seoDetails.keywordPlacement} />
                          <SeoScoreBar label="클릭 유도성" score={title.seoDetails.clickability} />
                          <SeoScoreBar label="제목 길이" score={title.seoDetails.titleLength} />
                          <SeoScoreBar label="광고법 준수" score={title.seoDetails.compliance} />
                          {title.seoDetails.explanation && (
                            <p className="text-xs text-yellow-100 mt-2 bg-yellow-400/10 border border-yellow-400/30 rounded-lg p-2.5 leading-relaxed">
                              💡 {title.seoDetails.explanation}
                            </p>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={onGenerate}
                disabled={!selectedTitle || isLoading}
                className="w-full py-4 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 disabled:bg-[#2a2b6e] disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-lg shadow-yellow-400/20 min-h-[52px] border-2 border-yellow-400"
              >
                {isLoading ? (
                  <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> 본문 + 태그 생성 중...</>
                ) : (
                  <><span>📝</span> 선택 제목으로 본문 생성</>
                )}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
