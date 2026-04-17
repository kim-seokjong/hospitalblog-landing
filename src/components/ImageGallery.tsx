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
}



async function renderCardNews(
  image: GeneratedImage,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const SIZE = 1024;
  canvas.width = SIZE;
  canvas.height = SIZE;

  // 이미지 로드
  const proxyUrl = image.url.startsWith('data:')
    ? image.url
    : `/api/proxy-image?url=${encodeURIComponent(image.url)}`;
  const img = new window.Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = proxyUrl;
  });

  // 이미지 배경 (cover)
  const scale = Math.max(SIZE / img.width, SIZE / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);

  // 상단 우측 'AI 이미지' 뱃지
  const label = 'AI 이미지';
  ctx.font = 'bold 22px "Malgun Gothic", sans-serif';
  const textWidth = ctx.measureText(label).width;
  const padX = 16, padY = 10;
  const bw = textWidth + padX * 2;
  const bh = 38;
  const bx = SIZE - bw - 20;
  const by = 20;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 8);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + bw / 2, by + bh / 2);
}

export default function ImageGallery({ images, keyword, title, style = 'cardnews', onRegenerate, isLoading }: ImageGalleryProps) {
  const isRawStyle = style === 'photo' || style === 'upload';
  const [selected, setSelected] = useState<GeneratedImage | null>(null);
  const [editing, setEditing] = useState<GeneratedImage | null>(null);
  const [composited, setComposited] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  // 이미 합성 중인 이미지 추적 (ref로 stale closure 방지)
  const composingRef = useRef<Set<string>>(new Set());

  // images가 바뀌면 합성 상태 초기화
  useEffect(() => {
    composingRef.current = new Set();
    setComposited({});
    setLoading({});
    setSelected(null);
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
    } catch (e) {
      composingRef.current.delete(image.id); // 실패 시 재시도 허용
      console.error('카드뉴스 합성 실패:', e);
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

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center">
          <span className="text-white text-lg font-bold">4</span>
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-800">
            {style === 'cardnews' ? '카드뉴스 이미지' : style === 'upload' ? '첨부 이미지' : '실사 이미지'}
          </h2>
          <p className="text-sm text-gray-500">
            {style === 'cardnews' ? '블로그/SNS용 카드뉴스' : style === 'upload' ? '✏️ 이미지를 눌러 편집하세요' : '실제 병원/의료 사진'} {images.length}장
          </p>
        </div>
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className={isLoading ? 'animate-spin inline-block' : ''}>↺</span>
            새로고침
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {images.map((image) => {
          const displayUrl = isRawStyle
            ? (composited[image.id] || image.url)
            : composited[image.id];
          const isRendering = style === 'cardnews' && !!loading[image.id];
          const isReady = isRawStyle || !!composited[image.id];

          return (
            <div key={image.id} className="space-y-2">
              {style === 'cardnews' && (
                <canvas ref={(el) => { canvasRefs.current[image.id] = el; }} className="hidden" />
              )}

              <div
                className={`group relative rounded-xl overflow-hidden ${style === 'photo' ? 'aspect-video' : 'aspect-square'} cursor-pointer bg-gray-100`}
                onClick={() => isReady && setSelected(image)}
              >
                {isRendering && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100">
                    <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-2" />
                    <p className="text-xs text-gray-500">카드뉴스 합성 중...</p>
                  </div>
                )}

                {isReady && displayUrl && (
                  <>
                    <img
                      src={displayUrl}
                      alt={`이미지 ${image.id}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />

                    {/* 업로드 이미지: 편집 버튼 항상 표시 */}
                    {style === 'upload' && (
                      <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditing(image); }}
                          className="bg-purple-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg hover:bg-purple-700 transition-colors"
                        >
                          ✏️ 편집하기
                        </button>
                      </div>
                    )}

                    {/* 호버 버튼 */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <div className="flex gap-1.5 flex-wrap justify-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelected(image); }}
                          className="bg-white text-gray-800 text-xs font-bold px-2.5 py-1.5 rounded-lg shadow"
                        >
                          확대
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditing(image); }}
                          className="bg-purple-600 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shadow"
                        >
                          ✏️ 편집
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(image); }}
                          className="bg-indigo-600 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shadow"
                        >
                          저장
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 mt-4 text-center">
        * 블로그/SNS 마케팅 목적으로 사용하세요. 다운로드 버튼으로 PNG 저장 가능합니다.
      </p>

      {/* 확대 모달 */}
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
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-2xl overflow-hidden max-w-2xl w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={isRawStyle ? (composited[selected.id] || selected.url) : composited[selected.id]}
              alt="이미지 확대"
              className={`w-full object-cover ${style === 'photo' ? 'aspect-video' : 'aspect-square'}`}
            />
            <div className="p-4 flex items-center justify-between">
              <p className="text-xs text-gray-500">#{keyword} {style === 'photo' ? '실사 이미지' : style === 'upload' ? '첨부 이미지' : '카드뉴스'}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleDownload(selected)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-4 py-2 rounded-lg"
                >
                  ⬇ 다운로드
                </button>
                <button
                  onClick={() => setSelected(null)}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-bold px-4 py-2 rounded-lg"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
