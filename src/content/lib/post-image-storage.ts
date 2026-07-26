/**
 * 본문 이미지 영속화 — 생성 직후 clinic-assets 버킷으로 옮겨 영구 public URL 을 만든다.
 *
 * 왜 생성 시점인가(저장 시점이 아니라):
 * - gpt-image 경로의 결과는 `data:image/png;base64,...` 로 장당 수 MB 다. 저장 시점에
 *   클라이언트가 이걸 POST 바디로 올리면 Vercel 요청 한도(4.5MB)를 바로 넘긴다.
 * - fal.media URL 은 만료되는 외부 CDN 이라 DB 에 남겨도 죽은 링크가 되고,
 *   서브도메인 블로그 렌더 화이트리스트(clinic-site/theme.ts)에서도 거부된다.
 * 따라서 서버가 이미 바이트를 쥐고 있는 생성 시점에 업로드하는 것이 유일하게 견고하다.
 *
 * 실패는 절대 생성 흐름을 막지 않는다 — 업로드에 실패하면 원본 URL 을 그대로
 * 반환해 화면 표시는 유지하고, 저장 단계에서 화이트리스트에 걸려 DB 에는 들어가지
 * 않는다(죽은 링크가 남지 않는다).
 */
import { createAdminClient } from '@/dev/lib/supabase/server';
import { isAllowedClinicflixAssetUrl } from '@/content/lib/clinicflix-asset-hosts';

const BUCKET = 'clinic-assets';

/** 장당 최대 바이트 — 비정상 응답 방어(clinic-assets 이미지 상한과 동일). */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** data URL 파싱 결과. */
interface DecodedImage {
  buffer: Buffer;
  contentType: string;
  ext: string;
}

/** MIME → 확장자(허용 이미지 타입만). 알 수 없으면 null(업로드 스킵). */
function extFromMime(mime: string): string | null {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
  };
  return map[mime.toLowerCase().split(';')[0].trim()] ?? null;
}

/** `data:image/png;base64,...` 를 디코드한다. 형식이 어긋나면 null. */
function decodeDataUrl(url: string): DecodedImage | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(url);
  if (!match) return null;
  const contentType = match[1];
  const ext = extFromMime(contentType);
  if (!ext) return null;
  try {
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return null;
    return { buffer, contentType, ext };
  } catch {
    return null;
  }
}

/** 다운로드 제한 시간(ms) — 응답이 오지 않는 호스트로 함수 시간이 고갈되는 것을 막는다. */
const DOWNLOAD_TIMEOUT_MS = 20_000;

/**
 * 허용 호스트(fal.media·supabase)에서 내려받는다. SSRF 방지 화이트리스트 통과 필수.
 *
 * `redirect: 'error'` — 최초 URL 의 호스트만 검사하고 리다이렉트를 따라가면,
 * 허용 호스트가 30x 로 내부 IP·메타데이터 서버를 가리킬 때 그대로 요청하게 된다
 * (리다이렉트 기반 SSRF). 목적지 재검증 대신 리다이렉트 자체를 거부한다.
 */
async function downloadImage(url: string): Promise<DecodedImage | null> {
  if (!isAllowedClinicflixAssetUrl(url)) return null;
  const res = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') ?? 'image/png';
  const ext = extFromMime(contentType);
  if (!ext) return null;
  // 선언된 길이가 이미 상한을 넘으면 본문을 읽지 않고 중단(메모리 고갈 방어).
  const declared = Number(res.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return null;
  return { buffer, contentType, ext };
}

/**
 * 생성된 이미지 1장을 clinic-assets 로 옮기고 영구 public URL 을 반환한다.
 *
 * 이미 clinic-assets public URL 이면 그대로 돌려준다(재업로드 없음).
 * 어떤 실패든 원본 url 을 그대로 반환한다(생성 흐름 보호 — throw 하지 않는다).
 */
export async function persistPostImage(userId: string, url: string): Promise<string> {
  if (typeof url !== 'string' || url === '') return url;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (supabaseUrl && url.startsWith(`${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET}/`)) {
    return url;
  }

  try {
    const decoded = url.startsWith('data:') ? decodeDataUrl(url) : await downloadImage(url);
    if (!decoded) return url;

    const admin = createAdminClient();
    const path = `${userId}/post-images/${crypto.randomUUID()}.${decoded.ext}`;
    const { error } = await admin.storage.from(BUCKET).upload(path, decoded.buffer, {
      contentType: decoded.contentType,
      upsert: false,
      cacheControl: '3600',
    });
    if (error) return url;

    const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? url;
  } catch {
    // 업로드 실패는 생성 응답을 막지 않는다 — 원본 URL 로 화면 표시는 유지.
    return url;
  }
}

/**
 * 여러 장을 병렬로 영속화한다. 개별 실패는 원본 URL 로 폴백되며 전체를 막지 않는다.
 * userId 가 없으면(비로그인 경로) 원본을 그대로 돌려준다.
 */
export async function persistPostImages(
  userId: string | null,
  urls: ReadonlyArray<string>,
): Promise<string[]> {
  if (!userId) return [...urls];
  return Promise.all(urls.map((url) => persistPostImage(userId, url)));
}
