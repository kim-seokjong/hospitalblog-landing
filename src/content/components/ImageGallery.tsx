'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { GeneratedImage } from '@/types';
import ImageEditor from '@/content/components/ImageEditor';
import { downloadImageReliable } from '@/content/lib/download-image';
import { loadImageForCanvas, composeImageWithProvenance, embedProvenanceInPngDataUrl } from '@/content/lib/ai-image-provenance';
import { safeFetchJson } from '@/content/lib/safe-fetch';

interface ImageGalleryProps {
  images: GeneratedImage[];
  keyword: string;
  title: string;
  style?: 'photo' | 'cardnews' | 'upload';
  onRegenerate?: () => void;
  isLoading?: boolean;
  onImagesUpdate?: (images: GeneratedImage[]) => void;
}

async function renderCardNews(image: GeneratedImage, canvas: HTMLCanvasElement): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const SIZE = 1024;
  canvas.width = SIZE;
  canvas.height = SIZE;

  const img = await loadImageForCanvas(image.url);
  const scale = Math.max(SIZE / img.width, SIZE / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);
  // 시각 라벨은 그리지 않는다 — AI 출처는 다운로드 시 PNG 메타데이터로만 표시.
}

export default function ImageGallery({ images, keyword, title, style = 'cardnews', onRegenerate, isLoading, onImagesUpdate }: ImageGalleryProps) {
  const isRawStyle = style === 'photo' || style === 'upload';
  const [selected, setSelected] = useState<GeneratedImage | null>(null);
  const [editing, setEditing] = useState<GeneratedImage | null>(null);
  const [composited, setComposited] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [regenLoading, setRegenLoading] = useState<Record<string, boolean>>({});
  const [regenCount, setRegenCount] = useState<Record<string, number>>({});
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const composingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    composingRef.current = new Set();
    setComposited({});
    setLoading({});
    setSelected(null);
    const initialPrompts: Record<string, string> = {};
    images.forEach(img => { initialPrompts[img.id] = img.prompt; });
    setPrompts(initialPrompts);
  }, [images]);

  const compose = useCallback(async (image: GeneratedImage) => {
    const canvas = canvasRefs.current[image.id];
    if (!canvas || composingRef.current.has(image.id)) return;
    composingRef.current.add(image.id);
    setLoading((prev) => ({ ...prev, [image.id]: true }));
    try {
      await renderCardNews(image, canvas);
      setComposited((prev) => ({ ...prev, [image.id]: canvas.toDataURL('image/png') }));
    } catch {
      composingRef.current.delete(image.id);
    } finally {
      setLoading((prev) => ({ ...prev, [image.id]: false }));
    }
  }, []);

  useEffect(() => {
    if (style === 'cardnews') images.forEach(img => compose(img));
  }, [images, compose, style]);

  // 라이트박스가 열려 있을 때만 ESC 닫기 + body 스크롤 잠금
  // (AnalysisModal 과 동일 패턴 — 단순 state 토글이라 라우팅·history 변경 없음)
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [selected]);

  const handleDownload = async (image: GeneratedImage) => {
    try {
      if (style === 'upload') {
        const url = composited[image.id] || image.url;
        await downloadImageReliable(url, `edited-${keyword}-${image.id}`);
      } else if (style === 'photo') {
        // 시각 라벨 없이, AI 출처 메타데이터를 삽입해 다운로드
        const dataUrl = await composeImageWithProvenance(image.url);
        await downloadImageReliable(dataUrl, `photo-${keyword}-${image.id}`);
      } else {
        const composedUrl = composited[image.id];
        if (!composedUrl) return;
        // 카드뉴스 캔버스 PNG에 AI 출처 메타데이터 삽입 후 다운로드
        const dataUrl = embedProvenanceInPngDataUrl(composedUrl);
        await downloadImageReliable(dataUrl, `cardnews-${keyword}-${image.id}`);
      }
    } catch {
      // fallback은 헬퍼 내부에서 새 탭으로 열어줌
    }
  };

  const handleRegenerateOne = async (image: GeneratedImage) => {
    const prompt = editingText.trim() || image.prompt;
    setRegenLoading(prev => ({ ...prev, [image.id]: true }));
    setEditingPrompt(null);

    const provider = 'openai';

    try {
      // safeFetchJson 으로 감싸 Vercel HTML 504/500 같은 비-JSON 응답이 와도
      // JSON.parse 예외 ("Unexpected token 'A', \"An error o\"...") 가 컴포넌트로
      // 전파되지 않게 한다.
      const result = await safeFetchJson<{ image: GeneratedImage; translatedPrompt?: string }>(
        '/api/regenerate-image',
        {
          method: 'POST',
          body: JSON.stringify({ imageId: image.id, prompt, style, provider }),
        }
      );
      if (!result.ok) {
        // 사용자에게 표시할 채널이 없는 컴포넌트라 콘솔로만 남기고 조용히 종료
        console.error('[ImageGallery] regenerate failed:', result.error);
        return;
      }

      const newImage: GeneratedImage = { ...result.data.image, id: image.id };
      if (onImagesUpdate) onImagesUpdate(images.map(img => img.id === image.id ? newImage : img));

      composingRef.current.delete(image.id);
      setComposited(prev => { const next = { ...prev }; delete next[image.id]; return next; });
      setRegenCount(prev => ({ ...prev, [image.id]: (prev[image.id] || 0) + 1 }));

      if (style === 'cardnews') {
        setTimeout(() => compose(newImage), 100);
      }
    } catch (err) {
      // 네트워크 단절 등 — silent — user can retry
      console.error('[ImageGallery] regenerate threw:', err);
    } finally {
      setRegenLoading(prev => ({ ...prev, [image.id]: false }));
    }
  };

  return (
    <div className="rounded-2xl border border-[#b4bfce] bg-white p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 flex-shrink-0 rounded-xl bg-[#ffece7] border border-[#ff4628]/30 flex items-center justify-center">
          <span className="text-[#ff4628] text-lg">🖼</span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-[#202020]">
            {style === 'cardnews' ? '카드뉴스 이미지' : style === 'upload' ? '첨부 이미지' : '실사 이미지'}
          </h2>
          <p className="text-xs text-[#5b6573]">{images.length}장 · 개별 재생성 가능</p>
        </div>
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            disabled={isLoading}
            className="flex items-center gap-1 px-3 py-2 text-xs font-bold bg-[#eef2f6] hover:bg-[#e2e8ef] active:bg-[#d6dee7] text-[#ff4628] rounded-lg transition-colors border border-[#ff4628]/20 disabled:opacity-40 min-h-[36px]"
          >
            <span className={isLoading ? 'animate-spin inline-block' : ''}>↺</span>
            <span className="hidden sm:inline">전체 재생성</span>
          </button>
        )}
      </div>

      {/* 이미지 그리드: 모바일 1열, sm 이상 2열 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {images.map((image) => {
          const displayUrl = isRawStyle ? (composited[image.id] || image.url) : composited[image.id];
          const isRendering = style === 'cardnews' && !!loading[image.id];
          const isReady = isRawStyle || !!composited[image.id];
          const isRegening = !!regenLoading[image.id];

          return (
            <div key={image.id} className="space-y-2">
              {style === 'cardnews' && (
                <canvas ref={(el) => { canvasRefs.current[image.id] = el; }} className="hidden" />
              )}

              <div
                className={`group relative rounded-xl overflow-hidden ${style === 'photo' ? 'aspect-video' : 'aspect-square'} cursor-pointer bg-[#eef2f6]`}
                onClick={() => isReady && setSelected(image)}
              >
                {(isRendering || isRegening) && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 z-10">
                    <div className="w-7 h-7 border-2 border-[#ff4628] border-t-transparent rounded-full animate-spin mb-2" />
                    <p className="text-[10px] text-[#5b6573]">{isRegening ? '재생성 중...' : '합성 중...'}</p>
                  </div>
                )}

                {isReady && displayUrl && (
                  <>
                    <img
                      key={`${image.id}-${regenCount[image.id] || 0}`}
                      src={displayUrl}
                      alt={`이미지 ${image.id}`}
                      className="w-full h-full object-cover"
                    />
                    {/* AI 시각 라벨 제거(2026-07-09): 출처는 다운로드 PNG 메타데이터로만 표시 */}
                    {style === 'upload' && (
                      <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditing(image); }}
                          className="bg-purple-600 text-white text-[10px] font-bold px-3 py-2 rounded-full shadow-lg min-h-[36px]"
                        >
                          ✏️ 편집
                        </button>
                      </div>
                    )}
                    {/* 데스크탑 hover 버튼: 사진 위에서도 가독성 확보 — 각 버튼을 다크 pill chip 으로 분리 */}
                    <div className="hidden sm:flex absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors items-center justify-center opacity-0 group-hover:opacity-100">
                      <div className="flex gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelected(image); }}
                          className="bg-white/95 text-[#202020] text-[11px] font-bold px-2.5 py-1 rounded-full ring-1 ring-[#b4bfce] shadow-lg hover:bg-[#eef2f6] transition-colors"
                        >확대</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditing(image); }}
                          className="bg-white/95 text-[#202020] text-[11px] font-bold px-2.5 py-1 rounded-full ring-1 ring-[#b4bfce] shadow-lg hover:bg-[#eef2f6] transition-colors"
                        >편집</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(image); }}
                          className="bg-white/95 text-[#202020] text-[11px] font-bold px-2.5 py-1 rounded-full ring-1 ring-[#b4bfce] shadow-lg hover:bg-[#eef2f6] transition-colors"
                        >저장</button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* 모바일용 버튼 행 */}
              <div className="flex gap-1 sm:hidden">
                <button onClick={() => isReady && setSelected(image)} className="flex-1 py-2 bg-[#eef2f6] text-[#4a4f55] text-[11px] font-bold rounded-lg border border-[#b4bfce] min-h-[36px]">확대</button>
                <button onClick={() => setEditing(image)} className="flex-1 py-2 bg-purple-50 text-purple-700 text-[11px] font-bold rounded-lg border border-purple-200 min-h-[36px]">편집</button>
                <button onClick={() => handleDownload(image)} className="flex-1 py-2 bg-[#ffece7] text-[#ff4628] text-[11px] font-bold rounded-lg border border-[#ff4628]/20 min-h-[36px]">저장</button>
              </div>

              {/* 프롬프트 편집 + 개별 재생성 */}
              {editingPrompt === image.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-[#ff4628]/40 text-[#202020] text-xs focus:outline-none focus:border-[#ff4628] resize-none"
                    placeholder="한국어로 입력하세요&#10;예: 피부과 의사가 환자에게 시술 설명하는 장면"
                    autoFocus
                  />
                  <p className="text-[9px] text-[#73808f]">💡 한국어 입력 가능 — Claude가 자동 번역 후 생성</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRegenerateOne(image)}
                      disabled={isRegening}
                      className="flex-1 py-2.5 bg-[#ff4628] hover:bg-[#e63a1c] active:bg-[#cc3318] text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-40 min-h-[44px]"
                    >
                      재생성
                    </button>
                    <button
                      onClick={() => setEditingPrompt(null)}
                      className="px-4 py-2.5 bg-[#eef2f6] text-[#5b6573] text-xs rounded-lg min-h-[44px]"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => { setEditingText(''); setEditingPrompt(image.id); }}
                    className="flex-1 py-2.5 bg-[#eef2f6] hover:bg-[#e2e8ef] active:bg-[#d6dee7] text-[#5b6573] hover:text-[#202020] text-[11px] rounded-lg border border-[#b4bfce] transition-colors truncate px-2 min-h-[44px]"
                  >
                    ✏️ 프롬프트 편집
                  </button>
                  <button
                    onClick={() => handleRegenerateOne(image)}
                    disabled={isRegening}
                    className="px-3 py-2.5 bg-[#ffece7] hover:bg-[#ffded5] active:bg-[#ffd0c3] text-[#ff4628] text-sm rounded-lg border border-[#ff4628]/20 transition-colors disabled:opacity-40 min-h-[44px] min-w-[44px]"
                    title="이 이미지만 재생성"
                  >
                    ↺
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-[#73808f] mt-4 text-center">
        이미지를 클릭하여 확대 · 다운로드
      </p>

      {editing && (
        <ImageEditor
          imageUrl={composited[editing.id] || editing.url}
          keyword={keyword}
          title={title}
          isAIGenerated={style === 'photo' || style === 'cardnews'}
          onClose={() => setEditing(null)}
          onSave={(dataUrl) => {
            setComposited(prev => ({ ...prev, [editing.id]: dataUrl }));
            setEditing(null);
          }}
        />
      )}

      {selected && (isRawStyle || composited[selected.id]) && (
        <div
          className="fixed inset-0 bg-black/85 backdrop-blur-md z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4 isolate"
          onClick={() => setSelected(null)}
          role="dialog"
          aria-modal="true"
          aria-label="이미지 확대"
        >
          <div
            className="relative bg-white border border-[#b4bfce] rounded-t-2xl sm:rounded-2xl overflow-hidden w-full sm:max-w-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 우상단 X 닫기 버튼 — 44×44 터치영역, 사진 위 가독성 위해 어두운 chip 유지 */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSelected(null); }}
              aria-label="닫기"
              className="absolute top-2 right-2 sm:top-3 sm:right-3 z-20 w-11 h-11 flex items-center justify-center rounded-full bg-black/55 hover:bg-red-500/80 text-white text-2xl leading-none font-bold border border-white/20 hover:border-red-500 backdrop-blur-sm shadow-lg transition-colors"
            >
              ×
            </button>
            <div className="relative">
              <img
                src={isRawStyle ? (composited[selected.id] || selected.url) : composited[selected.id]}
                alt="이미지 확대"
                className={`w-full object-cover ${style === 'photo' ? 'aspect-video' : 'aspect-square'} max-h-[70vh]`}
              />
              {/* AI 시각 라벨 제거(2026-07-09): 출처는 다운로드 PNG 메타데이터로만 표시 */}
            </div>
            <div className="p-4 flex items-center justify-between gap-2">
              <p className="text-xs text-[#5b6573] truncate">#{keyword}</p>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => handleDownload(selected)} className="bg-[#ff4628] hover:bg-[#e63a1c] text-white text-xs font-bold px-4 py-2.5 rounded-lg min-h-[44px]">⬇ 다운로드</button>
                <button onClick={() => setSelected(null)} className="bg-[#eef2f6] hover:bg-[#e2e8ef] text-[#202020] text-xs font-bold px-4 py-2.5 rounded-lg min-h-[44px]">닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
