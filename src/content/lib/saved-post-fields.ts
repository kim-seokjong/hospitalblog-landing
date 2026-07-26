/**
 * saved_posts 산출물 필드(image_urls·tags·seo_score) 정규화 — 순수 로직 모듈.
 *
 * 배경(2026-W30 실측): 이미지 546장·태그 91회를 만들고도 saved_posts 15/15 의
 * image_urls·tags 가 비어 있었다. 저장 페이로드가 세 필드를 아예 보내지 않았고,
 * 보내더라도 tags state 는 TagResult(객체)라 `text[]` 컬럼과 형태가 어긋난다.
 * 이 모듈이 클라이언트/서버 양쪽에서 쓰이는 단일 정규화 지점이다.
 *
 * ⚠️ 이 모듈은 네트워크·SDK·별칭 의존이 없는 순수 로직만 담는다
 *    (theme.ts·slug.ts 패턴 — node --experimental-strip-types 러너가 별칭 해석
 *    없이 로드할 수 있어야 하므로 값 import 를 두지 않는다).
 */

/** image_urls 최대 개수 — 본문 이미지 권장 5~6장 기준 여유분. */
export const MAX_IMAGE_URLS = 12;

/** tags 최대 개수 — 네이버 태그 상한(10개) 기준 여유분. */
export const MAX_TAGS = 30;

/** 태그 1개 최대 길이(자). */
export const MAX_TAG_LENGTH = 50;

/** URL 1개 최대 길이 — data URL 등 비정상 페이로드 방어. */
export const MAX_URL_LENGTH = 500;

/**
 * saved_posts.image_urls 에 저장 가능한 URL인지 판정한다.
 *
 * **자체 Storage(clinic-assets) public 경로만 허용한다.** 근거:
 * - `data:` base64 URL 은 행 크기를 수 MB 로 부풀리고 요청 한도를 넘긴다.
 * - 외부 생성 CDN(fal.media) URL 은 만료되며, 서브도메인 블로그 렌더 화이트리스트
 *   (clinic-site/theme.ts `isAllowedClinicAssetUrl`)에서도 거부돼 죽은 링크가 된다.
 * 따라서 DB 에는 **영속·화이트리스트 통과가 보장된 URL만** 들어간다.
 *
 * ⚠️ 판정 규칙은 clinic-site/theme.ts 의 `isAllowedClinicAssetUrl` 과 동일해야 한다.
 *    두 모듈 모두 값 import 금지 제약이 있어 규칙을 공유하지 못하므로,
 *    saved-post-fields.test.ts 가 두 함수의 일치를 회귀로 고정한다.
 */
export function isPersistedImageUrl(
  url: unknown,
  supabaseUrl: string | null | undefined,
): url is string {
  if (typeof url !== 'string' || !supabaseUrl) return false;
  const base = supabaseUrl.trim().replace(/\/+$/, '');
  if (!base.startsWith('https://')) return false;
  const prefix = `${base}/storage/v1/object/public/clinic-assets/`;
  return url.startsWith(prefix) && url.length > prefix.length;
}

/**
 * image_urls 를 정규화한다 — 허용 URL만, 개수 캡. **위치는 보존한다.**
 *
 * ★ 배열 index i 는 본문 `[이미지 i+1]` 마커를 가리키는 **위치 계약**이다
 *   (서브도메인 블로그 렌더 clinic-site/post-images.ts, 앱 미리보기
 *    BlogBodyRenderer 모두 같은 매핑을 쓴다).
 *   그래서 탈락한 항목을 배열에서 빼면 안 된다 — 빼는 순간 뒤 이미지가 앞 번호로
 *   당겨져 본문 설명과 다른 사진이 붙는다. 탈락분은 null 로 남기고, 의미 없는
 *   끝쪽 null 만 잘라낸다. 같은 URL 이 두 자리에 쓰이는 것도 허용한다.
 *
 * 저장할 것이 하나도 없으면 null(컬럼 미설정)을 반환한다.
 */
export function sanitizeImageUrls(
  raw: unknown,
  supabaseUrl: string | null | undefined,
): (string | null)[] | null {
  if (!Array.isArray(raw)) return null;
  const items: readonly unknown[] = raw;
  const out: (string | null)[] = [];
  for (const item of items.slice(0, MAX_IMAGE_URLS)) {
    // 길이 캡은 저장 단계에서만 적용한다 — 판정 함수에 넣으면 theme.ts 렌더
    // 화이트리스트와 동치가 깨져 "저장은 됐는데 블로그에 안 뜨는" 상태가 생긴다.
    if (!isPersistedImageUrl(item, supabaseUrl) || item.length > MAX_URL_LENGTH) {
      out.push(null);
      continue;
    }
    out.push(item);
  }
  while (out.length > 0 && out[out.length - 1] === null) out.pop();
  return out.length > 0 ? out : null;
}

/** 생성 이미지 식별자 `img-N` — N 이 본문 `[이미지 N]` 마커 번호다. */
const IMAGE_ID_RE = /^img-(\d+)$/;

/**
 * 생성 이미지 목록(GeneratedImage[]) → **위치 보존 URL 슬롯 배열**.
 *
 * ★ `images.map(img => img.url)` 로 만들면 안 된다. 이미지 생성은 부분 실패를
 *   허용해서(api/generate-images) 2번만 실패하면 배열이 [1번, 3번] 이 되고,
 *   그대로 저장하면 3번 사진이 본문 `[이미지 2]` 설명 자리에 붙는다.
 *   응답이 `id: "img-N"` 으로 원래 번호를 들고 있으므로 그 N 을 슬롯으로 쓴다.
 *
 * id 가 없는 구 데이터는 배열 위치로 폴백한다.
 */
export function toImageUrlSlots(images: unknown): (string | null)[] {
  if (!Array.isArray(images)) return [];
  const items: readonly unknown[] = images;
  const slots: (string | null)[] = [];

  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const record = item as { id?: unknown; url?: unknown };
    const url = typeof record.url === 'string' ? record.url : null;
    const matched = typeof record.id === 'string' ? IMAGE_ID_RE.exec(record.id) : null;
    const slot = matched ? Number.parseInt(matched[1], 10) : index + 1;
    if (!Number.isFinite(slot) || slot < 1 || slot > MAX_IMAGE_URLS) return;
    while (slots.length < slot) slots.push(null);
    slots[slot - 1] = url;
  });

  while (slots.length > 0 && slots[slots.length - 1] === null) slots.pop();
  return slots;
}

/** tags 원천 — 문자열 배열이거나 generate-tags 응답(TagResult) 형태. */
interface TagResultLike {
  naverTags?: unknown;
  hashtags?: unknown;
  tags?: unknown;
}

/** 문자열 배열 후보에서 유효 태그만 추린다(트림·중복 제거·캡). */
function pickTagStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    // 선행 '#' 는 컬럼 저장 형태(순수 태그명)로 통일한다.
    const value = item.trim().replace(/^#+/, '').trim().slice(0, MAX_TAG_LENGTH);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * tags 를 `text[]` 컬럼 형태(문자열 배열)로 정규화한다.
 *
 * generate-tags 응답은 `{ tags: BlogTag[]; hashtags: string[]; naverTags: string[] }`
 * 객체라 그대로 보내면 `Array.isArray` 검사에서 탈락해 null 이 된다(기존 유실 원인 중 하나).
 * naverTags → hashtags → tags[].tag 순으로 문자열 배열을 뽑는다.
 */
export function sanitizeTags(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return null;

  if (Array.isArray(raw)) {
    const direct = pickTagStrings(raw);
    if (direct.length > 0) return direct;
    // BlogTag 객체 배열({ tag: string }) 도 허용한다.
    const fromObjects = pickTagStrings(
      raw.map((item) =>
        item && typeof item === 'object' && typeof (item as { tag?: unknown }).tag === 'string'
          ? (item as { tag: string }).tag
          : null,
      ),
    );
    return fromObjects.length > 0 ? fromObjects : null;
  }

  if (typeof raw !== 'object') return null;
  const obj = raw as TagResultLike;

  const fromNaver = pickTagStrings(obj.naverTags);
  if (fromNaver.length > 0) return fromNaver;

  const fromHash = pickTagStrings(obj.hashtags);
  if (fromHash.length > 0) return fromHash;

  if (Array.isArray(obj.tags)) {
    const fromTagObjects = pickTagStrings(
      obj.tags.map((item) =>
        item && typeof item === 'object' && typeof (item as { tag?: unknown }).tag === 'string'
          ? (item as { tag: string }).tag
          : typeof item === 'string'
            ? item
            : null,
      ),
    );
    if (fromTagObjects.length > 0) return fromTagObjects;
  }

  return null;
}

/**
 * seo_score 를 `int` 컬럼 형태로 정규화한다 — 0~100 정수, 그 외는 null.
 *
 * PATCH 경로가 타입 검증 없이 그대로 넘기면 문자열 입력이 Postgres 22P02 로
 * 저장 전체를 실패시킨다. 여기서 걸러 부분 실패를 막는다.
 */
export function sanitizeSeoScore(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > 100) return null;
  return rounded;
}
