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
 * 플레인 텍스트 본문을 시맨틱 HTML 로 변환한다.
 * - "▶ …" 줄 → <h3>
 * - 빈 줄로 둘러싸인 짧은 독립 줄(문장 아님) → <h2>
 * - 그 외 → <p> (블록 내 줄바꿈은 <br /> 유지)
 * 모든 텍스트는 이스케이프되어 태그로 해석되지 않는다.
 */
export function renderBodyHtml(bodyText: string): string {
  const blocks = (bodyText ?? '')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const parts: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

    if (lines.length === 1 && lines[0].startsWith('▶')) {
      parts.push(`<h3>${escapeHtml(lines[0].replace(/^▶\s*/, ''))}</h3>`);
      continue;
    }
    if (lines.length === 1 && isHeadingLine(lines[0])) {
      parts.push(`<h2>${escapeHtml(lines[0])}</h2>`);
      continue;
    }

    // 블록 안에 ▶ 줄이 섞여 있으면 h3 로 분리, 나머지 연속 줄은 하나의 단락으로
    const paragraphLines: string[] = [];
    const flush = () => {
      if (paragraphLines.length === 0) return;
      parts.push(`<p>${paragraphLines.map(escapeHtml).join('<br />')}</p>`);
      paragraphLines.length = 0;
    };
    for (const line of lines) {
      if (line.startsWith('▶')) {
        flush();
        parts.push(`<h3>${escapeHtml(line.replace(/^▶\s*/, ''))}</h3>`);
      } else {
        paragraphLines.push(line);
      }
    }
    flush();
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
