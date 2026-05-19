'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface TextElement {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  bold: boolean;
  fontFamily: string;
  shadow: boolean;
  align: 'left' | 'center' | 'right';
}

interface ImageEditorProps {
  imageUrl: string;
  keyword: string;
  title: string;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}

const CANVAS_SIZE = 1024;
const DISPLAY_SIZE = 540;

const TEMPLATES = [
  { id: 'none', name: '없음' },
  { id: 'cardnews', name: '카드뉴스' },
  { id: 'top', name: '상단 배너' },
  { id: 'dark', name: '다크 오버레이' },
  { id: 'gradient', name: '그라데이션' },
];

function applyTemplate(
  ctx: CanvasRenderingContext2D,
  id: string,
  w: number,
  h: number,
  keyword: string,
  title: string
) {
  if (id === 'none') return;

  if (id === 'cardnews') {
    const barH = h * 0.29;
    const grad = ctx.createLinearGradient(0, h - barH - 100, 0, h);
    grad.addColorStop(0, 'rgba(30,55,55,0)');
    grad.addColorStop(0.35, 'rgba(30,55,55,0.85)');
    grad.addColorStop(1, 'rgba(30,55,55,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1e3737';
    ctx.fillRect(0, h - barH, w, barH);

    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(w * 0.05, h - barH + h * 0.025, w * 0.9, 1);

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `400 ${w * 0.018}px "Malgun Gothic", sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`#${keyword}`, w * 0.05, h - barH + h * 0.06);

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${w * 0.034}px "Malgun Gothic", sans-serif`;
    let line = '';
    let y = h - barH + h * 0.118;
    for (const ch of title) {
      const test = line + ch;
      if (ctx.measureText(test).width > w * 0.88 && line) {
        ctx.fillText(line, w * 0.05, y);
        y += w * 0.047;
        line = ch;
      } else line = test;
    }
    if (line) ctx.fillText(line, w * 0.05, y);
  }

  if (id === 'top') {
    ctx.fillStyle = 'rgba(30,55,55,0.88)';
    ctx.fillRect(0, 0, w, h * 0.16);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${w * 0.042}px "Malgun Gothic", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(keyword, w / 2, h * 0.105);
    ctx.textAlign = 'left';
  }

  if (id === 'dark') {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, w, h);
  }

  if (id === 'gradient') {
    const grad = ctx.createLinearGradient(0, h * 0.5, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}

export default function ImageEditor({ imageUrl, keyword, title, onClose, onSave }: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [texts, setTexts] = useState<TextElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [template, setTemplate] = useState('none');
  const [dragging, setDragging] = useState<{ id: string; sx: number; sy: number; ox: number; oy: number } | null>(null);

  // 배경 이미지 로드
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setBgImage(img);
    img.src = imageUrl.startsWith('data:')
      ? imageUrl
      : `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
  }, [imageUrl]);

  // 캔버스 렌더링
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bgImage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = CANVAS_SIZE, h = CANVAS_SIZE;

    const scale = Math.max(w / bgImage.width, h / bgImage.height);
    const dw = bgImage.width * scale;
    const dh = bgImage.height * scale;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bgImage, (w - dw) / 2, (h - dh) / 2, dw, dh);
    applyTemplate(ctx, template, w, h, keyword, title);
  }, [bgImage, template, keyword, title]);

  useEffect(() => { render(); }, [render]);

  const addText = () => {
    const t: TextElement = {
      id: `t${Date.now()}`,
      text: '텍스트 입력',
      x: 50, y: 40,
      fontSize: 48,
      color: '#ffffff',
      bold: true,
      fontFamily: '"Malgun Gothic", sans-serif',
      shadow: true,
      align: 'center',
    };
    setTexts(p => [...p, t]);
    setSelectedId(t.id);
  };

  const updateText = (id: string, updates: Partial<TextElement>) =>
    setTexts(p => p.map(t => t.id === id ? { ...t, ...updates } : t));

  const deleteSelected = () => {
    if (!selectedId) return;
    setTexts(p => p.filter(t => t.id !== selectedId));
    setSelectedId(null);
  };

  // 드래그
  const onMouseDown = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(id);
    const t = texts.find(t => t.id === id);
    if (!t) return;
    setDragging({ id, sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y });
  };

  useEffect(() => {
    if (!dragging) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const onMove = (e: MouseEvent) => {
      const dx = ((e.clientX - dragging.sx) / rect.width) * 100;
      const dy = ((e.clientY - dragging.sy) / rect.height) * 100;
      updateText(dragging.id, {
        x: Math.max(0, Math.min(98, dragging.ox + dx)),
        y: Math.max(2, Math.min(98, dragging.oy + dy)),
      });
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  // 저장: 캔버스 + 텍스트 합성
  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !bgImage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = CANVAS_SIZE, h = CANVAS_SIZE;
    const scale = Math.max(w / bgImage.width, h / bgImage.height);
    const dw = bgImage.width * scale;
    const dh = bgImage.height * scale;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bgImage, (w - dw) / 2, (h - dh) / 2, dw, dh);
    applyTemplate(ctx, template, w, h, keyword, title);

    texts.forEach(t => {
      ctx.save();
      if (t.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
      }
      ctx.font = `${t.bold ? 'bold' : '400'} ${t.fontSize}px ${t.fontFamily}`;
      ctx.fillStyle = t.color;
      ctx.textAlign = t.align;
      const px = (t.x / 100) * w;
      const py = (t.y / 100) * h;
      ctx.fillText(t.text, px, py);
      ctx.restore();
    });

    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `edited-${keyword}.png`;
    link.click();
  };

  const selected = texts.find(t => t.id === selectedId);
  const ratio = DISPLAY_SIZE / CANVAS_SIZE;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3" onClick={() => { setSelectedId(null); setEditingId(null); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden" style={{ maxHeight: '95vh' }} onClick={e => e.stopPropagation()}>

        {/* 툴바 */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex-wrap">
          <span className="text-sm font-bold text-gray-800 mr-1">✏️ 이미지 편집기</span>
          <button onClick={addText} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700">＋ 텍스트</button>
          {selectedId && <button onClick={deleteSelected} className="px-3 py-1.5 bg-red-500 text-white text-xs font-bold rounded-lg hover:bg-red-600">🗑 삭제</button>}
          <div className="flex items-center gap-1.5 ml-1">
            <span className="text-xs text-gray-500 font-bold">템플릿:</span>
            {TEMPLATES.map(t => (
              <button key={t.id} onClick={() => setTemplate(t.id)}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors ${template === t.id ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {t.name}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            <button onClick={handleSave} className="px-4 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700">⬇ 저장 & 다운로드</button>
            <button onClick={onClose} className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs font-bold rounded-lg hover:bg-gray-300">닫기</button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* 캔버스 영역 */}
          <div className="flex-1 flex items-center justify-center bg-gray-300 p-4">
            <div ref={containerRef} className="relative shadow-2xl" style={{ width: DISPLAY_SIZE, height: DISPLAY_SIZE }}>
              <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE}
                style={{ width: DISPLAY_SIZE, height: DISPLAY_SIZE, display: 'block' }} />

              {texts.map(t => (
                <div key={t.id}
                  style={{
                    position: 'absolute',
                    left: `${t.x}%`,
                    top: `${t.y}%`,
                    transform: 'translate(-50%, -50%)',
                    cursor: dragging?.id === t.id ? 'grabbing' : 'grab',
                    userSelect: 'none',
                    outline: selectedId === t.id ? '2px dashed #6366f1' : 'none',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: selectedId === t.id ? 'rgba(99,102,241,0.12)' : 'transparent',
                    textAlign: t.align,
                  }}
                  onMouseDown={e => onMouseDown(e, t.id)}
                  onDoubleClick={e => { e.stopPropagation(); setEditingId(t.id); }}
                >
                  {editingId === t.id ? (
                    <input autoFocus value={t.text}
                      onChange={e => updateText(t.id, { text: e.target.value })}
                      onBlur={() => setEditingId(null)}
                      onKeyDown={e => e.key === 'Enter' && setEditingId(null)}
                      style={{
                        background: 'rgba(0,0,0,0.3)', border: 'none', outline: 'none',
                        fontFamily: t.fontFamily, fontSize: t.fontSize * ratio,
                        color: t.color, fontWeight: t.bold ? 'bold' : 'normal',
                        width: 220, textShadow: t.shadow ? '1px 1px 4px rgba(0,0,0,0.7)' : 'none',
                        borderRadius: 4, padding: '0 4px',
                      }} />
                  ) : (
                    <span style={{
                      fontFamily: t.fontFamily, fontSize: t.fontSize * ratio,
                      color: t.color, fontWeight: t.bold ? 'bold' : 'normal',
                      whiteSpace: 'nowrap', display: 'block',
                      textShadow: t.shadow ? '1px 1px 6px rgba(0,0,0,0.7)' : 'none',
                    }}>{t.text}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 속성 패널 */}
          <div className="w-52 border-l border-gray-200 bg-white p-4 overflow-y-auto flex-shrink-0">
            {selected ? (
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-700 border-b pb-1.5">텍스트 속성</p>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">내용</label>
                  <input value={selected.text} onChange={e => updateText(selected.id, { text: e.target.value })}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">크기: {selected.fontSize}px</label>
                  <input type="range" min={12} max={150} value={selected.fontSize}
                    onChange={e => updateText(selected.id, { fontSize: Number(e.target.value) })}
                    className="w-full" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">색상</label>
                  <input type="color" value={selected.color}
                    onChange={e => updateText(selected.id, { color: e.target.value })}
                    className="w-full h-8 rounded cursor-pointer border border-gray-200" />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button onClick={() => updateText(selected.id, { bold: !selected.bold })}
                    className={`py-1.5 text-xs font-bold rounded-lg ${selected.bold ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    B 굵게
                  </button>
                  <button onClick={() => updateText(selected.id, { shadow: !selected.shadow })}
                    className={`py-1.5 text-xs font-bold rounded-lg ${selected.shadow ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    그림자
                  </button>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">정렬</label>
                  <div className="flex gap-1">
                    {(['left', 'center', 'right'] as const).map(a => (
                      <button key={a} onClick={() => updateText(selected.id, { align: a })}
                        className={`flex-1 py-1 text-xs rounded-lg ${selected.align === a ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                        {a === 'left' ? '좌' : a === 'center' ? '중' : '우'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">폰트</label>
                  <select value={selected.fontFamily}
                    onChange={e => updateText(selected.id, { fontFamily: e.target.value })}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5">
                    <option value='"Malgun Gothic", sans-serif'>맑은 고딕</option>
                    <option value='"Apple SD Gothic Neo", sans-serif'>Apple SD Gothic</option>
                    <option value='Georgia, serif'>Georgia</option>
                    <option value='"Arial", sans-serif'>Arial</option>
                    <option value='"Times New Roman", serif'>Times New Roman</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="text-center text-xs text-gray-400 mt-10 space-y-3">
                <div className="text-4xl">🖊️</div>
                <p className="font-medium text-gray-500">텍스트를 선택하세요</p>
                <p className="text-[11px] leading-relaxed">
                  • ＋텍스트로 추가<br />
                  • 드래그로 이동<br />
                  • 더블클릭으로 수정<br />
                  • 우측 패널에서 편집
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
