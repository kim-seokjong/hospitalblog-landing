'use client';

import { useState, useRef } from 'react';
import type { BlogContent } from '@/types';

interface ContentPreviewProps {
  content: BlogContent;
  onGenerateImages: (count: number, style?: 'photo' | 'cardnews') => void;
  onImagesUploaded: (files: File[]) => void;
  isLoadingImages: boolean;
  imageStyle: 'photo' | 'cardnews' | 'upload';
  onImageStyleChange: (style: 'photo' | 'cardnews' | 'upload') => void;
  onGenerateSlides?: () => void;
  isLoadingSlides?: boolean;
}

export default function ContentPreview({ content, onGenerateImages, onImagesUploaded, isLoadingImages, imageStyle, onImageStyleChange, onGenerateSlides, isLoadingSlides }: ContentPreviewProps) {
  const [imageCount, setImageCount] = useState(6);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [showImageHints, setShowImageHints] = useState(false);

  const handleCopy = async () => {
    const fullText = `${content.title}\n\n${content.body}`;
    await navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const charColor =
    content.charCount >= 1500 && content.charCount <= 1800 ? 'text-green-600' :
    content.charCount >= 1200 ? 'text-amber-500' : 'text-red-500';

  const renderBody = (text: string) => {
    return text.split('\n').map((line, i) => {
      // H3 세부소제목: ▶ 로 시작
      if (line.startsWith('▶')) {
        return (
          <h3 key={i} className="text-sm font-semibold text-indigo-700 mt-3 mb-1 pl-1 border-l-2 border-indigo-300">
            {line.replace(/^▶\s*/, '')}
          </h3>
        );
      }
      // 이미지 위치 표시
      if (/^\[이미지\s*\d+:/.test(line)) {
        return (
          <div key={i} className="my-2 bg-blue-50 border border-dashed border-blue-300 rounded-lg px-3 py-2 flex items-center gap-2">
            <span className="text-blue-500 text-sm">🖼</span>
            <span className="text-xs text-blue-600 font-medium">{line.replace(/[\[\]]/g, '')}</span>
          </div>
        );
      }
      // H2 소제목: 앞뒤 빈 줄 사이의 단독 줄 (15자 이상이고 ▶ 아님)
      if (line.trim().length >= 10 && line.trim().length <= 45 && !line.startsWith('[')) {
        const prevEmpty = i === 0 || text.split('\n')[i - 1]?.trim() === '';
        if (prevEmpty) {
          return <h2 key={i} className="text-base font-bold text-gray-800 mt-5 mb-2">{line}</h2>;
        }
      }
      if (line.trim() === '') return <br key={i} />;
      return <p key={i} className="text-gray-700 leading-relaxed text-sm mb-1">{line}</p>;
    });
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
      {/* 헤더 */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
            <span className="text-white text-lg font-bold">3</span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">본문 미리보기</h2>
            <p className="text-sm text-gray-500">D.I.A+ 최적화 콘텐츠</p>
          </div>
        </div>

        {/* 통계 뱃지들 */}
        <div className="flex flex-wrap gap-2">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 ${charColor}`}>
            {content.charCount.toLocaleString()}자
            {content.charCount >= 1500 ? ' ✓' : content.charCount >= 1200 ? ' (1500+ 권장)' : ' ⚠'}
          </span>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
            H2 {content.seoAnalysis.h2Count}개
          </span>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">
            H3 {content.seoAnalysis.h3Count}개
          </span>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
            content.seoAnalysis.keywordCount >= 4 && content.seoAnalysis.keywordCount <= 6
              ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}>
            키워드 {content.seoAnalysis.keywordCount}회
          </span>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
            content.compliance.isCompliant ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {content.compliance.isCompliant ? '✅ 광고법 준수' : `⚠ 위반 ${content.compliance.violations.length}건`}
          </span>
        </div>
      </div>

      {/* 위반사항 */}
      {!content.compliance.isCompliant && (
        <div className="mx-5 mt-4 bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-xs font-bold text-red-700 mb-2">⚠️ 의료광고법 위반 감지</p>
          <div className="space-y-1.5">
            {content.compliance.violations.map((v, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`font-bold px-1.5 py-0.5 rounded ${
                  v.severity === 'CRITICAL' ? 'bg-red-200 text-red-800' :
                  v.severity === 'HIGH' ? 'bg-orange-200 text-orange-800' :
                  'bg-yellow-200 text-yellow-800'
                }`}>{v.severity}</span>
                <span className="font-bold text-red-700">{v.word}</span>
                <span className="text-gray-500">→ {v.suggestion}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 경고 */}
      {content.compliance.warnings.length > 0 && (
        <div className="mx-5 mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs font-bold text-amber-700 mb-1">⚠ 주의사항</p>
          {content.compliance.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600">• {w}</p>
          ))}
        </div>
      )}

      {/* 본문 */}
      <div className="p-5">
        <div className="bg-gray-50 rounded-xl p-5 border border-gray-200 max-h-96 overflow-y-auto">
          <h1 className="text-lg font-bold text-gray-900 mb-4 pb-3 border-b border-gray-200">{content.title}</h1>
          <div>{renderBody(content.body)}</div>
        </div>
      </div>

      {/* 이미지 가이드라인 */}
      {content.imageGuidelines.placementHints.length > 0 && (
        <div className="px-5 pb-2">
          <button
            onClick={() => setShowImageHints(!showImageHints)}
            className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            <span>{showImageHints ? '▼' : '▶'}</span>
            이미지 배치 가이드 ({content.imageGuidelines.placementHints.length}곳)
          </button>
          {showImageHints && (
            <div className="mt-2 space-y-1.5">
              {content.imageGuidelines.placementHints.map((hint, i) => (
                <div key={i} className="flex items-start gap-2 text-xs bg-blue-50 rounded-lg px-3 py-1.5">
                  <span className="text-blue-500 font-bold">🖼 {i + 1}</span>
                  <span className="text-blue-700">{hint.description}</span>
                </div>
              ))}
              <p className="text-xs text-gray-400 mt-1">
                권장 이미지: {content.imageGuidelines.recommendedCount}장 이상 (네이버 상위노출 기준)
              </p>
            </div>
          )}
        </div>
      )}

      {/* 액션 버튼 */}
      <div className="p-5 pt-3 space-y-3">
        <button
          onClick={handleCopy}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {copied ? <><span>✅</span> 복사 완료!</> : <><span>📋</span> 제목 + 본문 원클릭 복사</>}
        </button>

        <div className="border-t border-gray-100 pt-3 space-y-3">
          {/* 이미지 스타일 선택 */}
          <div>
            <p className="text-xs font-bold text-gray-600 mb-2">이미지 스타일</p>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => onImageStyleChange('photo')}
                disabled={isLoadingImages}
                className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border-2 transition-all ${
                  imageStyle === 'photo'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                }`}
              >
                <span className="text-xl">📷</span>
                <span className="text-[11px] font-bold">실사 이미지</span>
                <span className="text-[9px] text-center leading-tight opacity-70">실제 의료 사진</span>
              </button>
              <button
                onClick={() => onImageStyleChange('cardnews')}
                disabled={isLoadingImages}
                className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border-2 transition-all ${
                  imageStyle === 'cardnews'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                }`}
              >
                <span className="text-xl">🎨</span>
                <span className="text-[11px] font-bold">카드뉴스</span>
                <span className="text-[9px] text-center leading-tight opacity-70">AI 디자인 합성</span>
              </button>
              <button
                onClick={() => onImageStyleChange('upload')}
                disabled={isLoadingImages}
                className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border-2 transition-all ${
                  imageStyle === 'upload'
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                }`}
              >
                <span className="text-xl">📎</span>
                <span className="text-[11px] font-bold">직접 첨부</span>
                <span className="text-[9px] text-center leading-tight opacity-70">편집기로 꾸미기</span>
              </button>
            </div>
          </div>

          {/* 숨김 파일 인풋 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => {
              const files = Array.from(e.target.files || []);
              if (files.length > 0) onImagesUploaded(files);
              e.target.value = '';
            }}
          />

          {/* 장수 선택 (업로드 제외) */}
          {imageStyle !== 'upload' && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">권장 {content.imageGuidelines.recommendedCount}장 이상</p>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">장수:</label>
                <select
                  value={imageCount}
                  onChange={(e) => setImageCount(Number(e.target.value))}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white"
                  disabled={isLoadingImages}
                >
                  {[4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>{n}장{n === 6 ? ' (권장)' : ''}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* 액션 버튼 */}
          {imageStyle === 'upload' ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <span>📎</span> 이미지 파일 선택하기
            </button>
          ) : (
            <button
              onClick={() => onGenerateImages(imageCount, imageStyle)}
              disabled={isLoadingImages}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {isLoadingImages ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  이미지 생성 중... ({imageCount}장)
                </>
              ) : (
                <><span>{imageStyle === 'cardnews' ? '🎨' : '📷'}</span> {imageStyle === 'cardnews' ? '카드뉴스' : '실사 이미지'} {imageCount}장 생성</>
              )}
            </button>
          )}

          {/* 디자인 카드뉴스 */}
          {onGenerateSlides && (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-bold text-gray-600 mb-2">인포그래픽 카드뉴스</p>
              <button
                onClick={onGenerateSlides}
                disabled={isLoadingSlides}
                className="w-full py-3 bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {isLoadingSlides ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    슬라이드 생성 중...
                  </>
                ) : (
                  <><span>✦</span> 디자인 카드뉴스 3장 생성</>
                )}
              </button>
              <p className="text-[10px] text-gray-400 mt-1.5 text-center">표지 · 단계 · 마무리 슬라이드 · 1080×1080 PNG</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
