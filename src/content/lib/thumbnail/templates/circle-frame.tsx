/**
 * 템플릿 ⑤ 컬러 매트 + 원형 윈도우 — 파스텔 배경(강조색 연화 그라데이션)에
 * 상단 원형 사진 프레임(흰 보더) + 하단 중앙 제목. 소아과·피부과 등 밝은 과 감성.
 * satori 원형 크롭: borderRadius 50% + overflow hidden.
 */

import type { ReactElement } from 'react';
import type { TemplateViewModel } from './model';
import { fitTitleFontSize } from '../layout';
import { derivePastelPalette } from '../color';
import { renderAccentedTitle } from './accent-title';

export function renderCircleFrame(vm: TemplateViewModel): ReactElement {
  const { imageUrl, title, klabel, clinicName, accent, accentWord, fontFamily, size } = vm;
  const palette = derivePastelPalette(accent);
  const circleSize = Math.round(size * 0.575); // 620px @1080
  const borderWidth = 24;
  const innerSize = circleSize - borderWidth * 2;
  const titleSize = fitTitleFontSize(title, 72, 42);

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        fontFamily,
        overflow: 'hidden',
        background: `linear-gradient(160deg, ${palette.bgFrom}, ${palette.bgTo})`,
      }}
    >
      {klabel ? (
        <div
          style={{
            position: 'absolute',
            top: 54,
            left: 64,
            display: 'flex',
            background: '#ffffff',
            color: accent,
            fontWeight: 800,
            fontSize: 33,
            padding: '13px 32px',
            borderRadius: 43,
            boxShadow: '0 8px 22px rgba(60,20,10,0.18)',
          }}
        >
          {klabel}
        </div>
      ) : null}

      {/* 원형 사진 프레임 — 흰 보더 + 원형 크롭 */}
      <div
        style={{
          position: 'absolute',
          top: 88,
          left: Math.round((size - circleSize) / 2),
          width: circleSize,
          height: circleSize,
          display: 'flex',
          borderRadius: '50%',
          border: `${borderWidth}px solid #ffffff`,
          overflow: 'hidden',
          boxShadow: '0 20px 55px rgba(60,20,10,0.25)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          width={innerSize}
          height={innerSize}
          style={{ width: innerSize, height: innerSize, objectFit: 'cover', borderRadius: '50%' }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 70,
          right: 70,
          bottom: 172,
          display: 'flex',
          justifyContent: 'center',
          fontSize: titleSize,
          fontWeight: 800,
          color: palette.titleColor,
          lineHeight: 1.3,
          textAlign: 'center',
        }}
      >
        {renderAccentedTitle({
          title,
          accentWord,
          accentStyle: { color: accent },
          titleSize,
          align: 'center',
        })}
      </div>

      {clinicName ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 70,
            display: 'flex',
            justifyContent: 'center',
            fontSize: 33,
            color: palette.mutedColor,
            fontWeight: 800,
          }}
        >
          {clinicName}
        </div>
      ) : null}
    </div>
  );
}
