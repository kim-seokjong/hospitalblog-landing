/**
 * GEO Phase A — "GEO 발행본" 단일 HTML 문서 생성 (순수 로직 모듈).
 *
 * 배경: ChatGPT(Bing)·Gemini(구글)·Claude 는 네이버 인덱스를 쓰지 않아 네이버
 * 블로그 글은 AI 에 인용되지 않는다. 같은 글을 병원 공식 홈페이지에도 게시할
 * 수 있도록, 본문+JSON-LD+메타태그가 포함된 완결 HTML 1개를 만들어 준다.
 *
 * 입력 계약: 구조 파싱(요약·FAQ 추출, 블록 제거)과 JSON-LD 직렬화는
 * geo-schema.ts 가 담당하고, 이 모듈은 파싱 완료된 조각을 받아 조립만 한다
 * (테스트 러너 제약상 모듈 간 값 import 없이 각자 순수 모듈로 유지 — API
 * 라우트가 두 모듈을 오케스트레이션한다).
 *
 * 본문 포맷: 마크다운이 아니라 플레인 텍스트 구조 관례를 따른다 —
 * H2 = 빈 줄로 둘러싸인 짧은 독립 줄, H3 = "▶" 로 시작하는 줄, 단락 = 그 외.
 *
 * XSS: 본문·제목 등 파생 텍스트는 전부 HTML 이스케이프. jsonLd 는 직렬화
 * 단계에서 "</" 가 이스케이프된 문자열을 받되, 방어적으로 한 번 더 치환한다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

export interface GeoExportFaqItem {
  question: string;
  answer: string;
}

export interface GeoExportInput {
  title: string;
  /** 구조 블록([핵심 요약]/[자주 묻는 질문]/[이미지 N])이 제거된 순수 본문 */
  bodyText: string;
  /** meta description — 본문에서 파생된 요약(새 문구 생성 금지) */
  metaDescription: string;
  /** serializeJsonLd 결과 — "</" 이스케이프 완료된 JSON-LD 문자열 */
  jsonLd: string;
  /** [핵심 요약] 줄들 (없으면 빈 배열 → 섹션 생략) */
  summaryLines: ReadonlyArray<string>;
  /** [자주 묻는 질문] Q/A (없으면 빈 배열 → 섹션 생략) */
  faqItems: ReadonlyArray<GeoExportFaqItem>;
  /**
   * 저자 바이라인 텍스트("작성: …") — byline.ts formatBylineText 결과.
   * 없거나(null) 빈 문자열이면 바이라인 footer 를 생략한다.
   */
  bylineText?: string | null;
}

// ---------------------------------------------------------------------------
// 이스케이프·파일명
// ---------------------------------------------------------------------------

/** HTML 텍스트·속성 공용 이스케이프 (& < > " '). */
export function escapeHtml(value: string): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FILENAME_MAX = 60;
const FILENAME_FALLBACK = 'doctorpost-geo';

/**
 * 글 제목 → 다운로드 파일명 slug (.html 확장자 포함).
 * 한글은 보존하고 파일 시스템 금지 문자·제어문자만 제거, 공백은 하이픈.
 */
export function buildExportFilename(title: string): string {
  const slug = (title ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, FILENAME_MAX);
  return `${slug || FILENAME_FALLBACK}.html`;
}

// ---------------------------------------------------------------------------
// 본문(플레인 텍스트 구조) → 시맨틱 HTML
// ---------------------------------------------------------------------------

/** H2 후보 판정 — 빈 줄 사이의 짧은 독립 줄, 문장 종결('.')이 아닌 것. */
const H2_MAX_LEN = 45;
const H2_MIN_LEN = 6;

function isHeadingLine(line: string): boolean {
  if (line.length < H2_MIN_LEN || line.length > H2_MAX_LEN) return false;
  if (line.startsWith('▶')) return false;
  if (line.endsWith('.') || line.endsWith('!')) return false;
  return true;
}

/**
 * 본문에 렌더할 이미지 1장.
 *
 * url 은 **호출부가 화이트리스트 검증을 마친 값**이어야 한다
 * (clinic-site/theme.ts `isAllowedClinicAssetUrl` — 자체 Supabase clinic-assets
 * public 경로만). 이 모듈은 순수 문자열 조립만 하고 도메인 판정을 하지 않는다.
 */
export interface BodyImage {
  url: string;
  /** 대체 텍스트 — 비어 있으면 alt="" (장식 이미지로 취급). */
  alt: string;
}

/**
 * 이미지 슬롯 배열 — **index i 는 본문 마커 번호 i+1 을 뜻한다(위치 계약)**.
 *
 * null 은 "그 번호에는 이미지가 없다"는 뜻이며, 호출부는 검증에서 탈락한 URL 을
 * 배열에서 빼지 말고 반드시 null 로 남겨야 한다. 빼면 뒤 이미지가 앞 번호로
 * 당겨져 본문 설명과 다른 사진이 붙는다.
 */
export type BodyImageSlots = ReadonlyArray<BodyImage | null>;

/** 한 줄 전체가 `[이미지 N: 설명]` 인지 판정 (설명은 비어 있을 수 있다). */
const IMAGE_MARKER_LINE_RE = /^\[이미지\s*(\d+)\s*:[^\]]*\]$/;

/** 문단 안에 섞여 들어간 `[이미지 N: …]` 조각 — 화면에 텍스트로 새지 않게 제거한다. */
const INLINE_IMAGE_MARKER_RE = /\[이미지\s*\d+\s*:[^\]]*\]/g;

/** 줄이 이미지 마커면 1-based 번호, 아니면 null. */
function imageMarkerNumber(line: string): number | null {
  const match = IMAGE_MARKER_LINE_RE.exec(line);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * <figure><img> 한 덩어리. 반응형·지연로딩은 속성으로 고정하고(스타일 무관),
 * 시각 스타일은 호출부 CSS 에 맡긴다(스탠드얼론 HTML/서브블로그 양쪽에서 동작).
 */
function renderFigure(image: BodyImage): string {
  const alt = escapeHtml((image.alt ?? '').trim());
  return `<figure><img src="${escapeHtml(image.url)}" alt="${alt}" loading="lazy" decoding="async" /></figure>`;
}

/**
 * 마커가 하나도 없는 본문에서 이미지를 넣을 블록 경계를 고른다.
 *
 * k 번째(1-based) 이미지를 전체 B 블록 중 `round(B*k/(K+1))` 번째 블록 **뒤**에 둔다
 * — 첫 단락(도입부) 앞에는 절대 두지 않고(글의 훅을 밀어내지 않는다), 마지막
 * 블록 뒤로도 넘어가지 않아 본문 안에 고르게 흩어진다.
 */
function evenBoundaries(blockCount: number, imageCount: number): number[] {
  if (blockCount <= 0 || imageCount <= 0) return [];
  const out: number[] = [];
  for (let k = 1; k <= imageCount; k++) {
    const raw = Math.round((blockCount * k) / (imageCount + 1));
    out.push(Math.min(blockCount, Math.max(1, raw)));
  }
  return out;
}

/**
 * 플레인 텍스트 본문을 시맨틱 HTML 로 변환한다.
 * - "▶ …" 줄 → <h3>
 * - 빈 줄로 둘러싸인 짧은 독립 줄(문장 아님) → <h2>
 * - `[이미지 N: 설명]` 줄 → images[N-1] 이 있으면 <figure><img>, 없으면 아무것도 렌더하지 않음
 * - 그 외 → <p> (블록 내 줄바꿈은 <br /> 유지)
 * 모든 텍스트는 이스케이프되어 태그로 해석되지 않는다.
 *
 * 이미지 배치 규칙 (images 를 넘겼을 때만 동작 — 기본값 빈 배열이면 기존과 동일):
 *  1. 마커가 있으면 **마커 위치가 곧 이미지 위치**다. 앱 미리보기(BlogBodyRenderer)와
 *     네이버 발행본이 쓰는 매핑(N ↔ images[N-1])을 그대로 따라 세 화면이 일치한다.
 *     그래서 images 는 압축하면 안 되는 **슬롯 배열**이다(BodyImageSlots 참조).
 *  2. 마커에 대응하는 이미지가 없으면(슬롯이 null) 아무것도 렌더하지 않는다
 *     (기존 strip 동작 유지). 같은 번호가 여러 번 나오면 첫 마커에만 렌더한다.
 *  3. 마커가 하나도 없으면(수동 편집 글 등) 블록 사이에 균등 배치한다.
 *  4. 마커가 있는데 참조되지 않은 이미지가 남으면 본문 끝에 순서대로 덧붙인다(유실 방지).
 */
export function renderBodyHtml(bodyText: string, images: BodyImageSlots = []): string {
  const blocks = (bodyText ?? '')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const parts: string[] = [];
  /** 각 블록이 끝난 시점의 parts 길이 — 균등 배치 삽입 지점. */
  const blockEnds: number[] = [];
  const used = new Set<number>();
  let sawMarker = false;

  const pushImageAt = (n: number): void => {
    sawMarker = true;
    const image = images[n - 1];
    if (!image || used.has(n - 1)) return;
    used.add(n - 1);
    parts.push(renderFigure(image));
  };

  /**
   * 텍스트 줄에서 인라인 마커 조각을 제거한다.
   * 마커가 없던 줄은 **원문 그대로** 돌려준다 — 공백 정규화가 기존 렌더 결과를
   * 바꾸지 않게 하려는 것(회귀 방지).
   */
  const cleanTextLine = (line: string): string => {
    const withoutMarkers = line.replace(INLINE_IMAGE_MARKER_RE, '');
    if (withoutMarkers === line) return line;
    return withoutMarkers.replace(/\s{2,}/g, ' ').trim();
  };

  type BlockItem = { kind: 'image'; n: number } | { kind: 'text'; text: string };

  for (const block of blocks) {
    // 줄을 먼저 (이미지 마커 | 텍스트) 로 정규화한다.
    // ★ 소제목 판정보다 마커 제거가 먼저다 — "소제목 [이미지 1: …]" 처럼 마커가
    //   섞인 짧은 줄이 <h2> 로 굳어 마커 문자열이 화면에 노출되는 것을 막는다.
    const items: BlockItem[] = [];
    for (const raw of block.split('\n').map((l) => l.trim())) {
      if (raw.length === 0) continue;
      const markerN = imageMarkerNumber(raw);
      if (markerN !== null) {
        items.push({ kind: 'image', n: markerN });
        continue;
      }
      const cleaned = cleanTextLine(raw);
      if (cleaned.length > 0) items.push({ kind: 'text', text: cleaned });
    }

    if (items.length === 1) {
      const only = items[0];
      if (only.kind === 'image') {
        pushImageAt(only.n);
        blockEnds.push(parts.length);
        continue;
      }
      if (only.text.startsWith('▶')) {
        parts.push(`<h3>${escapeHtml(only.text.replace(/^▶\s*/, ''))}</h3>`);
        blockEnds.push(parts.length);
        continue;
      }
      if (isHeadingLine(only.text)) {
        parts.push(`<h2>${escapeHtml(only.text)}</h2>`);
        blockEnds.push(parts.length);
        continue;
      }
    }

    // 블록 안에 ▶·이미지 마커 줄이 섞여 있으면 분리, 나머지 연속 줄은 하나의 단락으로
    const paragraphLines: string[] = [];
    const flush = () => {
      if (paragraphLines.length === 0) return;
      parts.push(`<p>${paragraphLines.map(escapeHtml).join('<br />')}</p>`);
      paragraphLines.length = 0;
    };
    for (const item of items) {
      if (item.kind === 'image') {
        flush();
        pushImageAt(item.n);
        continue;
      }
      if (item.text.startsWith('▶')) {
        flush();
        parts.push(`<h3>${escapeHtml(item.text.replace(/^▶\s*/, ''))}</h3>`);
        continue;
      }
      paragraphLines.push(item.text);
    }
    flush();
    blockEnds.push(parts.length);
  }

  const leftovers = images.filter(
    (image, i): image is BodyImage => image !== null && !used.has(i),
  );
  if (leftovers.length > 0) {
    if (!sawMarker) {
      // 규칙 3 — 마커가 전혀 없는 본문: 블록 사이 균등 배치.
      const boundaries = evenBoundaries(blockEnds.length, leftovers.length);
      // 뒤에서부터 삽입해야 앞쪽 인덱스가 밀리지 않는다.
      for (let k = leftovers.length - 1; k >= 0; k--) {
        const at = blockEnds[boundaries[k] - 1] ?? parts.length;
        parts.splice(at, 0, renderFigure(leftovers[k]));
      }
    } else {
      // 규칙 4 — 마커는 있는데 짝을 못 찾은 이미지: 본문 끝에.
      for (const image of leftovers) parts.push(renderFigure(image));
    }
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// 문서 조립
// ---------------------------------------------------------------------------

function renderSummarySection(summaryLines: ReadonlyArray<string>): string {
  const lines = summaryLines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return '';
  const items = lines.map((l) => `      <li>${escapeHtml(l)}</li>`).join('\n');
  return `  <section aria-label="핵심 요약">
    <h2>핵심 요약</h2>
    <ul>
${items}
    </ul>
  </section>`;
}

function renderFaqSection(faqItems: ReadonlyArray<GeoExportFaqItem>): string {
  const valid = faqItems.filter((f) => f.question.trim() && f.answer.trim());
  if (valid.length === 0) return '';
  const items = valid
    .map(
      (f) => `    <h3>${escapeHtml(f.question.trim())}</h3>
    <p>${escapeHtml(f.answer.trim())}</p>`,
    )
    .join('\n');
  return `  <section aria-label="자주 묻는 질문">
    <h2>자주 묻는 질문</h2>
${items}
  </section>`;
}

/** 가독성 최소 스타일 — 외부 리소스 없이 인라인만 (홈페이지 CSS 와 충돌 최소화). */
const BASE_STYLE = `    article { max-width: 720px; margin: 0 auto; padding: 24px 16px; line-height: 1.75; word-break: keep-all; }
    article h1 { font-size: 1.6em; line-height: 1.4; }
    article h2 { font-size: 1.25em; margin-top: 2em; }
    article h3 { font-size: 1.05em; margin-top: 1.5em; }
    article section[aria-label="핵심 요약"] { background: #f6f7f9; border-radius: 12px; padding: 16px 20px; }
    article section[aria-label="핵심 요약"] h2 { margin-top: 0; }
    article figure { margin: 1.75em 0; }
    article figure img { display: block; width: 100%; height: auto; border-radius: 12px; }
    article p.byline { margin-top: 2.5em; padding-top: 1em; border-top: 1px solid #e5e9ef; color: #73808f; font-size: 0.85em; }`;

/** 저자 바이라인 footer — 텍스트가 있을 때만 절제된 <p> 로 렌더. */
function renderBylineSection(bylineText: string | null | undefined): string {
  const text = (bylineText ?? '').trim();
  if (!text) return '';
  return `  <p class="byline">${escapeHtml(text)}</p>`;
}

/**
 * 병원 홈페이지 게시용 완결 HTML 문서 문자열을 생성한다.
 * <!doctype html> + head(meta·JSON-LD·canonical 안내) + 시맨틱 body.
 */
export function buildGeoExportHtml(input: GeoExportInput): string {
  const title = escapeHtml((input.title ?? '').trim());
  const description = escapeHtml((input.metaDescription ?? '').trim());
  // 방어적 재이스케이프 — "</" 는 "<\/" 로 (이미 이스케이프된 입력에는 멱등)
  const jsonLd = (input.jsonLd ?? '').replace(/<\//g, '<\\/');

  const summarySection = renderSummarySection(input.summaryLines);
  const faqSection = renderFaqSection(input.faqItems);
  const bodyHtml = renderBodyHtml(input.bodyText);

  const bylineSection = renderBylineSection(input.bylineText);

  const bodySections = [
    `  <h1>${title}</h1>`,
    summarySection,
    bodyHtml
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
    faqSection,
    bylineSection,
  ].filter((s) => s.trim().length > 0);

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <!-- 병원 홈페이지 주소로 canonical 을 설정하세요. 예: <link rel="canonical" href="https://병원홈페이지주소/글경로" /> -->
  <script type="application/ld+json">
${jsonLd}
  </script>
  <style>
${BASE_STYLE}
  </style>
</head>
<body>
<article>
${bodySections.join('\n')}
</article>
<!-- 이 파일은 병원 공식 홈페이지 게시용입니다. 네이버 블로그와 함께 발행하면 검색과 AI 인용을 모두 준비할 수 있습니다. -->
</body>
</html>
`;
}
