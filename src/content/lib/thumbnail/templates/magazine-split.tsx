/**
 * 템플릿 ④ 매거진 스플릿 — 좌 55% 사진 / 우 다크 텍스트 패널(잡지 화보형).
 * 사진·글자 완전 분리 = 가독성 최상. satori flex 기반이라 가장 자연스러운 레이아웃.
 */

import type { ReactElement } from 'react';
import type { TemplateViewModel } from './model';
import { fitTitleFontSize } from '../layout';
import { renderAccentedTitle } from './accent-title';

export function renderMagazineSplit(vm: TemplateViewModel): ReactElement {
  const { imageUrl, title, klabel, clinicName, accent, accentWord, fontFamily, size } = vm;
  const photoWidth = Math.round(size * 0.55);
  const titleSize = fitTitleFontSize(title, 74, 42);

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        fontFamily,
        overflow: 'hidden',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt=""
        width={photoWidth}
        height={size}
        style={{ width: photoWidth, height: size, objectFit: 'cover' }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          flexGrow: 1,
          height: size,
          background: '#10151e',
          padding: '0 58px',
          gap: 32,
        }}
      >
        {klabel ? (
          <div style={{ display: 'flex', color: accent, fontWeight: 800, fontSize: 35, letterSpacing: 1 }}>
            {klabel}
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            fontSize: titleSize,
            fontWeight: 800,
            color: '#ffffff',
            lineHeight: 1.3,
          }}
        >
          {renderAccentedTitle({ title, accentWord, accentStyle: { color: accent }, titleSize })}
        </div>

        <div style={{ display: 'flex', width: 108, height: 11, background: accent, borderRadius: 6 }} />

        {clinicName ? (
          <div style={{ display: 'flex', fontSize: 31, color: '#93a0b1', fontWeight: 700 }}>
            {clinicName}
          </div>
        ) : null}
      </div>
    </div>
  );
}
