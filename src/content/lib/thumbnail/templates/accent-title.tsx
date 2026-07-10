/**
 * 제목 강조 어절 렌더 헬퍼 — 카피 톤 시스템(accentWord) 공용.
 *
 * satori 제약: 자동 인라인 텍스트 흐름이 제한적이라, 강조 어절이나 명시 줄바꿈('\n')이
 * 있으면 제목을 어절 단위 span 으로 분해해 flexWrap 으로 배치한다.
 * accentWord 미지정 + 단일 줄이면 문자열을 그대로 반환해 기존 동작을 유지한다.
 */

import type { CSSProperties, ReactElement, ReactNode } from 'react';

export interface AccentTitleOptions {
  /** 제목 전문 ('\n' = 명시 줄바꿈) */
  readonly title: string;
  /** 강조할 어절 (빈 문자열이면 강조 없음) */
  readonly accentWord: string;
  /** 강조 어절 span 에 얹을 스타일 (색/배경 등) */
  readonly accentStyle: CSSProperties;
  /** 제목 폰트 크기(px) — 어절 간격 계산용 */
  readonly titleSize: number;
  /** 줄 정렬 (기본 좌측) */
  readonly align?: 'flex-start' | 'center';
}

/** 어절이 강조 대상인지 — 조사·문장부호가 붙은 어절도 포함 매칭으로 커버. */
function isAccented(word: string, accentWord: string): boolean {
  return accentWord.length > 0 && word.includes(accentWord);
}

/**
 * 제목을 렌더 노드로 변환한다.
 * 강조 어절/줄바꿈이 없으면 문자열 그대로(기존 경로), 있으면 어절 span 트리를 반환한다.
 */
export function renderAccentedTitle(opts: AccentTitleOptions): ReactNode {
  const { title, accentWord, accentStyle, titleSize, align = 'flex-start' } = opts;

  const hasAccent = accentWord.length > 0 && title.includes(accentWord);
  const hasBreak = title.includes('\n');
  if (!hasAccent && !hasBreak) return title;

  const wordGap = Math.round(titleSize * 0.24);
  const lines = title
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const lineElements: ReactElement[] = lines.map((line, li) => (
    <div
      key={`line-${li}`}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: align,
        columnGap: wordGap,
      }}
    >
      {line.split(/\s+/).filter(Boolean).map((word, wi) => (
        <span
          key={`w-${li}-${wi}`}
          style={isAccented(word, accentWord) ? accentStyle : undefined}
        >
          {word}
        </span>
      ))}
    </div>
  ));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: align }}>
      {lineElements}
    </div>
  );
}
