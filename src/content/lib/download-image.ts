/**
 * Magic bytes 기반 실제 이미지 포맷 감지.
 * 데이터 URL/HTTP 응답이 헤더에 잘못된 MIME을 줘도 실제 바이트로 판별한다.
 */
async function detectMimeType(blob: Blob): Promise<string> {
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) return 'image/webp';
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'image/gif';
  return blob.type || 'image/png';
}

function extensionFor(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'png';
}

async function fetchBlob(url: string): Promise<Blob> {
  if (url.startsWith('data:')) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('데이터 URL 변환 실패');
    return await res.blob();
  }

  const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) {
    // 프록시가 거부한 도메인일 경우 직접 fetch 시도 (CORS 허용 시)
    const direct = await fetch(url);
    if (!direct.ok) throw new Error('이미지를 가져올 수 없습니다.');
    return await direct.blob();
  }
  return await res.blob();
}

/**
 * 이미지를 안정적으로 다운로드한다.
 * - 데이터 URL과 HTTP URL 모두 처리
 * - 실제 바이트로 포맷 감지하여 확장자 자동 결정 (네이버 업로드 호환성)
 * - Blob URL을 통해 다운로드하여 모바일/대용량 데이터 URL 호환성 확보
 *
 * @param url 이미지 URL (data: 또는 http(s):)
 * @param baseFilename 확장자 제외한 파일명 (예: "이미지1_keyword")
 */
export async function downloadImageReliable(url: string, baseFilename: string): Promise<void> {
  try {
    const blob = await fetchBlob(url);
    const mime = await detectMimeType(blob);
    const ext = extensionFor(mime);

    // 잘못된 헤더로 인한 불일치 방지: 감지된 MIME으로 새 Blob 생성
    const fixedBlob = blob.type === mime ? blob : new Blob([blob], { type: mime });
    const blobUrl = URL.createObjectURL(fixedBlob);

    const cleanName = baseFilename.replace(/\.[a-z0-9]+$/i, '');
    const filename = `${cleanName}.${ext}`;

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    // 최후 fallback — 새 탭에서 열어 사용자가 우클릭 저장
    if (typeof window !== 'undefined') window.open(url, '_blank');
    throw err;
  }
}
