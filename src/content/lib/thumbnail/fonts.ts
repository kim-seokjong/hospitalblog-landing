/**
 * satori(ImageResponse) 용 한글 폰트 로더 — 저장소 번들 우선, CDN 최후 폴백.
 *
 * satori는 시스템 폰트를 쓸 수 없어 폰트 바이트를 직접 넘겨야 한다.
 * 임의의 한글 제목을 깨짐 없이 렌더하려면 "전체 글리프" 폰트가 필요하다.
 *
 * 폰트 하드닝(2026-07-10): Pretendard 정적 OTF(Regular/ExtraBold, OFL)를
 * 저장소 public/fonts/ 에 번들해 자체 오리진에서 로드한다 — CDN 장애가
 * 유료 기능 실패로 이어지지 않게. edge 함수 코드 번들에 넣지 않고(각 ~1.5MB,
 * Vercel edge 사이즈 한도 위험) 정적 에셋 fetch 방식을 쓴다.
 * 자체 오리진 로드 실패 시에만 jsDelivr CDN 으로 폴백한다.
 * satori 지원 포맷: ttf/otf/woff. Pretendard OTF 는 지원 범위.
 */

export interface LoadedFont {
  readonly name: string;
  readonly data: ArrayBuffer;
  readonly weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  readonly style: 'normal';
}

const FONT_FAMILY = 'Pretendard';

/** 저장소 번들 경로 (public/fonts) — 자체 오리진 기준 상대 경로. */
const BUNDLED_FONT_PATH = '/fonts';

/** Pretendard OFL 정적 OTF — 공식 저장소 jsDelivr 미러 (최후 폴백 전용). */
const PRETENDARD_CDN_BASE =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static';

const WEIGHT_FILES: ReadonlyArray<{ weight: LoadedFont['weight']; file: string }> = [
  { weight: 400, file: 'Pretendard-Regular.otf' },
  { weight: 800, file: 'Pretendard-ExtraBold.otf' },
];

let fontCache: LoadedFont[] | null = null;
let inflight: Promise<LoadedFont[]> | null = null;

async function fetchFontFrom(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`폰트 로드 실패(${url}): ${res.status}`);
  return res.arrayBuffer();
}

/** 번들(자체 오리진) 우선 → 실패 시 CDN 폴백으로 폰트 1종을 로드한다. */
async function fetchFont(file: string, baseUrl?: string): Promise<ArrayBuffer> {
  if (baseUrl) {
    try {
      return await fetchFontFrom(`${baseUrl}${BUNDLED_FONT_PATH}/${file}`);
    } catch {
      // 자체 오리진 실패(프리뷰 보호, 로컬 파일 누락 등) — CDN 폴백으로 진행
    }
  }
  return fetchFontFrom(`${PRETENDARD_CDN_BASE}/${file}`);
}

/**
 * 썸네일 렌더에 쓸 한글 폰트 목록을 반환한다(캐시 우선).
 * @param baseUrl 자체 오리진 (예: req.nextUrl.origin). 지정 시 번들 폰트 우선.
 * 개별 weight 로드에 실패하면 성공한 weight 로만 진행하고, 전부 실패하면 예외를 던진다.
 */
export async function loadThumbnailFonts(baseUrl?: string): Promise<LoadedFont[]> {
  if (fontCache) return fontCache;
  if (inflight) return inflight;

  inflight = (async () => {
    const settled = await Promise.allSettled(
      WEIGHT_FILES.map(async ({ weight, file }) => {
        const data = await fetchFont(file, baseUrl);
        return { name: FONT_FAMILY, data, weight, style: 'normal' as const };
      }),
    );

    const fonts = settled
      .filter((r): r is PromiseFulfilledResult<LoadedFont> => r.status === 'fulfilled')
      .map((r) => r.value);

    if (fonts.length === 0) {
      inflight = null;
      throw new Error('썸네일용 한글 폰트를 로드하지 못했습니다.');
    }

    fontCache = fonts;
    return fonts;
  })();

  return inflight;
}

/** satori 에 넘길 fontFamily 이름. */
export const THUMBNAIL_FONT_FAMILY = FONT_FAMILY;
