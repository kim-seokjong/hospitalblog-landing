/**
 * 템플릿 ② 풀 스크림 센터 — 사진 전체를 어둡게, 좌측 컬러바 + 중앙 제목(고급·집중형).
 */

import type { ReactElement } from 'react';
import type { TemplateViewModel } from './model';
import { fitTitleFontSize } from '../layout';
import { renderAccentedTitle } from './accent-title';

export function renderFullScrim(vm: TemplateViewModel): ReactElement {
  const { imageUrl, title, klabel, clinicName, accent, accentWord, fontFamily, size } = vm;
  const titleSize = fitTitleFontSize(title, 100, 50);

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
        height={size}
        style={{ position: 'absolute', top: 0, left: 0, width: size, height: size, objectFit: 'cover' }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          background: 'rgba(8,12,22,0.62)',
        }}
      />
      <div style={{ position: 'absolute', top: 0, left: 0, width: 20, height: size, background: accent }} />

      {klabel ? (
        <div
          style={{
            position: 'absolute',
            top: 108,
            left: 100,
            display: 'flex',
            color: accent,
            fontWeight: 800,
            fontSize: 40,
            letterSpacing: 2,
          }}
        >
          {klabel}
        </div>
      ) : null}

      <div
        style={{
          position: 'absolute',
          top: 360,
          left: 100,
          right: 100,
          display: 'flex',
          fontSize: titleSize,
          fontWeight: 800,
          color: '#ffffff',
          lineHeight: 1.3,
          textShadow: '0 3px 28px rgba(0,0,0,0.7)',
        }}
      >
        {renderAccentedTitle({ title, accentWord, accentStyle: { color: accent }, titleSize })}
      </div>

      {clinicName ? (
        <div
          style={{
            position: 'absolute',
            bottom: 90,
            left: 100,
            display: 'flex',
            fontSize: 32,
            color: '#eef1f6',
            fontWeight: 700,
          }}
        >
          {clinicName}
        </div>
      ) : null}
    </div>
  );
}
