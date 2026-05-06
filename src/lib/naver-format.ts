/**
 * 본문 내부의 GEO 마커를 네이버 블로그 친화적인 평문 헤더로 변환한다.
 *
 * 변환 규칙:
 *   [핵심 요약]      → "■ 핵심 요약"
 *   [/핵심 요약]     → 제거 (뒤이은 빈 줄로 자연스러운 단락 구분)
 *   [자주 묻는 질문] → "■ 자주 묻는 질문"
 *   [/자주 묻는 질문] → 제거
 */
export function toNaverFormat(body: string): string {
  return body
    .replace(/\[핵심 요약\]/g, '■ 핵심 요약')
    .replace(/\[\/핵심 요약\]\s*/g, '')
    .replace(/\[자주 묻는 질문\]/g, '■ 자주 묻는 질문')
    .replace(/\[\/자주 묻는 질문\]\s*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * TL;DR / FAQ 블록(원본 마커 기준)을 본문에서 분리한다.
 * 이미지 자리표시자 삽입 시 두 블록 내부에 이미지가 끼어들지 않도록 보호하는 용도.
 */
export interface BodySegments {
  intro: string;
  summaryBlock: string;
  middle: string;
  faqBlock: string;
}

export function splitBodyByMarkers(body: string): BodySegments {
  const summaryMatch = body.match(/\n*\[핵심 요약\][\s\S]+?\[\/핵심 요약\]\n*/);
  const faqMatch = body.match(/\n*\[자주 묻는 질문\][\s\S]+?\[\/자주 묻는 질문\]\n*/);

  const summaryBlock = summaryMatch?.[0] ?? '';
  const faqBlock = faqMatch?.[0] ?? '';

  let working = body;
  let intro = '';
  let middle = working;

  if (summaryBlock) {
    const idx = working.indexOf(summaryBlock);
    intro = working.slice(0, idx);
    middle = working.slice(idx + summaryBlock.length);
  }

  if (faqBlock) {
    const idx = middle.indexOf(faqBlock);
    if (idx >= 0) middle = middle.slice(0, idx);
  }

  return {
    intro: intro.trim(),
    summaryBlock: summaryBlock.trim(),
    middle: middle.trim(),
    faqBlock: faqBlock.trim(),
  };
}
