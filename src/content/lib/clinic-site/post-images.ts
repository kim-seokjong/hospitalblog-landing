/**
 * 병원 서브도메인 블로그 — 본문 이미지 배치 (순수 로직 모듈).
 *
 * 배경: saved_posts.image_urls 는 저장되지만(fix/compliance-and-save) 자체 블로그
 * 렌더 경로가 이미지를 아예 읽지도, 그리지도 않아 텍스트만 나가고 있었다.
 *
 * 배치 규칙과 근거:
 *  1) **본문의 `[이미지 N: 설명]` 마커가 곧 이미지 위치다.** 생성 프롬프트가 소제목
 *     아래마다 이 마커를 심고(api/generate-content), 앱 미리보기(BlogBodyRenderer)와
 *     이미지 생성(api/generate-images)이 이미 `N ↔ image_urls[N-1]` 로 매핑한다.
 *     자체 블로그도 같은 매핑을 쓰면 앱 미리보기·네이버 발행본·자체 블로그 세 화면의
 *     이미지 위치가 일치한다. 새 규칙을 만들면 세 화면이 어긋난다.
 *  2) 마커가 하나도 없는 글(수동 편집·구 데이터)만 블록 사이 균등 배치로 폴백한다
 *     (geo-export `renderBodyHtml`).
 *  3) 대체 텍스트(alt)는 마커 설명을 그대로 쓴다 — 그 설명이 곧 이미지 생성 프롬프트라
 *     화면 내용을 가장 정확히 기술한다. 설명이 없을 때만 제목 기반으로 만든다.
 *
 * 보안: 렌더 대상 URL 은 clinic-site/theme.ts `isAllowedClinicAssetUrl` 을
 *  **직접 import 해서** 판정한다(규칙 복제 없음 = 동치 보장). 외부 URL·data URL 은
 *  걸러져 화면에 나가지 않는다.
 *
 * ⚠️ 러너 제약(theme.ts·slug.ts 패턴): node --experimental-strip-types 가 별칭 해석
 *    없이 로드할 수 있도록 상대 경로 + 확장자 import 만 쓴다.
 */

import { isAllowedClinicAssetUrl } from './theme.ts';
import type { BodyImage } from '../geo-export.ts';

/** 한 글에 렌더할 이미지 수 상한 — saved-post-fields.MAX_IMAGE_URLS 와 동일. */
export const MAX_BODY_IMAGES = 12;

/** alt 최대 길이(자) — 스크린리더가 감당할 범위. 초과분은 말줄임. */
export const MAX_ALT_LENGTH = 120;

/** `[이미지 N: 설명]` — 번호와 설명을 캡처한다(줄 단위·인라인 공용). */
const IMAGE_MARKER_RE = /\[이미지\s*(\d+)\s*:([^\]]*)\]/g;

/** 공백 정규화 + 길이 상한. 내용이 없으면 빈 문자열. */
function condense(raw: string, max: number): string {
  const collapsed = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return '';
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

/**
 * 본문에서 `[이미지 N: 설명]` 의 설명을 번호별로 모은다 (1-based N → 설명).
 * 같은 번호가 여러 번 나오면 첫 번째 설명을 쓴다.
 */
export function extractImageDescriptions(bodyText: string): Map<number, string> {
  const out = new Map<number, string>();
  const re = new RegExp(IMAGE_MARKER_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(bodyText ?? '')) !== null) {
    const n = Number.parseInt(match[1], 10);
    if (!Number.isFinite(n) || n <= 0 || out.has(n)) continue;
    const desc = condense(match[2], MAX_ALT_LENGTH);
    if (desc.length > 0) out.set(n, desc);
  }
  return out;
}

/**
 * 렌더 가능한 이미지 URL 만 남긴다 — 화이트리스트 통과분, 중복 제거, 개수 캡.
 *
 * 판정은 theme.ts 의 `isAllowedClinicAssetUrl` 그대로다(자체 Supabase
 * clinic-assets public 경로만). 외부 CDN·data URL 은 전부 탈락한다.
 */
export function sanitizeClinicImageUrls(
  raw: unknown,
  supabaseUrl: string | null | undefined,
): string[] {
  if (!Array.isArray(raw)) return [];
  const items: readonly unknown[] = raw;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    if (!isAllowedClinicAssetUrl(item, supabaseUrl)) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= MAX_BODY_IMAGES) break;
  }
  return out;
}

/**
 * 대체 텍스트(alt)를 만든다.
 *  - 마커 설명이 있으면 그대로 (이미지 내용을 가장 정확히 기술)
 *  - 없으면 제목 기반. 이미지가 여러 장일 때만 번호를 붙여 같은 문자열 반복을 피한다.
 */
export function buildImageAlt(
  description: string | null | undefined,
  title: string,
  index: number,
  total: number,
): string {
  const fromMarker = condense(description ?? '', MAX_ALT_LENGTH);
  if (fromMarker.length > 0) return fromMarker;

  const base = condense(title ?? '', MAX_ALT_LENGTH - 12);
  if (base.length === 0) return total > 1 ? `본문 이미지 ${index + 1}` : '본문 이미지';
  return total > 1 ? `${base} 설명 이미지 ${index + 1}` : `${base} 설명 이미지`;
}

/**
 * 본문 + 저장된 image_urls → 렌더용 이미지 목록.
 * 배열 index i 는 마커 번호 i+1 에 대응한다(renderBodyHtml 계약).
 * 렌더 가능한 URL 이 없으면 빈 배열 → 이미지 없는 글과 완전히 동일하게 렌더된다.
 */
export function buildClinicPostImages(
  bodyText: string,
  rawImageUrls: unknown,
  supabaseUrl: string | null | undefined,
  title: string,
): BodyImage[] {
  const urls = sanitizeClinicImageUrls(rawImageUrls, supabaseUrl);
  if (urls.length === 0) return [];

  const descriptions = extractImageDescriptions(bodyText);
  return urls.map((url, i) => ({
    url,
    alt: buildImageAlt(descriptions.get(i + 1) ?? null, title, i, urls.length),
  }));
}

/**
 * 대표 이미지(OG·JSON-LD Article.image) — 첫 번째 렌더 가능 이미지.
 *
 * 본문 위에 히어로로 한 번 더 그리지는 않는다: 그 이미지는 이미 마커 위치에
 * 본문 안에서 렌더되므로 중복 노출이 된다. 대표 이미지는 **공유 카드·검색·AI 인용
 * 메타데이터 용도로만** 쓴다.
 */
export function pickLeadImageUrl(images: ReadonlyArray<BodyImage>): string | null {
  return images.length > 0 ? images[0].url : null;
}
