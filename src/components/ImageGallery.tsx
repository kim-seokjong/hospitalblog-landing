'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { GeneratedImage } from '@/types';
import ImageEditor from '@/components/ImageEditor';

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
  const padX = 16, padY = 10;
  const bw = textWidth + padX * 2, bh = 38;
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
  const [regenLoading, setRegenLoading] = useState<Record<string, boolean>>({});
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
      const dataUrl = canvas.toDataURL('image/png');
      setComposited((prev) => ({ ...prev, [image.id]: dataUrl }));
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
    if (style === 'upload') {
      const link = document.createElement('a');
      link.href = composited[image.id] || image.url;
      link.download = `edited-${keyword}-${image.id}.png`;
      link.click();
    } else if (style === 'photo') {
      const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(image.url)}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `photo-${keyword}-${image.id}.jpg`;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      const dataUrl = composited[image.id];
      if (!dataUrl) return;
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `cardnews-${keyword}-${image.id}.png`;
      link.click();
    }
  };

  const handleRegenerateOne = async (image: GeneratedImage) => {
    const prompt = prompts[image.id] || image.prompt;
    setRegenLoading(prev => ({ ...prev, [image.id]: true }));
    try {
      const res = await fetch('/api/regenerate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: image.id, prompt, style }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const newImage: GeneratedImage = { ...data.image, id: image.id };
      const updatedImages = images.map(img => img.id === image.id ? newImage : img);
      if (onImagesUpdate) onImagesUpdate(updatedImages);

      // re-composite if cardnews
      if (style === 'cardnews') {
        composingRef.current.delete(image.id);
        setComposited(prev => { const next = { ...prev }; delete next[image.id]; return next; });
        setTimeout(() => compose(newImage), 100);
      }
    } catch {
      // silent fail — user can retry
    } finally {
      setRegenLoading(prev => ({ ...prev, [image.id]: false }));
    }
  };

  return (
    <div className="rounded-2xl border border-[#2a2b6e] bg-[#12153d] p-5 shadow-xl">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-[#191970] border border-indigo-500/30 flex items-center justify-center">
          <span className="text-indigo-400 text-lg">🖼</span>
        </div>
        <div className="flex-1">
          <h2 className="text-base font-bold text-white">
            {style === 'cardnews' ? '카드뉴스 이미지' : style === 'upload' ? '첨부 이미지' : '실사 이미지'}
          </h2>
          <p className="text-xs text-[#8891bd]">{images.length}장 생성됨 · 개별 재생성 가능</p>
        </div>
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            disabled={isLoading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-[#191970] hover:bg-[#2a2b8e] text-indigo-300 rounded-lg transition-colors border border-indigo-500/20 disabled:opacity-40"
          >
            <span className={isLoading ? 'animate-spin inline-block' : ''}>↺</span>
            전체 재생성
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
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
                    <div className="w-7 h-7 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mb-2" style={{ borderWidth: 3 }} />
                    <p className="text-[10px] text-[#8891bd]">{isRegening ? '재생성 중...' : '합성 중...'}</p>
                  </div>
                )}

                {isReady && displayUrl && (
                  <>
                    <img
                      src={displayUrl}
                      alt={`이미지 ${image.id}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    {style === 'upload' && (
                      <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditing(image); }}
                          className="bg-purple-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-full shadow-lg"
                        >
                          ✏️ 편집
                        </button>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <div className="flex gap-1 flex-wrap justify-center">
                        <button onClick={(e) => { e.stopPropagation(); setSelected(image); }} className="bg-white text-gray-800 text-[10px] font-bold px-2 py-1 rounded-lg">확대</button>
                        <button onClick={(e) => { e.stopPropagation(); setEditing(image); }} className="bg-purple-600 text-white text-[10px] font-bold px-2 py-1 rounded-lg">편집</button>
                        <button onClick={(e) => { e.stopPropagation(); handleDownload(image); }} className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded-lg">저장</button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* 프롬프트 편집 + 개별 재생성 */}
              <div className="space-y-1.5">
                {editingPrompt === image.id ? (
                  <div className="space-y-1.5">
                    <textarea
                      value={prompts[image.id] || ''}
                      onChange={(e) => setPrompts(prev => ({ ...prev, [image.id]: e.target.value }))}
                      rows={3}
                      className="w-full px-2.5 py-2 rounded-lg bg-[#0b0d2b] border border-[#4f6ef7]/40 text-white text-[10px] focus:outline-none focus:border-[#4f6ef7] resize-none"
                      placeholder="이미지 프롬프트 직접 입력..."
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={() => { setEditingPrompt(null); handleRegenerateOne(image); }}
                        disabled={isRegening}
                        className="flex-1 py-1.5 bg-[#4f6ef7] hover:bg-[#3d5ef0] text-white text-[10px] font-bold rounded-lg transition-colors disabled:opacity-40"
                      >
                        재생성
                      </button>
                      <button
                        onClick={() => setEditingPrompt(null)}
                        className="px-2.5 py-1.5 bg-[#2a2b6e] text-[#8891bd] text-[10px] rounded-lg"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <button
                      onClick={() => setEditingPrompt(image.id)}
                      className="flex-1 py-1.5 bg-[#0b0d2b] hover:bg-[#191970] text-[#8891bd] hover:text-white text-[10px] rounded-lg border border-[#2a2b6e] transition-colors truncate px-2"
                      title={prompts[image.id] || image.prompt}
                    >
                      ✏️ 프롬프트 편집
                    </button>
                    <button
                      onClick={() => handleRegenerateOne(image)}
                      disabled={isRegening}
                      className="px-2.5 py-1.5 bg-[#191970] hover:bg-[#2a2b8e] text-indigo-300 text-[10px] rounded-lg border border-indigo-500/20 transition-colors disabled:opacity-40"
                      title="이 이미지만 재생성"
                    >
                      ↺
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-[#555d8a] mt-4 text-center">
        이미지를 클릭하면 확대 · 다운로드할 수 있습니다
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
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-[#12153d] border border-[#2a2b6e] rounded-2xl overflow-hidden max-w-2xl w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <img
              src={isRawStyle ? (composited[selected.id] || selected.url) : composited[selected.id]}
              alt="이미지 확대"
              className={`w-full object-cover ${style === 'photo' ? 'aspect-video' : 'aspect-square'}`}
            />
            <div className="p-4 flex items-center justify-between">
              <p className="text-xs text-[#8891bd]">#{keyword} {style === 'photo' ? '실사 이미지' : style === 'upload' ? '첨부 이미지' : '카드뉴스'}</p>
              <div className="flex gap-2">
                <button onClick={() => handleDownload(selected)} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-lg">⬇ 다운로드</button>
                <button onClick={() => setSelected(null)} className="bg-[#2a2b6e] hover:bg-[#3a3b8e] text-white text-xs font-bold px-4 py-2 rounded-lg">닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
