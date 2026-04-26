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
    content.charCount >= 1500 && content.charCount <= 1800 ? 'text-emerald-400' :
    content.charCount >= 1200 ? 'text-amber-400' : 'text-red-400';

  const renderBody = (text: string) => {
    return text.split('\n').map((line, i) => {
      if (line.startsWith('▶')) {
        return (
          <h3 key={i} className="text-sm font-semibold text-[#4f6ef7] mt-3 mb-1 pl-2 border-l-2 border-[#4f6ef7]/40">
            {line.replace(/^▶\s*/, '')}
          </h3>
        );
      }
      if (/^\[이미지\s*\d+:/.test(line)) {
        return (
          <div key={i} className="my-2 bg-[#191970]/30 border border-dashed border-[#4f6ef7]/30 rounded-lg px-3 py-2 flex items-center gap-2">
            <span className="text-[#4f6ef7] text-sm">🖼</span>
            <span className="text-xs text-[#8891bd]">{line.replace(/[\[\]]/g, '')}</span>
          </div>
        );
      }
      if (line.trim().length >= 10 && line.trim().length <= 45 && !line.startsWith('[')) {
        const prevEmpty = i === 0 || text.split('\n')[i - 1]?.trim() === '';
        if (prevEmpty) {
          return <h2 key={i} className="text-sm font-bold text-white mt-5 mb-2">{line}</h2>;
        }
      }
      if (line.trim() === '') return <br key={i} />;
      return <p key={i} className="text-[#c5caf0] leading-relaxed text-xs mb-1">{line}</p>;
    });
  };

  return (
    <div className="rounded-2xl border border-[#2a2b6e] bg-[#12153d] overflow-hidden shadow-xl">
      {/* 헤더 */}
      <div className="p-4 sm:p-5 border-b border-[#2a2b6e]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-[#191970] border border-emerald-500/30 flex items-center justify-center">
            <span className="text-emerald-400 font-bold text-sm">3</span>
          </div>
          <div>
            <h2 className="text-base font-bold text-white">본문 미리보기</h2>
            <p className="text-xs text-[#8891bd]">D.I.A+ 최적화 콘텐츠</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#0b0d2b] border border-[#2a2b6e] ${charColor}`}>
            {content.charCount.toLocaleString()}자{content.charCount >= 1500 ? ' ✓' : ' ⚠'}
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20">H2 {content.seoAnalysis.h2Count}개</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">H3 {content.seoAnalysis.h3Count}개</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            content.seoAnalysis.keywordCount >= 4 && content.seoAnalysis.keywordCount <= 6
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
              : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
          }`}>키워드 {content.seoAnalysis.keywordCount}회</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            content.compliance.isCompliant
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
              : 'bg-red-500/10 text-red-300 border-red-500/20'
          }`}>
            {content.compliance.isCompliant ? '✅ 광고법 준수' : `⚠ 위반 ${content.compliance.violations.length}건`}
          </span>
        </div>
      </div>

      {/* 위반사항 */}
      {!content.compliance.isCompliant && (
        <div className="mx-5 mt-4 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <p className="text-xs font-bold text-red-300 mb-1.5">⚠️ 의료광고법 위반 감지</p>
          <div className="space-y-1">
            {content.compliance.violations.map((v, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${
                  v.severity === 'CRITICAL' ? 'bg-red-500/20 text-red-300' :
                  v.severity === 'HIGH' ? 'bg-orange-500/20 text-orange-300' :
                  'bg-yellow-500/20 text-yellow-300'
                }`}>{v.severity}</span>
                <span className="font-bold text-red-300">{v.word}</span>
                <span className="text-[#8891bd]">→ {v.suggestion}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {content.compliance.warnings.length > 0 && (
        <div className="mx-5 mt-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
          <p className="text-[10px] font-bold text-amber-300 mb-1">⚠ 주의사항</p>
          {content.compliance.warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-300/80">• {w}</p>
          ))}
        </div>
      )}

      {/* 본문 */}
      <div className="p-4 sm:p-5">
        <div className="bg-[#0b0d2b] rounded-xl p-3 sm:p-4 border border-[#2a2b6e] max-h-72 sm:max-h-80 overflow-y-auto">
          <h1 className="text-sm font-bold text-white mb-3 pb-3 border-b border-[#2a2b6e]">{content.title}</h1>
          <div>{renderBody(content.body)}</div>
        </div>
      </div>

      {/* 이미지 가이드라인 */}
      {content.imageGuidelines.placementHints.length > 0 && (
        <div className="px-5 pb-2">
          <button
            onClick={() => setShowImageHints(!showImageHints)}
            className="text-[10px] font-bold text-[#4f6ef7] hover:text-blue-300 flex items-center gap-1"
          >
            <span>{showImageHints ? '▼' : '▶'}</span>
            이미지 배치 가이드 ({content.imageGuidelines.placementHints.length}곳)
          </button>
          {showImageHints && (
            <div className="mt-2 space-y-1.5">
              {content.imageGuidelines.placementHints.map((hint, i) => (
                <div key={i} className="flex items-start gap-2 text-[10px] bg-[#191970]/20 rounded-lg px-3 py-1.5">
                  <span className="text-[#4f6ef7] font-bold">🖼 {i + 1}</span>
                  <span className="text-[#8891bd]">{hint.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 액션 */}
      <div className="p-4 sm:p-5 pt-3 space-y-3">
        <button
          onClick={handleCopy}
          className="w-full py-3 sm:py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm shadow-lg shadow-emerald-500/20 min-h-[48px]"
        >
          {copied ? <><span>✅</span> 복사 완료!</> : <><span>📋</span> 제목 + 본문 원클릭 복사</>}
        </button>

        <div className="border-t border-[#2a2b6e] pt-3 space-y-3">
          <div>
            <p className="text-[10px] font-bold text-[#8891bd] mb-2">이미지 스타일</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { val: 'photo' as const, icon: '📷', label: '실사 이미지', sub: '실제 의료 사진' },
                { val: 'cardnews' as const, icon: '🎨', label: '카드뉴스', sub: 'AI 디자인 합성' },
                { val: 'upload' as const, icon: '📎', label: '직접 첨부', sub: '편집기로 꾸미기' },
              ].map(({ val, icon, label, sub }) => (
                <button
                  key={val}
                  onClick={() => onImageStyleChange(val)}
                  disabled={isLoadingImages}
                  className={`flex flex-col items-center gap-1 px-1 py-3 rounded-xl border-2 transition-all min-h-[72px] ${
                    imageStyle === val
                      ? 'border-[#4f6ef7] bg-[#4f6ef7]/10 text-white'
                      : 'border-[#2a2b6e] bg-[#0b0d2b] text-[#8891bd] hover:border-[#4f6ef7]/30'
                  }`}
                >
                  <span className="text-lg">{icon}</span>
                  <span className="text-[10px] font-bold">{label}</span>
                  <span className="text-[8px] text-center opacity-70">{sub}</span>
                </button>
              ))}
            </div>
          </div>

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

          {imageStyle !== 'upload' && (
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-[#555d8a]">권장 {content.imageGuidelines.recommendedCount}장 이상</p>
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-[#8891bd]">장수:</label>
                <select
                  value={imageCount}
                  onChange={(e) => setImageCount(Number(e.target.value))}
                  className="text-xs border border-[#2a2b6e] rounded-lg px-2 py-1 bg-[#0b0d2b] text-white"
                  disabled={isLoadingImages}
                >
                  {[4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n} className="bg-[#12153d]">{n}장{n === 6 ? ' (권장)' : ''}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {imageStyle === 'upload' ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
            >
              <span>📎</span> 이미지 파일 선택하기
            </button>
          ) : (
            <button
              onClick={() => onGenerateImages(imageCount, imageStyle)}
              disabled={isLoadingImages}
              className="w-full py-3 sm:py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-[#2a2b6e] disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm shadow-lg shadow-indigo-500/20 min-h-[48px]"
            >
              {isLoadingImages ? (
                <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> 이미지 생성 중... ({imageCount}장)</>
              ) : (
                <><span>{imageStyle === 'cardnews' ? '🎨' : '📷'}</span> {imageStyle === 'cardnews' ? '카드뉴스' : '실사 이미지'} {imageCount}장 생성</>
              )}
            </button>
          )}

          {onGenerateSlides && (
            <div className="border-t border-[#2a2b6e] pt-3">
              <p className="text-[10px] font-bold text-[#8891bd] mb-2">인포그래픽 카드뉴스</p>
              <button
                onClick={onGenerateSlides}
                disabled={isLoadingSlides}
                className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 disabled:bg-[#2a2b6e] disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
              >
                {isLoadingSlides ? (
                  <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> 슬라이드 생성 중...</>
                ) : (
                  <><span>✦</span> 디자인 카드뉴스 3장 생성</>
                )}
              </button>
              <p className="text-[9px] text-[#555d8a] mt-1.5 text-center">표지 · 단계 · 마무리 슬라이드 · 1080×1080 PNG</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
