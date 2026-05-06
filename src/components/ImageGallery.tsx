'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { GeneratedImage } from '@/types';
import ImageEditor from '@/components/ImageEditor';
import { downloadImageReliable } from '@/lib/download-image';

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

  const proxyUrl = image.url.startsWith('data:')
    ? image.url
    : `/api/proxy-image?url=${encodeURIComponent(image.url)}`;
  const img = new window.Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = proxyUrl;
  });

  const scale = Math.max(SIZE / img.width, SIZE / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);

  const label = 'AI 이미지';
  ctx.font = 'bold 22px "Malgun Gothic", sans-serif';
  const textWidth = ctx.measureText(label).width;
  const bw = textWidth + 32, bh = 38;
  const bx = SIZE - bw - 20, by = 20;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 8);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + bw / 2, by + bh / 2);
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

  const handleDownload = async (image: GeneratedImage) => {
    try {
      if (style === 'upload') {
        const url = composited[image.id] || image.url;
        await downloadImageReliable(url, `edited-${keyword}-${image.id}`);
      } else if (style === 'photo') {
        await downloadImageReliable(image.url, `photo-${keyword}-${image.id}`);
      } else {
        const dataUrl = composited[image.id];
        if (!dataUrl) return;
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
      const res = await fetch('/api/regenerate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: image.id, prompt, style, provider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const newImage: GeneratedImage = { ...data.image, id: image.id };
      if (onImagesUpdate) onImagesUpdate(images.map(img => img.id === image.id ? newImage : img));

      composingRef.current.delete(image.id);
      setComposited(prev => { const next = { ...prev }; delete next[image.id]; return next; });
      setRegenCount(prev => ({ ...prev, [image.id]: (prev[image.id] || 0) + 1 }));

      if (style === 'cardnews') {
        setTimeout(() => compose(newImage), 100);
      }
    } catch {
      // silent — user can retry
    } finally {
      setRegenLoading(prev => ({ ...prev, [image.id]: false }));
    }
  };

  return (
    <div className="rounded-2xl border border-[#2a2b6e] bg-[#12153d] p-4 sm:p-5 shadow-xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 flex-shrink-0 rounded-xl bg-[#191970] border border-indigo-500/30 flex items-center justify-center">
          <span className="text-indigo-400 text-lg">🖼</span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-white">
            {style === 'cardnews' ? '카드뉴스 이미지' : style === 'upload' ? '첨부 이미지' : '실사 이미지'}
          </h2>
          <p className="text-xs text-[#8891bd]">{images.length}장 · 개별 재생성 가능</p>
        </div>
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            disabled={isLoading}
            className="flex items-center gap-1 px-3 py-2 text-xs font-bold bg-[#191970] hover:bg-[#2a2b8e] active:bg-[#3a3b9e] text-indigo-300 rounded-lg transition-colors border border-indigo-500/20 disabled:opacity-40 min-h-[36px]"
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
                className={`group relative rounded-xl overflow-hidden ${style === 'photo' ? 'aspect-video' : 'aspect-square'} cursor-pointer bg-[#0b0d2b]`}
                onClick={() => isReady && setSelected(image)}
              >
                {(isRendering || isRegening) && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b0d2b]/90 z-10">
                    <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-2" />
                    <p className="text-[10px] text-[#8891bd]">{isRegening ? '재생성 중...' : '합성 중...'}</p>
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
                    {(style === 'photo') && (
                      <div className="absolute top-2 right-2 bg-black/60 text-white text-[9px] font-bold px-2 py-0.5 rounded-md pointer-events-none">
                        AI이미지
                      </div>
                    )}
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
                    {/* 데스크탑 hover 버튼 */}
                    <div className="hidden sm:flex absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors items-center justify-center opacity-0 group-hover:opacity-100">
                      <div className="flex gap-1.5">
                        <button onClick={(e) => { e.stopPropagation(); setSelected(image); }} className="bg-white text-gray-800 text-[10px] font-bold px-2.5 py-1.5 rounded-lg">확대</button>
                        <button onClick={(e) => { e.stopPropagation(); setEditing(image); }} className="bg-purple-600 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg">편집</button>
                        <button onClick={(e) => { e.stopPropagation(); handleDownload(image); }} className="bg-indigo-600 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg">저장</button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* 모바일용 버튼 행 */}
              <div className="flex gap-1 sm:hidden">
                <button onClick={() => isReady && setSelected(image)} className="flex-1 py-2 bg-[#0b0d2b] text-[#8891bd] text-[11px] font-bold rounded-lg border border-[#2a2b6e] min-h-[36px]">확대</button>
                <button onClick={() => setEditing(image)} className="flex-1 py-2 bg-purple-600/20 text-purple-300 text-[11px] font-bold rounded-lg border border-purple-500/20 min-h-[36px]">편집</button>
                <button onClick={() => handleDownload(image)} className="flex-1 py-2 bg-indigo-600/20 text-indigo-300 text-[11px] font-bold rounded-lg border border-indigo-500/20 min-h-[36px]">저장</button>
              </div>

              {/* 프롬프트 편집 + 개별 재생성 */}
              {editingPrompt === image.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-lg bg-[#0b0d2b] border border-[#4f6ef7]/40 text-white text-xs focus:outline-none focus:border-[#4f6ef7] resize-none"
                    placeholder="한국어로 입력하세요&#10;예: 피부과 의사가 환자에게 시술 설명하는 장면"
                    autoFocus
                  />
                  <p className="text-[9px] text-[#555d8a]">💡 한국어 입력 가능 — Claude가 자동 번역 후 생성</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRegenerateOne(image)}
                      disabled={isRegening}
                      className="flex-1 py-2.5 bg-[#4f6ef7] hover:bg-[#3d5ef0] active:bg-[#2d4ee0] text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-40 min-h-[44px]"
                    >
                      재생성
                    </button>
                    <button
                      onClick={() => setEditingPrompt(null)}
                      className="px-4 py-2.5 bg-[#2a2b6e] text-[#8891bd] text-xs rounded-lg min-h-[44px]"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => { setEditingText(''); setEditingPrompt(image.id); }}
                    className="flex-1 py-2.5 bg-[#0b0d2b] hover:bg-[#191970] active:bg-[#2a2b6e] text-[#8891bd] hover:text-white text-[11px] rounded-lg border border-[#2a2b6e] transition-colors truncate px-2 min-h-[44px]"
                  >
                    ✏️ 프롬프트 편집
                  </button>
                  <button
                    onClick={() => handleRegenerateOne(image)}
                    disabled={isRegening}
                    className="px-3 py-2.5 bg-[#191970] hover:bg-[#2a2b8e] active:bg-[#3a3b9e] text-indigo-300 text-sm rounded-lg border border-indigo-500/20 transition-colors disabled:opacity-40 min-h-[44px] min-w-[44px]"
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

      <p className="text-[10px] text-[#555d8a] mt-4 text-center">
        이미지를 클릭하여 확대 · 다운로드
      </p>

      {editing && (
        <ImageEditor
          imageUrl={composited[editing.id] || editing.url}
          keyword={keyword}
          title={title}
          onClose={() => setEditing(null)}
          onSave={(dataUrl) => {
            setComposited(prev => ({ ...prev, [editing.id]: dataUrl }));
            setEditing(null);
          }}
        />
      )}

      {selected && (isRawStyle || composited[selected.id]) && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setSelected(null)}>
          <div
            className="bg-[#12153d] border border-[#2a2b6e] rounded-t-2xl sm:rounded-2xl overflow-hidden w-full sm:max-w-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={isRawStyle ? (composited[selected.id] || selected.url) : composited[selected.id]}
              alt="이미지 확대"
              className={`w-full object-cover ${style === 'photo' ? 'aspect-video' : 'aspect-square'} max-h-[70vh]`}
            />
            <div className="p-4 flex items-center justify-between gap-2">
              <p className="text-xs text-[#8891bd] truncate">#{keyword}</p>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => handleDownload(selected)} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2.5 rounded-lg min-h-[44px]">⬇ 다운로드</button>
                <button onClick={() => setSelected(null)} className="bg-[#2a2b6e] hover:bg-[#3a3b8e] text-white text-xs font-bold px-4 py-2.5 rounded-lg min-h-[44px]">닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
