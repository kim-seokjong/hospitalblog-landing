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
  '질문형': 'bg-blue-100 text-blue-700',
  '정보형': 'bg-purple-100 text-purple-700',
  '가이드형': 'bg-green-100 text-green-700',
  '노하우형': 'bg-amber-100 text-amber-700',
  '숫자형': 'bg-rose-100 text-rose-700',
  '비교형': 'bg-indigo-100 text-indigo-700',
};

function SeoScoreBar({ label, score }: { label: string; score: number }) {
  const color = score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-bold text-gray-600 w-8 text-right">{score}</span>
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
    <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-purple-500 rounded-xl flex items-center justify-center">
          <span className="text-white text-lg font-bold">2</span>
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">제목 선택</h2>
          <p className="text-sm text-gray-500">AI 생성 제목 선택 또는 직접 입력</p>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl">
        <button
          onClick={() => setTab('ai')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            tab === 'ai' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          AI 생성 제목
        </button>
        <button
          onClick={() => setTab('manual')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            tab === 'manual' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          직접 입력
        </button>
      </div>

      {/* 직접 입력 탭 */}
      {tab === 'manual' && (
        <div className="space-y-3">
          <textarea
            value={manualTitle}
            onChange={(e) => handleManualChange(e.target.value)}
            placeholder="원하는 제목을 직접 입력하세요"
            rows={3}
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:border-purple-400 resize-none"
          />
          <div className="text-xs text-gray-400">
            {manualTitle.length}자
            {manualTitle.length >= 25 && manualTitle.length <= 35
              ? <span className="text-green-600 ml-1">✓ 적정 길이</span>
              : <span className="text-amber-500 ml-1">⚠ 25~35자 권장</span>
            }
          </div>
          <button
            onClick={onGenerate}
            disabled={!manualTitle.trim() || isLoading}
            className="w-full py-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors duration-200 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                본문 + 태그 생성 중...
              </>
            ) : (
              <><span>📝</span> 이 제목으로 본문 생성</>
            )}
          </button>
        </div>
      )}

      {/* AI 생성 탭 */}
      {tab === 'ai' && (
        <div>
          {titles.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">키워드를 입력하면 AI 제목이 생성됩니다</p>
          ) : (
            <>
              <div className="space-y-3 mb-6">
                {titles.map((title) => {
                  const isSelected = selectedTitle?.id === title.id;
                  const formatColor = FORMAT_COLORS[title.seoDetails?.format] || 'bg-gray-100 text-gray-600';

                  return (
                    <button
                      key={title.id}
                      onClick={() => onSelect(title)}
                      className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                        isSelected ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-start gap-2 flex-1">
                          <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
                            isSelected ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                          }`}>
                            {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                          </div>
                          <span className={`text-sm font-semibold leading-relaxed ${isSelected ? 'text-purple-800' : 'text-gray-800'}`}>
                            {title.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {title.seoDetails?.format && (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${formatColor}`}>
                              {title.seoDetails.format}
                            </span>
                          )}
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                            title.seoScore >= 80 ? 'bg-green-100 text-green-700 border-green-200' :
                            title.seoScore >= 60 ? 'bg-amber-100 text-amber-700 border-amber-200' :
                            'bg-red-100 text-red-700 border-red-200'
                          }`}>
                            SEO {title.seoScore}
                          </span>
                        </div>
                      </div>

                      <div className="ml-7 mb-2">
                        <span className="text-xs text-gray-400">{title.title.length}자</span>
                        {title.title.length >= 25 && title.title.length <= 35
                          ? <span className="text-xs text-green-600 ml-1">✓ 적정 길이</span>
                          : <span className="text-xs text-amber-500 ml-1">⚠ 25~35자 권장</span>
                        }
                      </div>

                      {isSelected && title.seoDetails && (
                        <div className="ml-7 mt-3 space-y-1.5 border-t border-purple-200 pt-3">
                          <SeoScoreBar label="키워드 배치" score={title.seoDetails.keywordPlacement} />
                          <SeoScoreBar label="클릭 유도성" score={title.seoDetails.clickability} />
                          <SeoScoreBar label="제목 길이" score={title.seoDetails.titleLength} />
                          <SeoScoreBar label="광고법 준수" score={title.seoDetails.compliance} />
                          {title.seoDetails.explanation && (
                            <p className="text-xs text-purple-700 mt-2 bg-purple-50 rounded-lg p-2">
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
                className="w-full py-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors duration-200 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    본문 + 태그 생성 중...
                  </>
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
