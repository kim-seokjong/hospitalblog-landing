/**
 * satori(ImageResponse) 용 한글 폰트 로더.
 *
 * satori는 시스템 폰트를 쓸 수 없어 폰트 바이트를 직접 넘겨야 한다.
 * 임의의 한글 제목을 깨짐 없이 렌더하려면 "전체 글리프" 폰트가 필요한데,
 * 저장소의 기존 서브셋(3.5KB)은 고정 문구만 커버하므로 쓸 수 없다.
 *
 * 대신 OFL 라이선스인 Pretendard 정적 OTF(Regular/ExtraBold)를 jsDelivr에서
 * 런타임에 한 번 받아 모듈 스코프에 캐시한다(웜 인스턴스는 네트워크 생략).
 * satori 지원 포맷: ttf/otf/woff. Pretendard OTF 는 지원 범위.
 */

export interface LoadedFont {
  readonly name: string;
  readonly data: ArrayBuffer;
  readonly weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  readonly style: 'normal';
}

const FONT_FAMILY = 'Pretendard';

/** Pretendard OFL 정적 OTF — 공식 저장소 jsDelivr 미러. */
const PRETENDARD_BASE =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static';

const WEIGHT_FILES: ReadonlyArray<{ weight: LoadedFont['weight']; file: string }> = [
  { weight: 400, file: 'Pretendard-Regular.otf' },
  { weight: 800, file: 'Pretendard-ExtraBold.otf' },
];

let fontCache: LoadedFont[] | null = null;
let inflight: Promise<LoadedFont[]> | null = null;

async function fetchFont(file: string): Promise<ArrayBuffer> {
  const res = await fetch(`${PRETENDARD_BASE}/${file}`, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`폰트 로드 실패(${file}): ${res.status}`);
  return res.arrayBuffer();
}

/**
 * 썸네일 렌더에 쓸 한글 폰트 목록을 반환한다(캐시 우선).
 * 개별 weight 로드에 실패하면 성공한 weight 로만 진행하고, 전부 실패하면 예외를 던진다.
 */
export async function loadThumbnailFonts(): Promise<LoadedFont[]> {
  if (fontCache) return fontCache;
  if (inflight) return inflight;

  inflight = (async () => {
    const settled = await Promise.allSettled(
      WEIGHT_FILES.map(async ({ weight, file }) => {
        const data = await fetchFont(file);
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
