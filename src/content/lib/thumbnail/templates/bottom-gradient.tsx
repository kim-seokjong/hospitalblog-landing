/**
 * 템플릿 ① 바텀 그라데이션 — 네이버 썸네일에서 가장 흔한 형(안전빵).
 * 배경 사진 아래쪽에 어두운 그라데이션을 깔고 라벨/제목/태그/병원명을 얹는다.
 */

import type { ReactElement } from 'react';
import type { TemplateViewModel } from './model';
import { fitTitleFontSize } from '../layout';
import { renderAccentedTitle } from './accent-title';

export function renderBottomGradient(vm: TemplateViewModel): ReactElement {
  const { imageUrl, title, klabel, tags, clinicName, accent, accentWord, fontFamily, size } = vm;
  const titleSize = fitTitleFontSize(title, 92, 46);

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
          background:
            'linear-gradient(to top, rgba(6,10,20,0.92) 8%, rgba(6,10,20,0.55) 38%, rgba(0,0,0,0) 66%)',
        }}
      />

      {klabel ? (
        <div
          style={{
            position: 'absolute',
            left: 84,
            bottom: 456,
            display: 'flex',
            color: '#ffffff',
            background: accent,
            fontWeight: 800,
            fontSize: 34,
            padding: '12px 28px',
            borderRadius: 16,
          }}
        >
          {klabel}
        </div>
      ) : null}

      <div
        style={{
          position: 'absolute',
          left: 84,
          right: 84,
          bottom: 235,
          display: 'flex',
          fontSize: titleSize,
          fontWeight: 800,
          color: '#ffffff',
          lineHeight: 1.26,
          textShadow: '0 3px 24px rgba(0,0,0,0.6)',
        }}
      >
        {renderAccentedTitle({ title, accentWord, accentStyle: { color: accent }, titleSize })}
      </div>

      {tags.length > 0 ? (
        <div style={{ position: 'absolute', left: 84, bottom: 120, display: 'flex', gap: 20 }}>
          {tags.map((tag) => (
            <div
              key={tag}
              style={{
                display: 'flex',
                background: 'rgba(255,255,255,0.16)',
                border: '2px solid rgba(255,255,255,0.28)',
                padding: '10px 24px',
                borderRadius: 44,
                fontSize: 28,
                color: '#ffffff',
              }}
            >
              {tag}
            </div>
          ))}
        </div>
      ) : null}

      {clinicName ? (
        <div
          style={{
            position: 'absolute',
            right: 84,
            bottom: 74,
            display: 'flex',
            fontSize: 30,
            color: '#dfe4ec',
            fontWeight: 700,
          }}
        >
          {clinicName}
        </div>
      ) : null}
    </div>
  );
}
