/**
 * 스코어보드 외부 fetch 공용 유틸.
 * - 타임아웃 (기본 5초) — 외부 사이트가 느려도 페이지가 잡히지 않게 한다.
 * - 데스크톱 브라우저 UA — 공개 페이지의 표준 응답을 받기 위함.
 */

export const EXTERNAL_FETCH_TIMEOUT_MS = 5000;

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** 타임아웃이 걸린 fetch. 타임아웃/네트워크 실패는 예외로 던진다 (호출부에서 강등 처리). */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = EXTERNAL_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** "1,234" / "12.5K" / "1.2M" / "1.2만" / "3천" 등 표기를 숫자로. 실패 시 null. */
export function parseCount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : null;

  const text = raw.replace(/[\s,]/g, '').trim();
  if (!text) return null;

  const suffixMatch = text.match(/^([\d.]+)([KkMm만천]?)$/);
  if (!suffixMatch) return null;

  const base = Number(suffixMatch[1]);
  if (!Number.isFinite(base)) return null;

  const multipliers: Record<string, number> = {
    K: 1000, k: 1000,
    M: 1000000, m: 1000000,
    만: 10000,
    천: 1000,
  };
  const multiplier = suffixMatch[2] ? multipliers[suffixMatch[2]] ?? 1 : 1;
  return Math.round(base * multiplier);
}
