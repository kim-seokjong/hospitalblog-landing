/**
 * AI 생성 이미지 다운로드 유틸 (브라우저 전용).
 *
 * 대표 결정(2026-07-09): 과거 "AI 이미지" 시각 라벨을 캔버스에 픽셀로 박던 방식을 폐기하고,
 * 다운로드 PNG 바이트에 기계 판독 가능한 출처 메타데이터(tEXt/iTXt + XMP)를 삽입한다.
 * (AI기본법 표시의무를 "기계 판독 방법"으로 충족.)
 *
 * - photo / cardnews: 시각 라벨 없음 + 출처 메타데이터 삽입.
 * - upload(실제 사진): 메타데이터/라벨 모두 없음(원본 그대로) — 이 모듈을 거치지 않는다.
 */

import { insertTextChunks, isPng } from './png-metadata';
import { buildProvenanceEntries } from './ai-provenance';

/**
 * 이미지 URL을 프록시 경유(또는 data URL은 그대로) 로드하여 HTMLImageElement로 반환.
 */
export async function loadImageForCanvas(srcUrl: string): Promise<HTMLImageElement> {
  const proxyUrl = srcUrl.startsWith('data:')
    ? srcUrl
    : `/api/proxy-image?url=${encodeURIComponent(srcUrl)}`;
  const img = new window.Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('이미지를 로드할 수 없습니다.'));
    img.src = proxyUrl;
  });
  return img;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('잘못된 data URL 형식입니다.');
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToPngDataUrl(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // 큰 이미지에서 call stack 초과 방지
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * PNG data URL에 AI 출처 메타데이터를 삽입한 새 data URL을 반환한다(동기·순수).
 * 입력이 PNG가 아니면(방어) 원본을 그대로 돌려준다.
 */
export function embedProvenanceInPngDataUrl(pngDataUrl: string): string {
  const bytes = dataUrlToBytes(pngDataUrl);
  if (!isPng(bytes)) return pngDataUrl;
  const withMeta = insertTextChunks(bytes, buildProvenanceEntries());
  return bytesToPngDataUrl(withMeta);
}

/**
 * 이미지 URL을 원본 비율 그대로 캔버스에 그린 뒤(시각 라벨 없음),
 * 출처 메타데이터를 삽입한 PNG data URL을 반환한다. photo 다운로드에 사용.
 */
export async function composeImageWithProvenance(srcUrl: string): Promise<string> {
  const img = await loadImageForCanvas(srcUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context를 사용할 수 없습니다.');
  ctx.drawImage(img, 0, 0);
  const pngDataUrl = canvas.toDataURL('image/png');
  return embedProvenanceInPngDataUrl(pngDataUrl);
}
