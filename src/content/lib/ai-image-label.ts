/**
 * AI 이미지 라벨 캔버스 합성 유틸리티.
 *
 * 의료 콘텐츠 투명성을 위해 모든 AI 생성 이미지(photo, cardnews 스타일)는
 * 다운로드 시 우상단에 "AI 이미지" 흰색 텍스트 라벨을 박아서 출력해야 한다.
 * 사용자 업로드 이미지(upload 스타일)는 라벨 없이 원본 그대로.
 */

/**
 * 캔버스 우상단에 "AI 이미지" 라벨을 흰 글자 + 검은 그림자로 그린다.
 * 박스 없음 — 어떤 배경에서도 가독성 확보를 위해 강한 drop shadow 사용.
 */
export function drawAILabel(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  scale: number = 1
): void {
  const label = 'AI 이미지';
  const fontSize = Math.round(28 * scale);
  const margin = Math.round(24 * scale);

  ctx.save();
  ctx.font = `bold ${fontSize}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';

  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = Math.round(10 * scale);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.round(2 * scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, canvasWidth - margin, margin);
  ctx.shadowBlur = Math.round(4 * scale);
  ctx.fillText(label, canvasWidth - margin, margin);

  ctx.restore();
}

/**
 * 이미지 URL을 받아 프록시를 통해 로드하여 HTMLImageElement로 반환.
 * 데이터 URL은 그대로, http URL은 프록시 경유.
 */
export async function loadImageForCanvas(srcUrl: string): Promise<HTMLImageElement> {
  const proxyUrl = srcUrl.startsWith('data:')
    ? srcUrl
    : `/api/proxy-image?url=${encodeURIComponent(srcUrl)}`;
  const img = new window.Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = proxyUrl;
  });
  return img;
}

/**
 * 이미지 URL을 받아 원본 비율 유지 + AI 이미지 라벨 박아서 dataUrl 반환.
 * photo / cardnews 다운로드 시 사용.
 */
export async function composeImageWithAILabel(srcUrl: string): Promise<string> {
  const img = await loadImageForCanvas(srcUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.drawImage(img, 0, 0);

  // 1024 기준 폰트 크기를 실제 이미지 크기에 비례
  const labelScale = canvas.width / 1024;
  drawAILabel(ctx, canvas.width, labelScale);

  return canvas.toDataURL('image/png');
}
