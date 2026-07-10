/**
 * 템플릿 레지스트리 — 템플릿 id → 렌더 함수 매핑.
 */

import type { ReactElement } from 'react';
import type { ThumbnailTemplate } from '../types';
import type { TemplateViewModel } from './model';
import { renderBottomGradient } from './bottom-gradient';
import { renderFullScrim } from './full-scrim';
import { renderFooterBar } from './footer-bar';

export type { TemplateViewModel } from './model';

type TemplateRenderer = (vm: TemplateViewModel) => ReactElement;

const REGISTRY: Record<ThumbnailTemplate, TemplateRenderer> = {
  'bottom-gradient': renderBottomGradient,
  'full-scrim': renderFullScrim,
  'footer-bar': renderFooterBar,
};

/** 템플릿 id 에 해당하는 렌더 함수를 반환한다. */
export function getTemplateRenderer(template: ThumbnailTemplate): TemplateRenderer {
  return REGISTRY[template];
}
