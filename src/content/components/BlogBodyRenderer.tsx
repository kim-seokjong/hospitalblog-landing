'use client';

import React from 'react';
import type { GeneratedImage } from '@/types';

/**
 * 본문 마커 렌더링의 단일 소스 오브 트루스.
 * ContentPreview 인라인 미리보기와 BodyEditorModal 미리보기가 동일한 로직을 공유한다.
 *
 * 지원 마커:
 *  - `▶ ...`                      → 세부 소제목(H3)
 *  - 앞이 빈 줄인 10~45자 짧은 줄   → 주요 소제목(H2)
 *  - `[핵심 요약] ... [/핵심 요약]`  → 요약 박스
 *  - `[자주 묻는 질문] ... [/자주 묻는 질문]` → FAQ 박스
 *  - `[이미지 N: 설명]`            → 이미지 자리표시자(실제 썸네일 있으면 교체)
 */

type Highlight = (text: string) => React.ReactNode;

export interface RenderBlogBodyOptions {
  /** 위반 단어 하이라이트 등 텍스트 후처리. 미지정 시 원문 그대로. */
  highlight?: Highlight;
  /**
   * 생성된 이미지 목록. `[이미지 N: 설명]` 위치에 N번째(images[N-1]) 썸네일을 인라인 렌더한다.
   * 미지정이거나 해당 이미지가 없으면 기존 점선 칩으로 폴백.
   */
  images?: GeneratedImage[];
}

const identity: Highlight = (t) => t;

function renderSummaryBox(lines: string[], keyPrefix: string, highlight: Highlight): React.ReactNode {
  const items = lines.map((l) => l.trim()).filter(Boolean);
  return (
    <div
      key={keyPrefix}
      className="my-4 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-emerald-50 p-3 sm:p-4"
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-base">💡</span>
        <span className="text-xs sm:text-sm font-bold text-blue-700">핵심 요약</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((s, idx) => (
          <li key={idx} className="text-xs sm:text-sm text-gray-800 leading-relaxed flex items-start gap-1.5">
            <span className="text-blue-500 mt-0.5 flex-shrink-0">•</span>
            <span>{highlight(s)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderFaqBox(lines: string[], keyPrefix: string, highlight: Highlight): React.ReactNode {
  const pairs: { q: string; a: string }[] = [];
  let cur: { q: string; a: string } | null = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (/^Q\d+\./.test(t)) {
      if (cur) pairs.push(cur);
      cur = { q: t, a: '' };
    } else if (/^A\d+\./.test(t)) {
      if (cur) cur.a = t;
    } else if (cur && cur.a) {
      cur.a += ' ' + t;
    }
  }
  if (cur) pairs.push(cur);

  return (
    <div
      key={keyPrefix}
      className="my-4 rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50 p-3 sm:p-4"
    >
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-base">❓</span>
        <span className="text-xs sm:text-sm font-bold text-indigo-700">자주 묻는 질문</span>
      </div>
      <div className="space-y-3">
        {pairs.map((qa, idx) => (
          <div key={idx} className="space-y-1">
            <p className="text-xs sm:text-sm font-bold text-indigo-800">{highlight(qa.q)}</p>
            <p className="text-xs sm:text-sm text-gray-800 leading-relaxed pl-3">{highlight(qa.a)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 마커 번호 N 에 해당하는 이미지를 찾는다.
 *
 * ★ 배열 위치가 아니라 id("img-N")로 찾는다 — 이미지 생성은 부분 실패를 허용해서
 *   2번만 실패하면 배열이 [1번, 3번] 이 되고, images[n-1] 로 읽으면 3번 사진이
 *   2번 설명 자리에 뜬다(저장·서브블로그 렌더와도 어긋난다).
 *   id 가 없는 구 데이터일 때만 배열 위치로 폴백한다.
 */
function findImageForMarker(images: GeneratedImage[] | undefined, n: number): GeneratedImage | undefined {
  if (!images || !Number.isFinite(n)) return undefined;
  const byId = images.find((img) => img.id === `img-${n}`);
  if (byId) return byId;
  const hasSlotIds = images.some((img) => /^img-\d+$/.test(img.id ?? ''));
  return hasSlotIds ? undefined : images[n - 1];
}

function renderImagePlaceholder(
  line: string,
  keyPrefix: string,
  images?: GeneratedImage[],
): React.ReactNode {
  const match = line.match(/^\[이미지\s*(\d+):/);
  const caption = line.replace(/[\[\]]/g, '');
  const n = match ? parseInt(match[1], 10) : NaN;
  const img = findImageForMarker(images, n);

  // 실제 생성 이미지가 있으면 인라인 썸네일(네이버형 본문 내 이미지 느낌)
  if (img) {
    return (
      <figure key={keyPrefix} className="my-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.url}
          alt={caption}
          className="w-full max-w-md mx-auto rounded-lg border border-gray-200 object-cover"
        />
        <figcaption className="mt-1 text-center text-[10px] text-blue-700">{caption}</figcaption>
      </figure>
    );
  }

  // 폴백: 기존 점선 칩
  return (
    <div
      key={keyPrefix}
      className="my-2 bg-blue-50 border border-dashed border-blue-300 rounded-lg px-3 py-2 flex items-center gap-2"
    >
      <span className="text-blue-600 text-sm">🖼</span>
      <span className="text-xs text-blue-700">{caption}</span>
    </div>
  );
}

export function renderBlogBody(text: string, options: RenderBlogBodyOptions = {}): React.ReactNode[] {
  const highlight = options.highlight ?? identity;
  const images = options.images;

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // TL;DR 블록
    if (trimmed === '[핵심 요약]') {
      const buf: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '[/핵심 요약]') {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing tag
      elements.push(renderSummaryBox(buf, `summary-${key++}`, highlight));
      continue;
    }

    // FAQ 블록
    if (trimmed === '[자주 묻는 질문]') {
      const buf: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '[/자주 묻는 질문]') {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing tag
      elements.push(renderFaqBox(buf, `faq-${key++}`, highlight));
      continue;
    }

    // 세부 소제목 (H3)
    if (line.startsWith('▶')) {
      elements.push(
        <h3 key={`h3-${key++}`} className="text-sm font-semibold text-[#ff4628] mt-3 mb-1 pl-2 border-l-2 border-[#ff4628]/40">
          {highlight(line.replace(/^▶\s*/, ''))}
        </h3>
      );
      i++;
      continue;
    }

    // 이미지 자리표시자
    if (/^\[이미지\s*\d+:/.test(line)) {
      elements.push(renderImagePlaceholder(line, `img-${key++}`, images));
      i++;
      continue;
    }

    // 주요 소제목 (H2): 앞이 빈 줄이고 길이 10~45자, 대괄호로 시작 안 함
    if (
      trimmed.length >= 10 &&
      trimmed.length <= 45 &&
      !trimmed.startsWith('[')
    ) {
      const prevEmpty = i === 0 || lines[i - 1]?.trim() === '';
      if (prevEmpty) {
        elements.push(
          <h2 key={`h2-${key++}`} className="text-sm font-bold text-gray-900 mt-5 mb-2">
            {highlight(line)}
          </h2>
        );
        i++;
        continue;
      }
    }

    // 빈 줄
    if (trimmed === '') {
      elements.push(<br key={`br-${key++}`} />);
      i++;
      continue;
    }

    // 일반 단락
    elements.push(
      <p key={`p-${key++}`} className="text-gray-800 leading-relaxed text-xs mb-1">
        {highlight(line)}
      </p>
    );
    i++;
  }

  return elements;
}
