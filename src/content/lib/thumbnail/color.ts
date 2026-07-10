/**
 * 썸네일 색 유틸 (순수 함수) — circle-frame 파스텔 매트 배경 파생용.
 *
 * accentColor(#RRGGBB)를 흰색/검정과 혼합해 파스텔 그라데이션·본문색을 만든다.
 * 헥스가 아닌 값(rgb() 등)이 오면 기본 코랄 파생 팔레트로 폴백한다.
 */

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** 파스텔 매트 팔레트 — circle-frame 템플릿이 소비. */
export interface PastelPalette {
  /** 그라데이션 시작(더 밝음) */
  readonly bgFrom: string;
  /** 그라데이션 끝(살짝 진함) */
  readonly bgTo: string;
  /** 제목 본문색 (강조색을 어둡게) */
  readonly titleColor: string;
  /** 병원명 등 보조 텍스트색 */
  readonly mutedColor: string;
}

function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) {
    const s = /^#([0-9a-fA-F]{3})$/.exec(hex.trim());
    if (!s) return null;
    const [r, g, b] = s[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b };
  }
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** 색을 흰색과 혼합 (t=0 원색, t=1 흰색). */
function mixWhite(c: Rgb, t: number): Rgb {
  return { r: c.r + (255 - c.r) * t, g: c.g + (255 - c.g) * t, b: c.b + (255 - c.b) * t };
}

/** 색을 검정과 혼합 (t=0 원색, t=1 검정). */
function mixBlack(c: Rgb, t: number): Rgb {
  return { r: c.r * (1 - t), g: c.g * (1 - t), b: c.b * (1 - t) };
}

/** 기본 코랄(#ff4628) 파생 팔레트 — 레퍼런스 HTML의 t5 배색과 동일 계열. */
const FALLBACK_PALETTE: PastelPalette = Object.freeze({
  bgFrom: '#ffe9e4',
  bgTo: '#ffd6cd',
  titleColor: '#3a1610',
  mutedColor: '#a4574a',
});

/** accentColor 에서 파스텔 매트 팔레트를 유도한다. */
export function derivePastelPalette(accentColor: string): PastelPalette {
  const rgb = parseHex(accentColor);
  if (!rgb) return FALLBACK_PALETTE;
  return {
    bgFrom: toHex(mixWhite(rgb, 0.88)),
    bgTo: toHex(mixWhite(rgb, 0.76)),
    titleColor: toHex(mixBlack(rgb, 0.72)),
    mutedColor: toHex(mixBlack(mixWhite(rgb, 0.18), 0.42)),
  };
}
