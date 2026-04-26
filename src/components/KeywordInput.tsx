'use client';

import { useState } from 'react';
import type { WritingStyle } from '@/types';

interface KeywordInputProps {
  onSubmit: (keyword: string, hospitalType: string, additionalInfo: string, writingStyle: WritingStyle) => void;
  isLoading: boolean;
}

const HOSPITAL_TYPES = [
  '내과', '외과', '피부과', '성형외과', '정형외과', '안과',
  '이비인후과', '치과', '한의원', '산부인과', '소아과', '신경과',
  '정신건강의학과', '재활의학과', '가정의학과', '비뇨기과', '기타',
];

const WRITING_STYLES: { value: WritingStyle; label: string; desc: string; icon: string }[] = [
  {
    value: '전문가',
    label: '전문가시점',
    desc: '의학적 전문성 강조',
    icon: '🩺',
  },
  {
    value: '고객이해',
    label: '고객이해시점',
    desc: '전문용어 없이 쉽게',
    icon: '👥',
  },
  {
    value: '사무장',
    label: '사무장시점',
    desc: '서비스·절차 중심',
    icon: '🏥',
  },
];

export default function KeywordInput({ onSubmit, isLoading }: KeywordInputProps) {
  const [keyword, setKeyword] = useState('');
  const [hospitalType, setHospitalType] = useState('피부과');
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [writingStyle, setWritingStyle] = useState<WritingStyle>('전문가');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim()) return;
    onSubmit(keyword.trim(), hospitalType, additionalInfo.trim(), writingStyle);
  };

  return (
    <div className="rounded-2xl border border-[#2a2b6e] bg-[#12153d] p-6 shadow-xl">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-[#191970] border border-[#4f6ef7]/30 flex items-center justify-center">
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
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="예: 레이저 토닝, 보톡스, 도수치료"
            className="w-full px-4 py-2.5 rounded-xl bg-[#0b0d2b] border border-[#2a2b6e] text-white placeholder-[#555d8a] text-sm focus:outline-none focus:border-[#4f6ef7] focus:ring-1 focus:ring-[#4f6ef7]/30 transition-colors"
            disabled={isLoading}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#8891bd] mb-1.5">병원 유형</label>
          <select
            value={hospitalType}
            onChange={(e) => setHospitalType(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl bg-[#0b0d2b] border border-[#2a2b6e] text-white text-sm focus:outline-none focus:border-[#4f6ef7] focus:ring-1 focus:ring-[#4f6ef7]/30 transition-colors"
            disabled={isLoading}
          >
            {HOSPITAL_TYPES.map((type) => (
              <option key={type} value={type} className="bg-[#12153d]">{type}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#8891bd] mb-1.5">
            추가 정보 <span className="text-[#555d8a] font-normal">(선택)</span>
          </label>
          <textarea
            value={additionalInfo}
            onChange={(e) => setAdditionalInfo(e.target.value)}
            placeholder="강조할 내용, 타겟 환자군, 주요 서비스 등"
            rows={2}
            className="w-full px-4 py-2.5 rounded-xl bg-[#0b0d2b] border border-[#2a2b6e] text-white placeholder-[#555d8a] text-sm focus:outline-none focus:border-[#4f6ef7] focus:ring-1 focus:ring-[#4f6ef7]/30 transition-colors resize-none"
            disabled={isLoading}
          />
        </div>

        {/* 글쓰기 말투 선택 */}
        <div>
          <label className="block text-xs font-semibold text-[#8891bd] mb-2">글쓰기 말투</label>
          <div className="grid grid-cols-3 gap-2">
            {WRITING_STYLES.map((style) => (
              <button
                key={style.value}
                type="button"
                onClick={() => setWritingStyle(style.value)}
                disabled={isLoading}
                className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all text-center ${
                  writingStyle === style.value
                    ? 'border-[#4f6ef7] bg-[#4f6ef7]/10 text-white'
                    : 'border-[#2a2b6e] bg-[#0b0d2b] text-[#8891bd] hover:border-[#4f6ef7]/40'
                }`}
              >
                <span className="text-lg">{style.icon}</span>
                <span className="text-[11px] font-bold leading-tight">{style.label}</span>
                <span className="text-[9px] opacity-70 leading-tight">{style.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
          <div className="flex items-start gap-2">
            <span className="text-amber-400 text-sm">⚠️</span>
            <p className="text-[10px] text-amber-300/80 leading-relaxed">
              의료법 제56조 금지어 필터링 자동 적용 (완치, 최고, 100% 등 금지)
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={!keyword.trim() || isLoading}
          className="w-full py-3 bg-[#4f6ef7] hover:bg-[#3d5ef0] disabled:bg-[#2a2b6e] disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#4f6ef7]/20"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
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
