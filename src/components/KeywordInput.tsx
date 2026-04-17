'use client';

import { useState } from 'react';

interface KeywordInputProps {
  onSubmit: (keyword: string, hospitalType: string, additionalInfo: string) => void;
  isLoading: boolean;
}

const HOSPITAL_TYPES = [
  '내과',
  '외과',
  '피부과',
  '성형외과',
  '정형외과',
  '안과',
  '이비인후과',
  '치과',
  '한의원',
  '산부인과',
  '소아과',
  '신경과',
  '정신건강의학과',
  '재활의학과',
  '가정의학과',
  '비뇨기과',
  '기타',
];

export default function KeywordInput({ onSubmit, isLoading }: KeywordInputProps) {
  const [keyword, setKeyword] = useState('');
  const [hospitalType, setHospitalType] = useState('피부과');
  const [additionalInfo, setAdditionalInfo] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim()) return;
    onSubmit(keyword.trim(), hospitalType, additionalInfo.trim());
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
          <span className="text-white text-lg font-bold">1</span>
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">키워드 입력</h2>
          <p className="text-sm text-gray-500">블로그 주제 키워드를 입력하세요</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            핵심 키워드 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="예: 레이저 토닝, 보톡스, 도수치료, 허리디스크"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-800 placeholder-gray-400"
            disabled={isLoading}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">병원 유형</label>
          <select
            value={hospitalType}
            onChange={(e) => setHospitalType(e.target.value)}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-800"
            disabled={isLoading}
          >
            {HOSPITAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            추가 정보{' '}
            <span className="text-gray-400 font-normal">(선택)</span>
          </label>
          <textarea
            value={additionalInfo}
            onChange={(e) => setAdditionalInfo(e.target.value)}
            placeholder="특별히 강조할 내용, 타겟 환자군, 주요 서비스 등을 입력하세요"
            rows={3}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-800 placeholder-gray-400 resize-none"
            disabled={isLoading}
          />
        </div>

        {/* 의료광고법 안내 */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <span className="text-amber-500 text-lg">⚠️</span>
            <div>
              <p className="text-sm font-semibold text-amber-800">의료광고법 자동 준수</p>
              <p className="text-xs text-amber-700 mt-1">
                생성된 모든 콘텐츠는 의료법 제56조에 따라 금지어 필터링이 자동 적용됩니다.
                (최고, 완치, 100%, 부작용 없음 등 금지)
              </p>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={!keyword.trim() || isLoading}
          className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors duration-200 flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              SEO 제목 생성 중...
            </>
          ) : (
            <>
              <span>✨</span> SEO 최적화 제목 5개 생성
            </>
          )}
        </button>
      </form>
    </div>
  );
}
