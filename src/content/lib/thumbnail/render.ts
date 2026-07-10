/**
 * 썸네일 카드 렌더 오케스트레이터.
 *
 * 입력 검증 → 뷰모델 구성 → 폰트 로드 → ImageResponse(satori) 렌더 → PNG 바이트.
 * 배경이 AI 생성이면(imageSource==='ai') PNG 바이트에 출처 메타데이터를 삽입한다.
 * 실제 업로드 사진이면(upload) 원본 그대로(메타데이터 미삽입) — 앞서 배포된 규칙.
 */

import { ImageResponse } from 'next/og';
import {
  DEFAULT_ACCENT_COLOR,
  THUMBNAIL_SIZE,
  THUMBNAIL_TEMPLATES,
  type ThumbnailParams,
  type ThumbnailTemplate,
  type ThumbnailImageSource,
} from './types';
import { clampText, isValidCssColor, normalizeTags } from './layout';
import { getTemplateRenderer, type TemplateViewModel } from './templates';
import { loadThumbnailFonts, THUMBNAIL_FONT_FAMILY } from './fonts';
import { insertTextChunks } from '@/content/lib/png-metadata';
import { buildProvenanceEntries } from '@/content/lib/ai-provenance';

export type ParseResult =
  | { readonly ok: true; readonly params: ThumbnailParams }
  | { readonly ok: false; readonly error: string };

function isTemplate(v: unknown): v is ThumbnailTemplate {
  return typeof v === 'string' && (THUMBNAIL_TEMPLATES as readonly string[]).includes(v);
}

function isSource(v: unknown): v is ThumbnailImageSource {
  return v === 'ai' || v === 'upload';
}

/** 요청 본문(unknown)을 검증해 ThumbnailParams 로 변환한다. */
export function parseThumbnailParams(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: '요청 본문이 올바르지 않습니다.' };
  }
  const b = raw as Record<string, unknown>;

  if (typeof b.imageUrl !== 'string' || !b.imageUrl.trim()) {
    return { ok: false, error: '배경 이미지 URL(imageUrl)이 필요합니다.' };
  }
  const imageUrl = b.imageUrl.trim();
  if (!/^https?:\/\//i.test(imageUrl) && !/^data:image\//i.test(imageUrl)) {
    return { ok: false, error: '배경 이미지 URL 형식이 올바르지 않습니다.' };
  }

  if (typeof b.title !== 'string' || !b.title.trim()) {
    return { ok: false, error: '카드 제목(title)이 필요합니다.' };
  }

  if (!isTemplate(b.template)) {
    return { ok: false, error: '템플릿(template)이 올바르지 않습니다.' };
  }

  const imageSource: ThumbnailImageSource = isSource(b.imageSource) ? b.imageSource : 'ai';

  let accentColor: string | undefined;
  if (typeof b.accentColor === 'string' && b.accentColor.trim()) {
    if (!isValidCssColor(b.accentColor)) {
      return { ok: false, error: '강조색(accentColor) 형식이 올바르지 않습니다.' };
    }
    accentColor = b.accentColor.trim();
  }

  const tags = Array.isArray(b.tags)
    ? b.tags.filter((t): t is string => typeof t === 'string')
    : undefined;

  return {
    ok: true,
    params: {
      imageUrl,
      title: b.title,
      klabel: typeof b.klabel === 'string' ? b.klabel : undefined,
      tags,
      clinicName: typeof b.clinicName === 'string' ? b.clinicName : undefined,
      accentColor,
      template: b.template,
      imageSource,
    },
  };
}

function buildViewModel(params: ThumbnailParams): TemplateViewModel {
  return {
    imageUrl: params.imageUrl,
    title: clampText(params.title, 80),
    klabel: clampText(params.klabel, 24),
    tags: normalizeTags(params.tags),
    clinicName: clampText(params.clinicName, 24),
    accent: params.accentColor && isValidCssColor(params.accentColor) ? params.accentColor : DEFAULT_ACCENT_COLOR,
    fontFamily: THUMBNAIL_FONT_FAMILY,
    size: THUMBNAIL_SIZE,
  };
}

export interface RenderedThumbnail {
  readonly bytes: Uint8Array;
  readonly contentType: 'image/png';
}

/**
 * 검증된 파라미터로 카드 PNG 바이트를 생성한다.
 * AI 배경이면 출처 메타데이터를 삽입한 바이트를 반환한다.
 */
export async function renderThumbnail(params: ThumbnailParams): Promise<RenderedThumbnail> {
  const vm = buildViewModel(params);
  const fonts = await loadThumbnailFonts();
  const element = getTemplateRenderer(params.template)(vm);

  const response = new ImageResponse(element, {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })),
  });

  const png = new Uint8Array(await response.arrayBuffer());

  // 업로드(실제 사진) 배경은 원본 그대로, AI 배경만 출처 메타데이터 삽입.
  const bytes = params.imageSource === 'ai' ? insertTextChunks(png, buildProvenanceEntries()) : png;

  return { bytes, contentType: 'image/png' };
}
