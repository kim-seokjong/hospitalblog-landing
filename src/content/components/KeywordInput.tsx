'use client';

import { useState, useRef } from 'react';
import type { WritingStyle, OptimizationMode } from '@/types';
import SpecialtyKeywordSuggester from '@/content/components/SpecialtyKeywordSuggester';

interface KeywordInputProps {
  onSubmit: (keyword: string, hospitalType: string, additionalInfo: string, writingStyle: WritingStyle, region: string, optimizationMode: OptimizationMode) => void;
  isLoading: boolean;
  defaultKeyword?: string;
  defaultHospitalType?: string;
  defaultAdditionalInfo?: string;
  defaultWritingStyle?: WritingStyle;
  defaultOptimizationMode?: OptimizationMode;
  lockedHospitalType?: string;
  defaultRegion?: string;
}

const HOSPITAL_TYPES = [
  '내과', '외과', '피부과', '성형외과', '정형외과', '안과',
  '이비인후과', '치과', '한의원', '산부인과', '소아과', '신경과',
  '정신건강의학과', '재활의학과', '가정의학과', '비뇨기과', '기타',
];

const WRITING_STYLES: { value: WritingStyle; label: string; desc: string; icon: string }[] = [
  { value: '전문가',  label: '전문가시점',  desc: '의학 전문성 강조', icon: '🩺' },
  { value: '고객이해', label: '고객이해시점', desc: '전문용어 없이',    icon: '👥' },
  { value: '사무장',  label: '사무장시점',  desc: '서비스·절차 중심', icon: '🏥' },
];

const OPTIMIZATION_MODES: { value: OptimizationMode; label: string; desc: string; icon: string }[] = [
  { value: 'seo+geo', label: 'SEO+GEO 최적화', desc: 'AI 검색 인용 최대화', icon: '🚀' },
  { value: 'seo',     label: 'SEO 최적화',     desc: 'AI티 없는 자연스런 글', icon: '🌿' },
];

export default function KeywordInput({ onSubmit, isLoading, defaultKeyword, defaultHospitalType, defaultAdditionalInfo, defaultWritingStyle, defaultOptimizationMode, lockedHospitalType, defaultRegion }: KeywordInputProps) {
  const [keyword, setKeyword] = useState(defaultKeyword ?? '');
  const [hospitalType, setHospitalType] = useState(lockedHospitalType ?? defaultHospitalType ?? '피부과');
  const keywordInputRef = useRef<HTMLInputElement>(null);
  const [region, setRegion] = useState(defaultRegion ?? '');
  const [additionalInfo, setAdditionalInfo] = useState(defaultAdditionalInfo ?? '');
  const [writingStyle, setWritingStyle] = useState<WritingStyle>(defaultWritingStyle || '전문가');
  const [optimizationMode, setOptimizationMode] = useState<OptimizationMode>(defaultOptimizationMode || 'seo+geo');

  const effectiveHospitalType = lockedHospitalType ?? hospitalType;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim()) return;
    onSubmit(keyword.trim(), effectiveHospitalType, additionalInfo.trim(), writingStyle, region.trim(), optimizationMode);
  };

  return (
    <div className="rounded-2xl border border-[#2a2b6e] bg-[#12153d] p-4 sm:p-6 shadow-xl">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 flex-shrink-0 rounded-xl bg-[#191970] border border-[#4f6ef7]/30 flex items-center justify-center">
          <span className="text-[#4f6ef7] font-bold text-sm">1</span>
        </div>
        <div>
          <h2 className="text-base font-bold text-white">키워드 입력</h2>
          <p className="text-xs text-[#8891bd]">블로그 주제 키워드를 입력하세요</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-[#8891bd] mb-1.5">
            핵심 키워드 <span className="text-[#4f6ef7]">*</span>
          </label>
          <input
            ref={keywordInputRef}
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="예: 레이저 토닝, 보톡스, 도수치료"
            className="w-full px-4 py-3 rounded-xl bg-[#0b0d2b] border border-[#2a2b6e] text-white placeholder-[#555d8a] text-sm focus:outline-none focus:border-[#4f6ef7] focus:ring-1 focus:ring-[#4f6ef7]/30 transition-colors"
            disabled={isLoading}
            autoComplete="off"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#8891bd] mb-1.5 flex items-center gap-1.5">
            병원 유형
            {lockedHospitalType && <span className="text-[9px] bg-[#2a2b6e] text-[#8891bd] px-1.5 py-0.5 rounded-full">🔒 가입 시 설정됨</span>}
          </label>
          {lockedHospitalType ? (
            <div className="w-full px-4 py-3 rounded-xl bg-[#0b0d2b] border border-[#2a2b6e]/60 text-[#8891bd] text-sm cursor-not-allowed">
              {lockedHospitalType}
            </div>
          ) : (
            <select
              value={hospitalType}
              onChange={(e) => setHospitalType(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-[#0b0d2b] border border-[#2a2b6e] text-white text-sm focus:outline-none focus:border-[#4f6ef7] focus:ring-1 focus:ring-[#4f6ef7]/30 transition-colors"
              disabled={isLoading}
            >
              {HOSPITAL_TYPES.map((type) => (
                <option key={type} value={type} className="bg-[#12153d]">{type}</option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#8891bd] mb-1.5">
            지역 <span className="text-[#555d8a] font-normal">(선택 · 키워드 추천에 활용)</span>
          </label>
          <input
            type="text"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="예: 강남, 홍대, 분당"
            className="w-full px-4 py-3 rounded-xl bg-[#0b0d2b] border border-[#2a2b6e] text-white placeholder-[#555d8a] text-sm focus:outline-none focus:border-[#4f6ef7] focus:ring-1 focus:ring-[#4f6ef7]/30 transition-colors"
            disabled={isLoading}
            autoComplete="off"
          />
        </div>

        <SpecialtyKeywordSuggester
          specialty={effectiveHospitalType}
          region={region}
          onSelect={(kw, isSelected) => {
            if (isSelected) {
              setKeyword((prev) => prev ? `${prev}, ${kw}` : kw);
            } else {
              setKeyword((prev) => {
                const parts = prev.split(',').map(k => k.trim()).filter(k => k !== kw);
                return parts.join(', ');
              });
            }
            setTimeout(() => keywordInputRef.current?.focus(), 0);
          }}
        />

        <div>
          <label className="block text-xs font-semibold text-[#8891bd] mb-1.5">
            추가 정보 <span className="text-[#555d8a] font-normal">(선택)</span>
          </label>
          <textarea
            value={additionalInfo}
            onChange={(e) => setAdditionalInfo(e.target.value)}
            placeholder="강조할 내용, 타겟 환자군, 주요 서비스 등"
            rows={2}
            className="w-full px-4 py-3 rounded-xl bg-[#0b0d2b] border border-[#2a2b6e] text-white placeholder-[#555d8a] text-sm focus:outline-none focus:border-[#4f6ef7] focus:ring-1 focus:ring-[#4f6ef7]/30 transition-colors resize-none"
            disabled={isLoading}
          />
        </div>

        {/* 글쓰기 말투 */}
        <div>
          <label className="block text-xs font-semibold text-[#8891bd] mb-2">글쓰기 말투</label>
          <div className="grid grid-cols-3 gap-2">
            {WRITING_STYLES.map((style) => (
              <button
                key={style.value}
                type="button"
                onClick={() => setWritingStyle(style.value)}
                disabled={isLoading}
                className={`flex flex-col items-center gap-1 py-3 px-1 rounded-xl border-2 transition-all text-center min-h-[72px] ${
                  writingStyle === style.value
                    ? 'border-[#4f6ef7] bg-[#4f6ef7]/10 text-white'
                    : 'border-[#2a2b6e] bg-[#0b0d2b] text-[#8891bd] hover:border-[#4f6ef7]/40 active:bg-[#191970]/30'
                }`}
              >
                <span className="text-xl leading-none">{style.icon}</span>
                <span className="text-[11px] font-bold leading-tight">{style.label}</span>
                <span className="text-[9px] opacity-70 leading-tight hidden sm:block">{style.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 문단 구성 (최적화 방식) */}
        <div>
          <label className="block text-xs font-semibold text-[#8891bd] mb-2">문단 구성</label>
          <div className="grid grid-cols-2 gap-2">
            {OPTIMIZATION_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => setOptimizationMode(mode.value)}
                disabled={isLoading}
                className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 transition-all text-center min-h-[72px] ${
                  optimizationMode === mode.value
                    ? 'border-[#4f6ef7] bg-[#4f6ef7]/10 text-white'
                    : 'border-[#2a2b6e] bg-[#0b0d2b] text-[#8891bd] hover:border-[#4f6ef7]/40 active:bg-[#191970]/30'
                }`}
              >
                <span className="text-xl leading-none">{mode.icon}</span>
                <span className="text-[11px] font-bold leading-tight">{mode.label}</span>
                <span className="text-[9px] opacity-70 leading-tight">{mode.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-amber-500/15 border border-amber-500/40 rounded-xl p-3">
          <div className="flex items-start gap-2">
            <span className="text-amber-300 text-sm flex-shrink-0">⚠️</span>
            <p className="text-[11px] font-semibold text-amber-100 leading-relaxed">
              의료법 제56조 금지어 필터링 자동 적용 (완치, 최고, 100% 등 금지)
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={!keyword.trim() || isLoading}
          className="w-full py-4 bg-[#4f6ef7] hover:bg-[#3d5ef0] active:bg-[#2d4ee0] disabled:bg-[#2a2b6e] disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#4f6ef7]/20 min-h-[52px]"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              SEO 제목 생성 중...
            </>
          ) : (
            <><span>✨</span> SEO 최적화 제목 5개 생성</>
          )}
        </button>
      </form>
    </div>
  );
}
