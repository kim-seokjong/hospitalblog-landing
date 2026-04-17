'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { CardNewsData, SlideStyleConfig } from '@/types';

interface Props {
  data: CardNewsData;
  keyword: string;
}

// ─── Canvas size ─────────────────────────────────────────────────────────────
const S = 1080;
const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

// ─── Built-in style presets ───────────────────────────────────────────────────
const STYLE_PRESETS: SlideStyleConfig[] = [
  {
    name: '스카이 블루',
    emoji: '🩵',
    bgGradient: ['#6EC8F2', '#44A8D8'],
    accentColor: '#FFD900',
    accentTextColor: '#1B3A6B',
    mainTextColor: '#FFFFFF',
    subTextColor: 'rgba(255,255,255,0.82)',
    boxFillColor: 'rgba(255,255,255,0.22)',
    infoBgColor: 'rgba(0,40,100,0.52)',
    decorColor: 'rgba(255,255,255,0.18)',
    dividerColor: 'rgba(255,255,255,0.40)',
    tagBgColor: 'rgba(255,255,255,0.28)',
  },
  {
    name: '다크 럭셔리',
    emoji: '🖤',
    bgGradient: ['#1A1A2E', '#16213E'],
    accentColor: '#D4AF37',
    accentTextColor: '#1A1A2E',
    mainTextColor: '#FFFFFF',
    subTextColor: 'rgba(255,255,255,0.75)',
    boxFillColor: 'rgba(212,175,55,0.18)',
    infoBgColor: 'rgba(0,0,0,0.60)',
    decorColor: 'rgba(212,175,55,0.14)',
    dividerColor: 'rgba(212,175,55,0.42)',
    tagBgColor: 'rgba(212,175,55,0.22)',
  },
  {
    name: '클린 화이트',
    emoji: '🤍',
    bgGradient: ['#F0F8FF', '#DBEEFF'],
    accentColor: '#2D7DD2',
    accentTextColor: '#FFFFFF',
    mainTextColor: '#1A3A5C',
    subTextColor: 'rgba(26,58,92,0.70)',
    boxFillColor: 'rgba(45,125,210,0.12)',
    infoBgColor: 'rgba(45,125,210,0.18)',
    decorColor: 'rgba(45,125,210,0.10)',
    dividerColor: 'rgba(45,125,210,0.35)',
    tagBgColor: 'rgba(45,125,210,0.14)',
  },
  {
    name: '로즈 핑크',
    emoji: '🩷',
    bgGradient: ['#FF8FAB', '#C9184A'],
    accentColor: '#FFE5EE',
    accentTextColor: '#C9184A',
    mainTextColor: '#FFFFFF',
    subTextColor: 'rgba(255,255,255,0.82)',
    boxFillColor: 'rgba(255,255,255,0.22)',
    infoBgColor: 'rgba(100,0,30,0.55)',
    decorColor: 'rgba(255,255,255,0.18)',
    dividerColor: 'rgba(255,229,238,0.45)',
    tagBgColor: 'rgba(255,255,255,0.28)',
  },
  {
    name: '포레스트',
    emoji: '🌿',
    bgGradient: ['#1B4332', '#40916C'],
    accentColor: '#B7E4C7',
    accentTextColor: '#1B4332',
    mainTextColor: '#FFFFFF',
    subTextColor: 'rgba(255,255,255,0.82)',
    boxFillColor: 'rgba(183,228,199,0.20)',
    infoBgColor: 'rgba(0,40,20,0.55)',
    decorColor: 'rgba(183,228,199,0.18)',
    dividerColor: 'rgba(183,228,199,0.42)',
    tagBgColor: 'rgba(183,228,199,0.22)',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const char of text) {
    const test = current + char;
    if (ctx.measureText(test).width > maxWidth && current.length > 0) {
      lines.push(current);
      current = char;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function roundFill(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number, color: string,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

// ─── Base drawing (background + decorations) ─────────────────────────────────
async function drawBase(
  ctx: CanvasRenderingContext2D,
  style: SlideStyleConfig,
  bgPhoto?: HTMLImageElement | null,
  overlayAlpha = 0.72,
) {
  if (bgPhoto) {
    // Draw photo cover-fit
    const scale = Math.max(S / bgPhoto.width, S / bgPhoto.height);
    const dw = bgPhoto.width * scale;
    const dh = bgPhoto.height * scale;
    ctx.drawImage(bgPhoto, (S - dw) / 2, (S - dh) / 2, dw, dh);
    // Gradient overlay
    const grad = ctx.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, hexToRgba(style.bgGradient[0], overlayAlpha));
    grad.addColorStop(1, hexToRgba(style.bgGradient[1], overlayAlpha + 0.1));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, style.bgGradient[0]);
    grad.addColorStop(1, style.bgGradient[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
  }

  // Decorative bubble circles
  ctx.save();
  const bubbles: [number, number, number][] = [
    [45, 38, 68], [148, 10, 50], [238, 64, 56], [14, 140, 40],
    [S - 52, 30, 60], [S - 158, 8, 52], [S - 248, 68, 62], [S - 18, 145, 40],
  ];
  for (const [x, y, r] of bubbles) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = style.decorColor;
    ctx.fill();
  }
  ctx.restore();
}

// ─── Slide 1: Cover ──────────────────────────────────────────────────────────
function renderCoverContent(ctx: CanvasRenderingContext2D, data: CardNewsData, st: SlideStyleConfig) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Hospital name badge
  ctx.font = `bold 36px ${FONT}`;
  const tagText = `${data.hospitalName}의`;
  const tagW = ctx.measureText(tagText).width + 52;
  roundFill(ctx, (S - tagW) / 2, 52, tagW, 58, 29, st.tagBgColor);
  ctx.fillStyle = st.mainTextColor;
  ctx.fillText(tagText, S / 2, 81);

  // Main title
  ctx.font = `bold 86px ${FONT}`;
  const titleLines = wrapText(ctx, data.coverTitle, S - 130);
  titleLines.forEach((line, i) => {
    ctx.fillStyle = st.mainTextColor;
    ctx.fillText(line, S / 2, 205 + i * 96);
  });

  // Subtitle
  const subY = 205 + titleLines.length * 96 + 26;
  ctx.font = `34px ${FONT}`;
  ctx.fillStyle = st.subTextColor;
  const subLines = wrapText(ctx, data.coverSubtitle, S - 200);
  subLines.forEach((line, i) => ctx.fillText(line, S / 2, subY + i * 44));

  // Divider
  const divY = subY + subLines.length * 44 + 26;
  ctx.strokeStyle = st.dividerColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(S / 2 - 220, divY);
  ctx.lineTo(S / 2 + 220, divY);
  ctx.stroke();

  // 4 topic boxes
  const boxW = 226, boxH = 200, gap = 14;
  const totalBoxW = 4 * boxW + 3 * gap;
  const bx0 = (S - totalBoxW) / 2;
  const by0 = Math.max(divY + 36, 648);

  data.coverTopics.slice(0, 4).forEach((topic, i) => {
    const bx = bx0 + i * (boxW + gap);
    roundFill(ctx, bx, by0, boxW, boxH, 18, st.boxFillColor);

    ctx.font = '52px serif';
    ctx.fillStyle = st.mainTextColor;
    ctx.fillText(topic.icon, bx + boxW / 2, by0 + 60);

    ctx.font = `bold 26px ${FONT}`;
    ctx.fillStyle = st.mainTextColor;
    wrapText(ctx, topic.title, boxW - 18).forEach((l, li) =>
      ctx.fillText(l, bx + boxW / 2, by0 + 118 + li * 30));

    ctx.font = `20px ${FONT}`;
    ctx.fillStyle = st.subTextColor;
    wrapText(ctx, topic.desc, boxW - 22).forEach((l, li) =>
      ctx.fillText(l, bx + boxW / 2, by0 + 160 + li * 26));
  });

  // Footer
  const footY = S - 76;
  ctx.strokeStyle = st.dividerColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, footY);
  ctx.lineTo(S - 60, footY);
  ctx.stroke();
  ctx.font = `24px ${FONT}`;
  ctx.fillStyle = st.subTextColor;
  ctx.fillText(data.footerText, S / 2, footY + 34);
}

// ─── Slide 2: Steps ──────────────────────────────────────────────────────────
function renderStepsContent(ctx: CanvasRenderingContext2D, data: CardNewsData, st: SlideStyleConfig) {
  ctx.textBaseline = 'middle';

  // Yellow banner
  const bannerW = 860, bannerH = 88;
  roundFill(ctx, (S - bannerW) / 2, 58, bannerW, bannerH, 18, st.accentColor);
  ctx.font = `bold 44px ${FONT}`;
  ctx.fillStyle = st.accentTextColor;
  ctx.textAlign = 'center';
  ctx.fillText(data.stepsTitle, S / 2, 58 + bannerH / 2);

  // Steps
  const itemH = 152, startY = 188;
  data.steps.slice(0, 4).forEach((step, i) => {
    const iy = startY + i * itemH;

    // Number circle
    ctx.beginPath();
    ctx.arc(88, iy + 58, 46, 0, Math.PI * 2);
    ctx.fillStyle = st.accentColor;
    ctx.fill();
    ctx.font = `bold 38px ${FONT}`;
    ctx.fillStyle = st.accentTextColor;
    ctx.textAlign = 'center';
    ctx.fillText(step.num, 88, iy + 58);

    // Icon
    ctx.font = '42px serif';
    ctx.fillStyle = st.mainTextColor;
    ctx.textAlign = 'right';
    ctx.fillText(step.icon, S - 55, iy + 44);

    // Title & desc
    ctx.textAlign = 'left';
    ctx.font = `bold 38px ${FONT}`;
    ctx.fillStyle = st.mainTextColor;
    ctx.fillText(step.title, 158, iy + 34);
    ctx.font = `28px ${FONT}`;
    ctx.fillStyle = st.subTextColor;
    ctx.fillText(step.desc, 158, iy + 80);

    // Divider
    if (i < 3) {
      ctx.strokeStyle = st.dividerColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(58, iy + itemH - 6);
      ctx.lineTo(S - 58, iy + itemH - 6);
      ctx.stroke();
    }
  });

  // Info box
  const infoY = startY + 4 * itemH + 18;
  const infoH = S - infoY - 38;
  roundFill(ctx, 38, infoY, S - 76, infoH, 18, st.infoBgColor);
  ctx.textAlign = 'center';
  ctx.font = `28px ${FONT}`;
  ctx.fillStyle = st.mainTextColor;
  ctx.fillText('전문의와 상담 후 개인에 맞는 치료를 받으세요.', S / 2, infoY + infoH / 2 - 20);
  ctx.font = `22px ${FONT}`;
  ctx.fillStyle = st.subTextColor;
  ctx.fillText(data.footerText, S / 2, infoY + infoH / 2 + 22);
}

// ─── Slide 3: Conclusion ─────────────────────────────────────────────────────
function renderConclusionContent(ctx: CanvasRenderingContext2D, data: CardNewsData, st: SlideStyleConfig) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Sub heading
  ctx.font = `30px ${FONT}`;
  ctx.fillStyle = st.subTextColor;
  ctx.fillText(data.conclusionSub, S / 2, 145);

  // Main title
  ctx.font = `bold 76px ${FONT}`;
  ctx.fillStyle = st.mainTextColor;
  const lines = wrapText(ctx, data.conclusionTitle, S - 120);
  lines.forEach((line, i) => ctx.fillText(line, S / 2, 255 + i * 88));

  // 3 bullet points (fixed Y positions)
  const pointsY = [490, 630, 770];
  const pointH = 105;
  data.conclusionPoints.slice(0, 3).forEach((point, i) => {
    const py = pointsY[i];
    // Left accent bar
    roundFill(ctx, 55, py, 9, pointH, 5, st.accentColor);
    // Box
    roundFill(ctx, 76, py, S - 132, pointH, 15, st.boxFillColor);
    // Text
    ctx.textAlign = 'left';
    ctx.font = `32px ${FONT}`;
    ctx.fillStyle = st.mainTextColor;
    const pLines = wrapText(ctx, point, S - 205);
    if (pLines.length === 1) {
      ctx.fillText(pLines[0], 114, py + pointH / 2);
    } else {
      pLines.slice(0, 2).forEach((l, li) => ctx.fillText(l, 114, py + 30 + li * 42));
    }
  });

  // Info box
  const infoY = S - 134;
  roundFill(ctx, 38, infoY, S - 76, 96, 18, st.infoBgColor);
  ctx.textAlign = 'center';
  ctx.font = `26px ${FONT}`;
  ctx.fillStyle = st.mainTextColor;
  ctx.fillText(data.footerText, S / 2, infoY + 48);
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function CardNewsDesigner({ data, keyword }: Props) {
  const ref0 = useRef<HTMLCanvasElement>(null);
  const ref1 = useRef<HTMLCanvasElement>(null);
  const ref2 = useRef<HTMLCanvasElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [styleIdx, setStyleIdx] = useState(0);
  const [customStyle, setCustomStyle] = useState<SlideStyleConfig | null>(null);
  const [styleText, setStyleText] = useState('');
  const [showStyleInput, setShowStyleInput] = useState(false);
  const [loadingStyle, setLoadingStyle] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [slides, setSlides] = useState<string[]>(['', '', '']);
  const [rendering, setRendering] = useState(false);

  const activeStyle = customStyle ?? STYLE_PRESETS[styleIdx];
  const SLIDE_NAMES = ['표지', '단계', '마무리'];

  const renderAll = useCallback(async () => {
    setRendering(true);
    const refs = [ref0, ref1, ref2];
    const types = ['cover', 'steps', 'conclusion'] as const;
    const results: string[] = [];

    // Load photos once
    const photoImgs: (HTMLImageElement | null)[] = await Promise.all(
      [0, 1, 2].map(async (i) => {
        const src = photos[i] ?? photos[0] ?? null;
        if (!src) return null;
        try { return await loadImage(src); } catch { return null; }
      })
    );

    for (let i = 0; i < 3; i++) {
      const canvas = refs[i].current;
      if (!canvas) { results.push(''); continue; }
      canvas.width = S;
      canvas.height = S;
      const ctx = canvas.getContext('2d');
      if (!ctx) { results.push(''); continue; }

      // Steps slide needs darker overlay for readability
      const overlayAlpha = types[i] === 'steps' ? 0.80 : 0.72;
      await drawBase(ctx, activeStyle, photoImgs[i], overlayAlpha);

      if (types[i] === 'cover') renderCoverContent(ctx, data, activeStyle);
      else if (types[i] === 'steps') renderStepsContent(ctx, data, activeStyle);
      else renderConclusionContent(ctx, data, activeStyle);

      results.push(canvas.toDataURL('image/png'));
    }

    setSlides(results);
    setRendering(false);
  }, [data, activeStyle, photos]);

  useEffect(() => { void renderAll(); }, [renderAll]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 3);
    if (files.length === 0) return;
    Promise.all(
      files.map(f => new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = ev => resolve(ev.target?.result as string);
        reader.readAsDataURL(f);
      }))
    ).then(urls => setPhotos(urls));
    e.target.value = '';
  };

  const handleRemovePhoto = (idx: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== idx));
  };

  const handleApplyCustomStyle = async () => {
    if (!styleText.trim()) return;
    setLoadingStyle(true);
    try {
      const res = await fetch('/api/generate-style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ styleDescription: styleText }),
      });
      const style = await res.json() as SlideStyleConfig;
      if (!res.ok) throw new Error('스타일 생성 실패');
      setCustomStyle(style);
      setShowStyleInput(false);
    } catch {
      alert('스타일 생성에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setLoadingStyle(false);
    }
  };

  const handleSelectPreset = (idx: number) => {
    setStyleIdx(idx);
    setCustomStyle(null);
    setShowStyleInput(false);
  };

  const handleDownload = (dataUrl: string, i: number) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `카드뉴스-${keyword}-${SLIDE_NAMES[i]}.png`;
    a.click();
  };

  const handleDownloadAll = () => {
    slides.forEach((img, i) => {
      if (!img) return;
      setTimeout(() => handleDownload(img, i), i * 300);
    });
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
      {/* Hidden canvases */}
      <canvas ref={ref0} className="hidden" />
      <canvas ref={ref1} className="hidden" />
      <canvas ref={ref2} className="hidden" />

      {/* Header */}
      <div className="p-6 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-sky-500 rounded-xl flex items-center justify-center text-white font-bold text-lg">✦</div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">디자인 카드뉴스</h2>
            <p className="text-sm text-gray-500">1080×1080 · PNG 다운로드</p>
          </div>
        </div>
        {slides.some(Boolean) && !rendering && (
          <button
            onClick={handleDownloadAll}
            className="text-xs font-bold px-3 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl transition-colors"
          >
            ⬇ 전체 저장
          </button>
        )}
      </div>

      <div className="p-6 space-y-5">
        {/* ── Photo upload ── */}
        <div>
          <p className="text-xs font-bold text-gray-600 mb-2">사진 첨부 <span className="font-normal text-gray-400">(최대 3장 · 슬라이드 배경으로 활용)</span></p>
          <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} />

          {photos.length === 0 ? (
            <button
              onClick={() => photoInputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-300 hover:border-sky-400 rounded-xl py-6 text-center transition-colors group"
            >
              <span className="text-2xl">🖼</span>
              <p className="text-sm text-gray-500 group-hover:text-sky-600 mt-1 font-medium">클릭하여 사진 업로드</p>
              <p className="text-xs text-gray-400 mt-0.5">첨부하면 사진을 슬라이드 배경으로 사용합니다</p>
            </button>
          ) : (
            <div className="flex gap-2 items-center flex-wrap">
              {photos.map((src, i) => (
                <div key={i} className="relative">
                  <img src={src} alt={`사진 ${i + 1}`} className="w-20 h-20 object-cover rounded-xl border border-gray-200" />
                  <div className="absolute -top-1.5 -right-1.5 text-[9px] font-bold bg-sky-500 text-white rounded-full w-4 h-4 flex items-center justify-center">{i + 1}</div>
                  <button
                    onClick={() => handleRemovePhoto(i)}
                    className="absolute -bottom-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                  >×</button>
                </div>
              ))}
              {photos.length < 3 && (
                <button
                  onClick={() => photoInputRef.current?.click()}
                  className="w-20 h-20 border-2 border-dashed border-gray-300 hover:border-sky-400 rounded-xl flex flex-col items-center justify-center text-gray-400 hover:text-sky-500 transition-colors text-xs"
                >
                  <span className="text-xl">+</span>추가
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Style presets ── */}
        <div>
          <p className="text-xs font-bold text-gray-600 mb-2">스타일 선택</p>
          <div className="flex gap-2 flex-wrap">
            {STYLE_PRESETS.map((st, i) => (
              <button
                key={i}
                onClick={() => handleSelectPreset(i)}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border-2 transition-all text-xs font-bold ${
                  !customStyle && styleIdx === i
                    ? 'border-sky-500 bg-sky-50 text-sky-700'
                    : 'border-gray-200 hover:border-gray-300 text-gray-600'
                }`}
              >
                <span
                  className="w-8 h-8 rounded-lg"
                  style={{ background: `linear-gradient(135deg, ${st.bgGradient[0]}, ${st.bgGradient[1]})` }}
                />
                <span>{st.name}</span>
              </button>
            ))}

            {/* Custom style button */}
            <button
              onClick={() => setShowStyleInput(!showStyleInput)}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border-2 transition-all text-xs font-bold ${
                customStyle || showStyleInput
                  ? 'border-purple-500 bg-purple-50 text-purple-700'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white text-base">✍</span>
              <span>{customStyle ? `${customStyle.emoji} ${customStyle.name}` : '직접 입력'}</span>
            </button>
          </div>

          {/* Custom style text input */}
          {showStyleInput && (
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={styleText}
                onChange={e => setStyleText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleApplyCustomStyle()}
                placeholder="예: 따뜻한 갈색톤, 고급스러운 검정, 봄날 벚꽃..."
                className="flex-1 text-sm border border-gray-300 rounded-xl px-3 py-2.5 focus:outline-none focus:border-purple-400"
              />
              <button
                onClick={handleApplyCustomStyle}
                disabled={loadingStyle || !styleText.trim()}
                className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white text-sm font-bold rounded-xl transition-colors flex items-center gap-1.5"
              >
                {loadingStyle ? (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : '적용'}
              </button>
            </div>
          )}
        </div>

        {/* ── Slide previews ── */}
        <div>
          <p className="text-xs font-bold text-gray-600 mb-2">슬라이드 미리보기</p>
          <div className="grid grid-cols-3 gap-3">
            {SLIDE_NAMES.map((name, i) => (
              <div key={i} className="space-y-1.5">
                <div className="aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-100 relative">
                  {rendering ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className="w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                      <p className="text-[10px] text-gray-400 mt-1">렌더링 중...</p>
                    </div>
                  ) : slides[i] ? (
                    <img src={slides[i]} alt={name} className="w-full h-full object-cover" />
                  ) : null}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-gray-500">{i + 1}. {name}</span>
                  {slides[i] && !rendering && (
                    <button
                      onClick={() => handleDownload(slides[i], i)}
                      className="text-[11px] font-bold px-2 py-0.5 bg-gray-100 hover:bg-sky-100 text-gray-600 hover:text-sky-700 rounded-lg transition-colors"
                    >
                      저장
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[10px] text-gray-400 text-center">
          스타일·사진 변경 시 슬라이드가 자동으로 업데이트됩니다
        </p>
      </div>
    </div>
  );
}
