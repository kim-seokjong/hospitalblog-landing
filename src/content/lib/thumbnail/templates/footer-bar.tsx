/**
 * 템플릿 ③ 하단 컬러바 + 사진 — 사진은 위쪽에 깨끗하게, 글자는 아래 컬러 패널(가독성↑).
 */

import type { ReactElement } from 'react';
import type { TemplateViewModel } from './model';
import { fitTitleFontSize } from '../layout';
import { renderAccentedTitle } from './accent-title';

export function renderFooterBar(vm: TemplateViewModel): ReactElement {
  const { imageUrl, title, klabel, clinicName, accent, accentWord, fontFamily, size } = vm;
  const photoHeight = Math.round(size * 0.62);
  const footHeight = size - photoHeight;
  const titleSize = fitTitleFontSize(title, 76, 40);

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
        width={size}
        height={photoHeight}
        style={{ position: 'absolute', top: 0, left: 0, width: size, height: photoHeight, objectFit: 'cover' }}
      />

      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: size,
          height: footHeight,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #122036, #0b1524)',
          padding: '0 72px',
        }}
      >
        <div style={{ display: 'flex', color: accent, fontWeight: 800, fontSize: 34, marginBottom: 20 }}>
          {klabel || '가이드'}
        </div>
        <div style={{ display: 'flex', fontSize: titleSize, fontWeight: 800, color: '#ffffff', lineHeight: 1.25 }}>
          {renderAccentedTitle({ title, accentWord, accentStyle: { color: accent }, titleSize })}
        </div>
      </div>

      {clinicName ? (
        <div
          style={{
            position: 'absolute',
            right: 72,
            bottom: 48,
            display: 'flex',
            fontSize: 28,
            color: '#aeb8c6',
            fontWeight: 700,
          }}
        >
          {clinicName}
        </div>
      ) : null}
    </div>
  );
}
