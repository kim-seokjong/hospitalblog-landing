/**
 * 템플릿 ⑥ 맥시멀 타이포 — 풀블리드 사진 + 강한 바텀 그라데이션 + 기울어진 klabel 배지
 * + 거대 타이포(강조 어절 = 강조색 하이라이트 박스) + 최하단 해시태그/병원명 스트립.
 * 네이버 피드에서 가장 시선 강탈하는 형. satori 는 transform rotate 를 지원한다.
 */

import type { ReactElement } from 'react';
import type { TemplateViewModel } from './model';
import { fitTitleFontSize } from '../layout';
import { renderAccentedTitle } from './accent-title';

export function renderTypoMaximal(vm: TemplateViewModel): ReactElement {
  const { imageUrl, title, klabel, tags, clinicName, accent, accentWord, fontFamily, size } = vm;
  const titleSize = fitTitleFontSize(title, 112, 56);

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
            'linear-gradient(to top, rgba(4,8,16,0.96) 12%, rgba(4,8,16,0.42) 52%, rgba(0,0,0,0.05) 78%)',
        }}
      />

      {klabel ? (
        <div
          style={{
            position: 'absolute',
            top: 60,
            left: 64,
            display: 'flex',
            background: accent,
            color: '#ffffff',
            fontWeight: 800,
            fontSize: 35,
            padding: '16px 35px',
            borderRadius: 21,
            transform: 'rotate(-3deg)',
            boxShadow: '0 10px 26px rgba(0,0,0,0.4)',
          }}
        >
          {klabel}
        </div>
      ) : null}

      <div
        style={{
          position: 'absolute',
          left: 60,
          right: 60,
          bottom: 176,
          display: 'flex',
          fontSize: titleSize,
          fontWeight: 800,
          color: '#ffffff',
          lineHeight: 1.2,
          letterSpacing: -2,
          textShadow: '0 6px 34px rgba(0,0,0,0.65)',
        }}
      >
        {renderAccentedTitle({
          title,
          accentWord,
          accentStyle: {
            color: '#ffd9d2',
            background: accent,
            padding: '0 18px',
            borderRadius: 18,
          },
          titleSize,
        })}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 60,
          right: 60,
          bottom: 70,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 30,
          color: '#c9d1dc',
          fontWeight: 700,
        }}
      >
        <div style={{ display: 'flex', gap: 18 }}>
          {tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        {clinicName ? <span>{clinicName}</span> : <span />}
      </div>
    </div>
  );
}
