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
  '질문형': 'bg-blue-50 text-blue-700 border-blue-200',
  '정보형': 'bg-purple-50 text-purple-700 border-purple-200',
  '가이드형': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  '노하우형': 'bg-amber-50 text-amber-700 border-amber-200',
  '숫자형': 'bg-rose-50 text-rose-700 border-rose-200',
  '비교형': 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

function SeoScoreBar({ label, score }: { label: string; score: number }) {
  const color = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = score >= 80 ? 'text-emerald-700' : score >= 60 ? 'text-amber-700' : 'text-red-600';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-[#202020] w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-[#eef2f6] rounded-full h-2 border border-[#b4bfce]">
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
    <div className="rounded-2xl border border-[#b4bfce] bg-white p-4 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 flex-shrink-0 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center">
          <span className="text-purple-600 font-bold text-sm">2</span>
        </div>
        <div>
          <h2 className="text-base font-bold text-[#202020]">제목 선택</h2>
          <p className="text-xs text-[#5b6573]">AI 생성 제목 선택 또는 직접 입력</p>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-4 bg-[#eef2f6] p-1 rounded-xl">
        {(['ai', 'manual'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors min-h-[40px] ${
              tab === t ? 'bg-white text-[#202020] shadow-sm' : 'text-[#5b6573] hover:text-[#202020] active:bg-[#eef2f6]'
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
            className="w-full px-4 py-3 rounded-xl bg-white border-2 border-[#b4bfce] text-[#202020] placeholder-[#73808f] text-sm focus:outline-none focus:border-purple-500/60 transition-colors resize-none"
          />
          <p className="text-[10px] text-[#5b6573]">
            {manualTitle.length}자
            {manualTitle.length >= 25 && manualTitle.length <= 35
              ? <span className="text-emerald-600 ml-1">✓ 적정 길이</span>
              : <span className="text-amber-600 ml-1">⚠ 25~35자 권장</span>
            }
          </p>
          <button
            onClick={onGenerate}
            disabled={!manualTitle.trim() || isLoading}
            className="w-full py-4 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 disabled:bg-[#b4bfce] disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 min-h-[52px] border-2 border-yellow-400"
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
              <p className="text-[#73808f] text-sm">키워드를 입력하면 AI 제목이 생성됩니다</p>
            </div>
          ) : (
            <>
              <div className="space-y-2.5 mb-4">
                {titles.map((title) => {
                  const isSelected = selectedTitle?.id === title.id;
                  const formatColor = FORMAT_COLORS[title.seoDetails?.format] || 'bg-gray-100 text-gray-600 border-gray-200';

                  return (
                    <button
                      key={title.id}
                      onClick={() => onSelect(title)}
                      className={`w-full text-left p-3.5 rounded-xl border-2 transition-all active:scale-[0.99] ${
                        isSelected
                          ? 'border-yellow-400 bg-yellow-50 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]'
                          : 'border-[#b4bfce] hover:border-yellow-400/40 hover:bg-[#eef2f6] active:bg-[#eef2f6]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
                            isSelected ? 'border-yellow-400 bg-yellow-400' : 'border-[#73808f]'
                          }`}>
                            {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                          </div>
                          <span className={`text-sm font-medium leading-relaxed ${isSelected ? 'text-[#202020]' : 'text-[#202020]'}`}>
                            {title.title}
                            <span className="text-[10px] text-[#5b6573] ml-1.5 whitespace-nowrap">
                              ({title.title.length}자
                              {title.title.length >= 25 && title.title.length <= 35
                                ? <span className="text-emerald-600 ml-0.5">✓</span>
                                : <span className="text-amber-600 ml-0.5">⚠</span>
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
                            title.seoScore >= 80 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            title.seoScore >= 60 ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            'bg-red-50 text-red-600 border-red-200'
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
                            <p className="text-xs text-yellow-800 mt-2 bg-yellow-50 border border-yellow-200 rounded-lg p-2.5 leading-relaxed">
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
                className="w-full py-4 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 disabled:bg-[#b4bfce] disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)] min-h-[52px] border-2 border-yellow-400"
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
