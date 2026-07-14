'use client';

import { useEffect, useRef, useState } from 'react';
import type { GeneratedImage } from '@/types';
import { renderBlogBody } from '@/content/components/BlogBodyRenderer';

interface BodyEditorModalProps {
  open: boolean;
  /** 편집 시작 시점의 본문(마커 포함 평문). */
  initialBody: string;
  /** 미리보기에서 인라인 썸네일로 매핑할 생성 이미지. */
  images?: GeneratedImage[];
  /** 제목 표시용(선택). */
  title?: string;
  /** 저장 → 부모의 onContentChange 호출 후 닫기. */
  onSave: (newBody: string) => void;
  /** 취소/X/바깥클릭 — 변경사항 폐기. */
  onClose: () => void;
}

type Mode = 'edit' | 'preview';

/** 본문에서 다음 이미지 번호(N)를 계산. 없으면 1. */
function nextImageNumber(body: string): number {
  const matches = Array.from(body.matchAll(/\[이미지\s*(\d+):/g));
  if (matches.length === 0) return 1;
  const max = matches.reduce((m, cur) => Math.max(m, parseInt(cur[1], 10) || 0), 0);
  return max + 1;
}

export default function BodyEditorModal({
  open,
  initialBody,
  images,
  title,
  onSave,
  onClose,
}: BodyEditorModalProps) {
  const [body, setBody] = useState(initialBody);
  const [mode, setMode] = useState<Mode>('edit');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dirty = body !== initialBody;

  // 열릴 때마다 최신 본문/모드로 초기화
  useEffect(() => {
    if (open) {
      setBody(initialBody);
      setMode('edit');
    }
  }, [open, initialBody]);

  // 변경사항 있으면 확인 후 닫기
  const requestClose = () => {
    if (dirty && !window.confirm('변경사항이 저장되지 않았습니다. 편집을 닫으시겠어요?')) {
      return;
    }
    onClose();
  };

  // ESC 닫기 + 스크롤 락
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // requestClose는 dirty에 의존하므로 body 변경 시 최신 핸들러 재바인딩
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, body, initialBody]);

  if (!open) return null;

  /** 현재 커서 위치에 마커를 삽입. */
  const insertSnippet = (snippet: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setBody((prev) => prev + snippet);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = body.slice(0, start) + snippet + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + snippet.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const insertSubheading = () => insertSnippet('\n▶ 소제목\n');
  const insertSummary = () => insertSnippet('\n[핵심 요약]\n• 핵심 내용을 입력하세요\n[/핵심 요약]\n');
  const insertFaq = () =>
    insertSnippet('\n[자주 묻는 질문]\nQ1. 질문을 입력하세요\nA1. 답변을 입력하세요\n[/자주 묻는 질문]\n');
  const insertImage = () => insertSnippet(`\n[이미지 ${nextImageNumber(body)}: 설명을 입력하세요]\n`);

  const toolbarBtn =
    'px-2.5 py-2 rounded-lg bg-[#eef2f6] hover:bg-[#e2e8ef] border border-[#b4bfce] text-[11px] font-bold text-[#33404f] transition-colors whitespace-nowrap min-h-[40px]';

  return (
    <div
      className="fixed inset-0 z-[110] flex items-stretch sm:items-center justify-center bg-black/85 backdrop-blur-md isolate"
      onClick={requestClose}
    >
      <div
        className="relative w-full h-full sm:h-auto sm:w-[min(1100px,90vw)] max-h-screen sm:max-h-[80vh] flex flex-col bg-[#f7f9fb] sm:rounded-2xl border-0 sm:border sm:border-[#b4bfce] shadow-2xl overflow-hidden isolate"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-[#b4bfce] bg-white">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0">✏️</span>
            <h2 className="text-sm sm:text-base font-bold text-[#202020] truncate">
              본문 직접 편집{title ? ` — ${title}` : ''}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="닫기"
            className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-lg bg-[#eef2f6] text-[#202020] hover:bg-red-500/80 hover:text-white transition-colors text-2xl leading-none font-bold border border-[#b4bfce] hover:border-red-500"
          >
            ×
          </button>
        </div>

        {/* 편집 | 미리보기 토글 */}
        <div className="flex items-center gap-2 px-4 sm:px-6 py-2.5 border-b border-[#b4bfce] bg-white">
          <div className="inline-flex rounded-lg border border-[#b4bfce] overflow-hidden">
            <button
              type="button"
              onClick={() => setMode('edit')}
              className={`px-4 py-2 text-xs font-bold transition-colors min-h-[40px] ${
                mode === 'edit'
                  ? 'bg-[#ff4628] text-white'
                  : 'bg-white text-[#5b6573] hover:bg-[#eef2f6]'
              }`}
            >
              편집
            </button>
            <button
              type="button"
              onClick={() => setMode('preview')}
              className={`px-4 py-2 text-xs font-bold transition-colors min-h-[40px] ${
                mode === 'preview'
                  ? 'bg-[#ff4628] text-white'
                  : 'bg-white text-[#5b6573] hover:bg-[#eef2f6]'
              }`}
            >
              미리보기
            </button>
          </div>
          {dirty && <span className="text-[10px] text-amber-600 font-bold">● 수정됨</span>}
        </div>

        {/* 구조 삽입 툴바 (편집 모드에서만) */}
        {mode === 'edit' && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 sm:px-6 py-2 border-b border-[#b4bfce] bg-[#f4f7fa]">
            <span className="text-[10px] text-[#73808f] font-bold mr-1">구조 삽입:</span>
            <button type="button" onClick={insertSubheading} className={toolbarBtn}>
              소제목(▶)
            </button>
            <button type="button" onClick={insertSummary} className={toolbarBtn}>
              핵심요약
            </button>
            <button type="button" onClick={insertFaq} className={toolbarBtn}>
              FAQ
            </button>
            <button type="button" onClick={insertImage} className={toolbarBtn}>
              🖼 이미지 삽입
            </button>
          </div>
        )}

        {/* 본문 영역 */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 bg-[#f7f9fb]">
          {mode === 'edit' ? (
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full min-h-[60vh] sm:min-h-[55vh] px-4 py-4 rounded-xl bg-white border border-[#ff4628]/50 text-[#202020] text-sm sm:text-base leading-relaxed focus:outline-none focus:ring-1 focus:ring-[#ff4628]/30 resize-y"
              placeholder="본문을 입력하세요. 위 구조 삽입 버튼으로 소제목·요약·FAQ·이미지 마커를 넣을 수 있어요."
            />
          ) : (
            <div
              className="bg-white rounded-xl p-4 sm:p-5 border border-gray-200 min-h-[60vh] text-gray-800 [&_p]:!text-gray-800 [&_li]:!text-gray-800 [&_h1]:!text-gray-900 [&_h2]:!text-gray-900 [&_strong]:!text-gray-900"
              style={{ colorScheme: 'light', color: '#1f2937' }}
            >
              {title && (
                <h1 className="text-base font-bold !text-gray-900 mb-3 pb-3 border-b border-gray-200">
                  {title}
                </h1>
              )}
              <div className="!text-gray-800">{renderBlogBody(body, { images })}</div>
            </div>
          )}
        </div>

        {/* 푸터 액션 */}
        <div className="flex gap-2 px-4 sm:px-6 py-3 border-t border-[#b4bfce] bg-white">
          <button
            type="button"
            onClick={() => onSave(body)}
            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-sm font-bold rounded-xl transition-colors min-h-[48px]"
          >
            저장
          </button>
          <button
            type="button"
            onClick={requestClose}
            className="flex-1 py-3 bg-[#eef2f6] hover:bg-[#b4bfce] text-[#4a4f55] text-sm font-bold rounded-xl transition-colors min-h-[48px]"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
