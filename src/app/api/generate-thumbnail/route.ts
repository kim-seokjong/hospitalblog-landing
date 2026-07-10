import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { parseThumbnailParams, renderThumbnail } from '@/content/lib/thumbnail/render';

// @vercel/og 의 Node 번들은 Windows 에서 path 버그가 있어 edge 번들을 사용한다
// (기존 opengraph-image.tsx 와 동일 이유). satori 폰트/wasm 을 웹팩 에셋으로 로드해 OS 무관 동작.
export const runtime = 'edge';

/**
 * 배경 사진 호스트 화이트리스트 (SSRF 방어).
 * satori 가 imageUrl 을 서버에서 직접 fetch 하므로, 우리 이미지 소스로만 제한한다.
 * - AI 생성: fal.*, storage.googleapis.com, *.blob.core.windows.net(OpenAI gpt-image), pexels/unsplash
 * - 업로드 사진: *.supabase.co (clinic-assets / clinic_photos 공개 URL)
 */
const ALLOWED_IMAGE_HOSTS = [
  'fal.run',
  'fal.media',
  'storage.googleapis.com',
  'blob.core.windows.net',
  'supabase.co',
  'supabase.in',
  'images.pexels.com',
  'images.unsplash.com',
];

function isAllowedImageUrl(imageUrl: string): boolean {
  if (/^data:image\//i.test(imageUrl)) return true; // 인라인 데이터 — SSRF 위험 없음
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return ALLOWED_IMAGE_HOSTS.some(
    (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`),
  );
}

/**
 * POST /api/generate-thumbnail
 * 배경 실사 사진 + HTML 실텍스트 오버레이 카드를 satori 로 렌더해 PNG 를 반환한다.
 * AI 배경이면 출처 메타데이터를 삽입, 업로드 실사진이면 원본 그대로.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const raw = await req.json().catch(() => null);
    const parsed = parseThumbnailParams(raw);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    if (!isAllowedImageUrl(parsed.params.imageUrl)) {
      return NextResponse.json({ error: '허용되지 않은 배경 이미지 도메인입니다.' }, { status: 400 });
    }

    // 번들 폰트(public/fonts)를 자체 오리진에서 로드 — CDN 은 최후 폴백.
    const { bytes, contentType } = await renderThumbnail(parsed.params, {
      fontBaseUrl: req.nextUrl.origin,
    });

    // 새 ArrayBuffer 로 복사 — Uint8Array<ArrayBufferLike> 를 Response 가 받도록 폭을 좁힌다.
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '썸네일 생성에 실패했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
