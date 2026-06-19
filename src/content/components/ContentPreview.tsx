'use client';

import React, { useState, useRef } from 'react';
import type { BlogContent } from '@/types';
import { toNaverFormat } from '@/content/lib/naver-format';

interface ContentPreviewProps {
  content: BlogContent;
  onGenerateImages: (count: number, style?: 'photo' | 'cardnews') => void;
  onImagesUploaded: (files: File[]) => void;
  isLoadingImages: boolean;
  imageStyle: 'photo' | 'cardnews' | 'upload';
  onImageStyleChange: (style: 'photo' | 'cardnews' | 'upload') => void;
  onGenerateSlides?: () => void;
  isLoadingSlides?: boolean;
  onContentChange?: (newBody: string) => void;
  /** 클립보드 복사 성공 시 호출 (보관함 자동 저장 등 부가 동작은 부모가 처리) */
  onCopied?: () => void;
}

export default function ContentPreview({ content, onGenerateImages, onImagesUploaded, isLoadingImages, imageStyle, onImageStyleChange, onGenerateSlides, isLoadingSlides, onContentChange, onCopied }: ContentPreviewProps) {
  const [imageCount, setImageCount] = useState(6);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [showImageHints, setShowImageHints] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState('');

  const handleCopy = async () => {
    const cleanBody = toNaverFormat(content.body);
    const fullText = `${content.title}\n\n${cleanBody}`;
    try {
      await navigator.clipboard.writeText(fullText);
    } catch {
      // 클립보드 권한 거부 등 — 복사 실패 시 완료 표시/콜백 모두 생략
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onCopied?.();
  };

  const charColor =
    content.charCount >= 1500 && content.charCount <= 1800 ? 'text-emerald-700' :
    content.charCount >= 1200 ? 'text-amber-700' : 'text-red-600';

  const violationWords = content.compliance.violations.map((v) => v.word);

  const highlightViolations = (text: string): React.ReactNode => {
    if (violationWords.length === 0) return text;
    const pattern = new RegExp(`(${violationWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    const parts = text.split(pattern);
    return parts.map((part, idx) =>
      violationWords.some((w) => w.toLowerCase() === part.toLowerCase())
        ? <mark key={idx} className="bg-red-100 text-red-700 font-bold rounded px-0.5 not-italic">{part}</mark>
        : part
    );
  };

  const renderSummaryBox = (lines: string[], keyPrefix: string): React.ReactNode => {
    const items = lines.map((l) => l.trim()).filter(Boolean);
    return (
      <div
        key={keyPrefix}
        className="my-4 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-emerald-50 p-3 sm:p-4"
      >
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-base">💡</span>
          <span className="text-xs sm:text-sm font-bold text-blue-700">핵심 요약</span>
        </div>
        <ul className="space-y-1.5">
          {items.map((s, idx) => (
            <li key={idx} className="text-xs sm:text-sm text-gray-800 leading-relaxed flex items-start gap-1.5">
              <span className="text-blue-500 mt-0.5 flex-shrink-0">•</span>
              <span>{highlightViolations(s)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const renderFaqBox = (lines: string[], keyPrefix: string): React.ReactNode => {
    const pairs: { q: string; a: string }[] = [];
    let cur: { q: string; a: string } | null = null;
    for (const raw of lines) {
      const t = raw.trim();
      if (!t) continue;
      if (/^Q\d+\./.test(t)) {
        if (cur) pairs.push(cur);
        cur = { q: t, a: '' };
      } else if (/^A\d+\./.test(t)) {
        if (cur) cur.a = t;
      } else if (cur && cur.a) {
        cur.a += ' ' + t;
      }
    }
    if (cur) pairs.push(cur);

    return (
      <div
        key={keyPrefix}
        className="my-4 rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50 p-3 sm:p-4"
      >
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-base">❓</span>
          <span className="text-xs sm:text-sm font-bold text-indigo-700">자주 묻는 질문</span>
        </div>
        <div className="space-y-3">
          {pairs.map((qa, idx) => (
            <div key={idx} className="space-y-1">
              <p className="text-xs sm:text-sm font-bold text-indigo-800">{highlightViolations(qa.q)}</p>
              <p className="text-xs sm:text-sm text-gray-800 leading-relaxed pl-3">{highlightViolations(qa.a)}</p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderBody = (text: string): React.ReactNode[] => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;
    let key = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // TL;DR 블록
      if (trimmed === '[핵심 요약]') {
        const buf: string[] = [];
        i++;
        while (i < lines.length && lines[i].trim() !== '[/핵심 요약]') {
          buf.push(lines[i]);
          i++;
        }
        i++; // skip closing tag
        elements.push(renderSummaryBox(buf, `summary-${key++}`));
        continue;
      }

      // FAQ 블록
      if (trimmed === '[자주 묻는 질문]') {
        const buf: string[] = [];
        i++;
        while (i < lines.length && lines[i].trim() !== '[/자주 묻는 질문]') {
          buf.push(lines[i]);
          i++;
        }
        i++; // skip closing tag
        elements.push(renderFaqBox(buf, `faq-${key++}`));
        continue;
      }

      // 세부 소제목 (H3)
      if (line.startsWith('▶')) {
        elements.push(
          <h3 key={`h3-${key++}`} className="text-sm font-semibold text-[#ff4628] mt-3 mb-1 pl-2 border-l-2 border-[#ff4628]/40">
            {highlightViolations(line.replace(/^▶\s*/, ''))}
          </h3>
        );
        i++;
        continue;
      }

      // 이미지 자리표시자
      if (/^\[이미지\s*\d+:/.test(line)) {
        elements.push(
          <div key={`img-${key++}`} className="my-2 bg-blue-50 border border-dashed border-blue-300 rounded-lg px-3 py-2 flex items-center gap-2">
            <span className="text-blue-600 text-sm">🖼</span>
            <span className="text-xs text-blue-700">{line.replace(/[\[\]]/g, '')}</span>
          </div>
        );
        i++;
        continue;
      }

      // 주요 소제목 (H2): 앞이 빈 줄이고 길이 10~45자, 대괄호로 시작 안 함
      if (
        trimmed.length >= 10 &&
        trimmed.length <= 45 &&
        !trimmed.startsWith('[')
      ) {
        const prevEmpty = i === 0 || lines[i - 1]?.trim() === '';
        if (prevEmpty) {
          elements.push(
            <h2 key={`h2-${key++}`} className="text-sm font-bold text-gray-900 mt-5 mb-2">
              {highlightViolations(line)}
            </h2>
          );
          i++;
          continue;
        }
      }

      // 빈 줄
      if (trimmed === '') {
        elements.push(<br key={`br-${key++}`} />);
        i++;
        continue;
      }

      // 일반 단락
      elements.push(
        <p key={`p-${key++}`} className="text-gray-800 leading-relaxed text-xs mb-1">
          {highlightViolations(line)}
        </p>
      );
      i++;
    }

    return elements;
  };

  return (
    <div className="rounded-2xl border border-[#b4bfce] bg-white overflow-hidden shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      {/* 헤더 */}
      <div className="p-4 sm:p-5 border-b border-[#b4bfce]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
            <span className="text-emerald-600 font-bold text-sm">3</span>
          </div>
          <div>
            <h2 className="text-base font-bold text-[#202020]">본문 미리보기</h2>
            <p className="text-xs text-[#5b6573]">D.I.A+ 최적화 콘텐츠</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#eef2f6] border border-[#b4bfce] ${charColor}`}>
            {content.charCount.toLocaleString()}자{content.charCount >= 1500 ? ' ✓' : ' ⚠'}
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">H2 {content.seoAnalysis.h2Count}개</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">H3 {content.seoAnalysis.h3Count}개</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            content.seoAnalysis.keywordCount >= 4 && content.seoAnalysis.keywordCount <= 6
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}>키워드 {content.seoAnalysis.keywordCount}회</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            content.compliance.isCompliant
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-red-50 text-red-600 border-red-200'
          }`}>
            {content.compliance.isCompliant ? '✅ 광고법 준수' : `⚠ 위반 ${content.compliance.violations.length}건`}
          </span>
          {content.geoAnalysis && (() => {
            const score = content.geoAnalysis.geoScore;
            const tone =
              score >= 70 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
              score >= 50 ? 'bg-amber-50 text-amber-700 border-amber-200' :
              'bg-red-50 text-red-600 border-red-200';
            return (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tone}`}>
                🤖 GEO {score}점
              </span>
            );
          })()}
        </div>
      </div>

      {/* 자동 교체 알림 */}
      {content.autoReplaced && content.autoReplaced.length > 0 && (
        <div className="mx-5 mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-[10px] font-bold text-amber-700 mb-1.5">🔄 의료광고법 위반 단어 자동 교체됨</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {content.autoReplaced.map((r, i) => (
              <span key={i} className="text-[10px] text-amber-700/80">
                <span className="line-through text-red-500 mr-1">{r.word}</span>→<span className="text-emerald-600 ml-1">{r.suggestion}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 위반사항 (자동교체 후에도 남은 경우) */}
      {!content.compliance.isCompliant && (
        <div className="mx-5 mt-4 bg-red-50 border border-red-200 rounded-xl p-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-bold text-red-600">⚠️ 의료광고법 위반 감지</p>
            <span className="text-[9px] text-red-500/70">아래 본문에서 빨간색으로 표시됨</span>
          </div>
          <div className="space-y-1">
            {content.compliance.violations.map((v, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${
                  v.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                  v.severity === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>{v.severity}</span>
                <mark className="bg-red-100 text-red-700 font-bold rounded px-0.5 not-italic">{v.word}</mark>
                <span className="text-[#5b6573]">→ {v.suggestion}(으)로 수정 권장</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {content.compliance.warnings.length > 0 && (
        <div className="mx-5 mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-[10px] font-bold text-amber-700 mb-1">⚠ 주의사항</p>
          {content.compliance.warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-700/80">• {w}</p>
          ))}
        </div>
      )}

      {/* 본문 */}
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-[#73808f]">본문 내용</span>
          {!isEditing && onContentChange && (
            <button
              onClick={() => { setEditBody(content.body); setIsEditing(true); }}
              className="text-[10px] font-bold text-[#ff4628] hover:text-[#e63a1c] px-2 py-1 rounded-lg border border-[#b4bfce] hover:border-[#ff4628]/50 transition-colors"
            >
              ✏️ 직접 편집
            </button>
          )}
        </div>
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={12}
              className="w-full px-3 py-3 rounded-xl bg-white border border-[#ff4628]/50 text-[#202020] text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-[#ff4628]/30 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { onContentChange?.(editBody); setIsEditing(false); }}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors"
              >
                저장
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="flex-1 py-2 bg-[#eef2f6] hover:bg-[#b4bfce] text-[#4a4f55] text-xs font-bold rounded-xl transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <div
            className="bg-white rounded-xl p-3 sm:p-4 border border-gray-200 max-h-72 sm:max-h-80 overflow-y-auto text-gray-800 [&_p]:!text-gray-800 [&_li]:!text-gray-800 [&_h1]:!text-gray-900 [&_h2]:!text-gray-900 [&_strong]:!text-gray-900"
            style={{ colorScheme: 'light', color: '#1f2937' }}
          >
            <h1 className="text-sm font-bold !text-gray-900 mb-3 pb-3 border-b border-gray-200">{content.title}</h1>
            <div className="!text-gray-800">{renderBody(content.body)}</div>
          </div>
        )}
      </div>

      {/* 이미지 가이드라인 */}
      {content.imageGuidelines.placementHints.length > 0 && (
        <div className="px-5 pb-2">
          <button
            onClick={() => setShowImageHints(!showImageHints)}
            className="text-[10px] font-bold text-[#ff4628] hover:text-[#e63a1c] flex items-center gap-1"
          >
            <span>{showImageHints ? '▼' : '▶'}</span>
            이미지 배치 가이드 ({content.imageGuidelines.placementHints.length}곳)
          </button>
          {showImageHints && (
            <div className="mt-2 space-y-1.5">
              {content.imageGuidelines.placementHints.map((hint, i) => (
                <div key={i} className="flex items-start gap-2 text-[10px] bg-[#eef2f6] rounded-lg px-3 py-1.5">
                  <span className="text-[#ff4628] font-bold">🖼 {i + 1}</span>
                  <span className="text-[#5b6573]">{hint.description}</span>
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

        <div className="border-t border-[#b4bfce] pt-3 space-y-3">
          <div>
            <p className="text-[10px] font-bold text-[#5b6573] mb-2">이미지 스타일</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { val: 'photo' as const, icon: '📷', label: '실사AI이미지', sub: 'AI 의료 실사' },
                { val: 'cardnews' as const, icon: '🎨', label: 'AI이미지', sub: 'Flux.1 Pro' },
                { val: 'upload' as const, icon: '📎', label: '직접 첨부', sub: '편집기로 꾸미기' },
              ].map(({ val, icon, label, sub }) => (
                <button
                  key={val}
                  onClick={() => onImageStyleChange(val)}
                  disabled={isLoadingImages}
                  className={`flex flex-col items-center gap-1 px-1 py-3 rounded-xl border-2 transition-all min-h-[72px] ${
                    imageStyle === val
                      ? 'border-[#ff4628] bg-[#ffece7] text-[#202020]'
                      : 'border-[#b4bfce] bg-white text-[#5b6573] hover:border-[#ff4628]/30'
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
              <p className="text-[10px] text-[#73808f]">권장 {content.imageGuidelines.recommendedCount}장 이상</p>
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-[#5b6573]">장수:</label>
                <select
                  value={imageCount}
                  onChange={(e) => setImageCount(Number(e.target.value))}
                  className="text-xs border border-[#b4bfce] rounded-lg px-2 py-1 bg-white text-[#202020]"
                  disabled={isLoadingImages}
                >
                  {[3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n} className="bg-white">{n}장{n === 6 ? ' (권장)' : ''}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {imageStyle === 'upload' ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm border-2 border-white/60"
            >
              <span>📎</span> 이미지 파일 선택하기
            </button>
          ) : (
            <button
              onClick={() => onGenerateImages(imageCount, imageStyle)}
              disabled={isLoadingImages}
              className="w-full py-3 sm:py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-[#b4bfce] disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm shadow-lg shadow-indigo-500/20 min-h-[48px] border-2 border-white/60"
            >
              {isLoadingImages ? (
                <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> 이미지 생성 중... ({imageCount}장)</>
              ) : (
                <><span>{imageStyle === 'cardnews' ? '🎨' : '📷'}</span> {imageStyle === 'cardnews' ? 'AI이미지' : '실사AI이미지'} {imageCount}장 생성</>
              )}
            </button>
          )}

          {onGenerateSlides && (
            <div className="border-t border-[#b4bfce] pt-3">
              <p className="text-[10px] font-bold text-[#5b6573] mb-2">인포그래픽 카드뉴스</p>
              <button
                onClick={onGenerateSlides}
                disabled={isLoadingSlides}
                className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 disabled:bg-[#b4bfce] disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm border-2 border-white/60"
              >
                {isLoadingSlides ? (
                  <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> 슬라이드 생성 중...</>
                ) : (
                  <><span>✦</span> 디자인 카드뉴스 3장 생성</>
                )}
              </button>
              <p className="text-[9px] text-[#73808f] mt-1.5 text-center">표지 · 단계 · 마무리 슬라이드 · 1080×1080 PNG</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
