/**
 * 카드 레이아웃 계산 유틸 (순수 함수).
 *
 * satori는 CSS 자동 맞춤(fit)이 없으므로 제목 길이에 따라 폰트 크기를 미리 정한다.
 * 값은 1080px 정사각 캔버스 기준.
 */

import { THUMBNAIL_SIZE } from './types';

/** 헥스/컬러 문자열 여부를 느슨하게 검사한다(외부 입력 방어). */
export function isValidCssColor(value: string): boolean {
  const v = value.trim();
  // #RGB, #RRGGBB, #RRGGBBAA 또는 rgb()/rgba() 만 허용 (satori 안전 범위).
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return true;
  if (/^rgba?\(\s*[\d.,%\s/]+\)$/.test(v)) return true;
  return false;
}

/** 문자열을 안전한 길이로 자르고 앞뒤 공백을 제거한다. */
export function clampText(value: string | undefined, max: number): string {
  if (!value) return '';
  const t = value.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * 제목 길이에 따라 폰트 크기(px)를 반환한다.
 * base = 짧은 제목용 최대 크기. 길수록 단계적으로 축소.
 */
export function fitTitleFontSize(title: string, base: number, min: number): number {
  const len = [...title].length; // 한글도 1자로 계산
  if (len <= 12) return base;
  if (len <= 18) return Math.round(base * 0.86);
  if (len <= 26) return Math.round(base * 0.72);
  if (len <= 36) return Math.round(base * 0.6);
  return Math.max(min, Math.round(base * 0.5));
}

/** 태그 배열을 정제한다 — 최대 3개, 각 12자, '#' 접두어 보장. */
export function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  return tags
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .map((t) => clampText(t, 13));
}

/** 캔버스 한 변 (px). */
export const SIZE = THUMBNAIL_SIZE;
