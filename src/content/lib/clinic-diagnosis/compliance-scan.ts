import type { PostBodyKind } from './post-seo.ts';
import type {
  ComplianceAxis,
  ComplianceExcerpt,
  ComplianceExcerptWhere,
  ComplianceHit,
  ComplianceRisk,
} from './types.ts';

/**
 * 2단계 ④ — 의료광고법 위험 신호 점검.
 *
 * ⚠️ 표현 규칙(가장 중요):
 *   우리는 심의기관이 아니다. **"위반입니다" · "처분 대상입니다"라고 단정하지 않는다.**
 *   전부 "심의에서 자주 지적되는 표현" · "확인이 필요합니다" 수준으로 쓴다.
 *   원장을 겁주면 방어부터 하고 대화가 끝난다.
 *
 * ⚠️ 게이트를 느슨하게 만들지 않는다:
 *   검출 자체는 기존 medical-compliance(A층 키워드 + 경고 패턴)를 **그대로** 쓴다.
 *   이 모듈이 하는 일은 검출 결과를 진단 화면 문구로 옮기는 것뿐이며,
 *   임계값을 낮추거나 항목을 제외하지 않는다.
 *
 * 데이터 한계:
 *   확보 수준이 글마다 다르다 — 최신 글은 본문 전문, 나머지는 RSS 가 준 앞부분
 *   요약, 그마저 없으면 제목뿐이다. 셋을 postsScanned/bodiesScanned/summariesScanned
 *   로 나눠 그대로 노출한다(어디까지 봤는지 뭉개지 않는다).
 *   본문 전문 점검은 상세 진단에서 사용자가 붙여넣게 한다.
 *
 * 크롤링 금지 — 공식 RSS·모바일 본문 1회 GET(blog-check-rss 재사용)만 쓴다.
 */

/** 심각도 → 진단 화면 등급. CRITICAL/HIGH 는 review, 그 외는 caution. */
export type SourceSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** 진단 화면에 노출할 검출 상한 (한 화면에 다 못 담으면 겁만 준다). */
export const MAX_HITS = 12;

/**
 * 검출 근거 문구 — 단정하지 않는 표현으로 통일한다.
 * medical-compliance 의 rule 문자열(법조문 인용)을 그대로 노출하면 "위반 판정"으로
 * 읽히므로, 여기서 "심의에서 자주 지적됩니다" 톤으로 감싼다.
 */
export function softenRule(rule: string): string {
  const base = (rule ?? '').replace(/\s*\(의료법[^)]*\)\s*/g, '').replace(/금지$/, '').trim();
  if (!base) return '의료광고 심의에서 자주 지적되는 표현이에요. 확인이 필요합니다.';
  return `${base} 관련 표현이라 의료광고 심의에서 자주 지적돼요. 확인이 필요합니다.`;
}

/* ── 위험 등급 분류 ─────────────────────────────────────── */

/**
 * **의료법이 광고에서 명시적으로 금지한 유형**만 여기에 넣는다.
 *
 * 왜 나누나: 실측(리팅성형외과)에서 11건이 전부 같은 무게로 나열됐는데,
 * 그 안에는 "후기"(환자 경험담)처럼 법이 유형 자체를 금지한 것과
 * "최신"·"제일"처럼 문맥에 따라 갈리는 것이 섞여 있었다. 같은 색으로 늘어놓으면
 * 원장은 어느 것부터 손대야 할지 알 수 없고, 전부 무시하게 된다.
 *
 * ⚠️ 등재 기준(느슨하게 만들지 말 것):
 *   · 의료법이 **광고 유형 자체를 금지**한다고 말할 수 있는 것만 넣는다.
 *   · 조문 번호·항·호는 적지 않는다. 유형만 서술한다(우리는 심의기관이 아니다).
 *   · 최상급("제일"·"최고")·"최신"·유명인 언급·이벤트/할인 유인처럼 **문맥에 따라
 *     갈리거나 광역 탐색(recall 우선)으로 오탐이 섞이는 것**은 절대 넣지 않는다.
 *     빨간 등급이 흔해지면 빨간색이 아무 의미도 없어진다.
 *
 * 매칭 대상 문자열은 검출 단어 + 규칙명(또는 경고 문구)을 합친 것이다.
 */
const PROHIBITED_TYPES: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  // 환자 후기·치료경험담 — 의료법이 광고에서 금지한 대표 유형.
  // ('사례'는 단독으로 쓰면 규칙 설명문의 "시정명령 사례"까지 걸리므로 환자·개인에 붙을 때만)
  { label: '환자 후기·치료경험담', pattern: /후기|경험담|체험담|내돈내산|직접\s*받아\s*보니|환자\s*사례|개인\s*사례/ },
  // 치료 전후 비교 사진·표현.
  { label: '치료 전후 비교', pattern: /전후\s*사진|전후\s*비교|비포애프터|before\s*.?\s*after/i },
  // 치료효과·결과 보장, 부작용 없음·완전 안전 단정.
  {
    label: '치료효과 보장·부작용 없음 단정',
    pattern: /결과\s*보장|효과\s*보장|치료\s*결과\s*보장|완치|100%|무조건|확실한\s*효과|부작용\s*없|부작용이\s*없|완전히\s*안전|위험\s*없/,
  },
  // 다른 의료기관·의료인과의 비교, 비방.
  { label: '다른 병원과의 비교·비방', pattern: /비교\s*광고|타\s*병원|다른\s*병원|경쟁병원|비방/ },
];

/* ── 문맥 판정: "단어가 있다"와 "그 유형이다"는 다르다 ─────── */

/**
 * ★ 실측 근거 (프라이브성형외과 blog.naver.com/newprive, RSS 50편).
 *   "위험 — 환자 후기·치료경험담"으로 뜬 글의 실제 문장은 이랬다:
 *     · "실제 후기를 찾아보시면, 같은 온다리프팅인데도 만족도가 제각각입니다"
 *     · "'추천'과 '후기'를 그대로 믿고 병원을 고르시는 일입니다"
 *     · "후기가 많으면 믿을 만한 걸까?"
 *     · "블로그나 SNS에서 접하는 시술 후기들을 보다 보면"
 *     · "비싸다고 무조건 좋은 건가? 리뷰만으론 믿기 어렵고..."
 *     · "저희가 100% 예약제로 하루 인원을 제한하고"
 *   전부 환자 치료경험담이 아니다. 오히려 후기를 믿지 말라는 정보성 글이고,
 *   "무조건"·"100%"는 부정문·의문문 안이거나 효과와 무관한 말("100% 예약제")이었다.
 *
 * 그래서 **문맥 신호가 있으면 위험(prohibited)에서 주의(caution)로 내린다.**
 *
 * ⚠️ 왜 빼지 않고 '주의'로 내리는가.
 *   의료광고법은 recall 우선이 회사 원칙이다(feedback_compliance_strictness_moat).
 *   아예 빼면 원장은 그 표현을 영영 못 본다. "빨간 위험"만 보수적으로 좁히고,
 *   표현 자체는 목록에 남겨 원장이 문장을 읽고 직접 판단하게 한다.
 *
 * ⚠️ 여기서 바꾸는 것은 **진단 화면의 표시 등급뿐**이다.
 *   고객 글 발행을 막는 medical-compliance 의 검수 게이트(A층/B층)는 손대지 않는다.
 */

/** ① 의문형 — 묻는 문장은 주장이 아니다. */
const QUESTION_MARK = /[?？]/;
const QUESTION_ENDING = /(인가|일까|걸까|건가|을까|는가|나요|까요|습니까|ㅂ니까)\s*요?\s*[”"'’」』)\]]*\s*$/;

/** ② 부정·반박 — "무조건 좋은 건 아닙니다"는 오히려 정직한 서술이다. */
const REFUTATION_CUES =
  /아닙니다|아니라|아니에요|아녜요|아니죠|아니었|아닌\s|은\s*아니|는\s*아니|가\s*아니|이\s*아니|그렇지는\s*않|그런\s*건\s*아|꼭\s*그렇|믿을\s*수\s*없|믿기\s*어렵|믿기가\s*어렵|그대로\s*믿|어디까지\s*믿|뭘\s*믿|무엇을\s*믿|만으론|만으로는|만\s*믿|착각|오해|잘못\s*알/;

/** ③ 일반론·타인 지칭 — 남들의 후기를 가리키는 말이지 우리 환자의 경험담이 아니다. */
const THIRD_PARTY_CUES =
  /블로그나?\s*SNS|인터넷|온라인|커뮤니티|검색해\s*보|검색하다\s*보면|찾아보시면|찾아보면|보다\s*보면|접하는|수많은|다들|주변에서|남들|다른\s*사람|후기들|후기도\s*많|후기가\s*많|리뷰|고\s*생각하시는|라고\s*생각|고\s*여기|고들|라는\s*말|고\s*하는데|고\s*알고/;

/**
 * ④ 진짜 경험담 확증 — 이게 있으면 위에서 무엇이 걸리든 **위험을 유지한다**.
 *   "직접 받아본 후기입니다" · "3개월 지난 제 경험담" · "저는 이 시술 받고 좋아졌어요"
 *   1인칭 표현은 보수적으로 잡는다 — "제가 직접 진단해 드립니다"(원장 서술)를
 *   경험담으로 오인하면 반대 방향 오탐이 된다.
 */
const TESTIMONIAL_CUES =
  /내돈내산|직접\s*받아\s*보|직접\s*받아본|직접\s*맞아\s*보|직접\s*맞아본|받아본\s*후기|받은\s*후기|맞은\s*후기|후기입니다|후기예요|후기에요|후기\s*남기|후기\s*공유|경험담입니다|제\s*경험담|저의\s*경험담|생생한?\s*후기|리얼\s*후기|솔직\s*후기|실제\s*환자|환자\s*후기|고객\s*후기|\d+\s*(?:일|주|주차|개월|달|년)\s*(?:후기|경험담)|(?:저는|제가|저도|나는|내가)[^.!?\n]{0,40}(?:받아|맞아|받고|맞고|받은|맞은|해보니|받아보니)[^.!?\n]{0,40}(?:좋아졌|나았|호전|효과|만족|달라졌|후기|경험담)/;

/**
 * ⑤ '치료효과 보장' 유형 전용 — 효과·결과를 말하는 문장일 때만 위험이다.
 *   "100% 예약제"·"무조건 예약 후 방문"은 보장 표현이 아니다.
 */
const OUTCOME_TERMS = /효과|결과|치료|시술|수술|개선|만족|성공|낫|호전|안전|부작용|보장|완치|좋아|해결|재발/;
const GUARANTEE_LABEL = '치료효과 보장·부작용 없음 단정';

/** 위험에서 내린 이유 — 화면에 그대로 쓴다(원장이 왜 안 걸렸는지 알 수 있게). */
export type DemotionReason = 'question' | 'refutation' | 'third_party' | 'no_outcome';

export const DEMOTION_LABEL: Readonly<Record<DemotionReason, string>> = {
  question: '묻는 문장',
  refutation: '부정하거나 반박하는 문장',
  third_party: '남들의 이야기·일반적인 통념을 가리키는 문장',
  no_outcome: '치료 효과·결과와는 무관한 문장',
};

/**
 * 문맥이 이 유형에 **해당하지 않는다고 볼 신호**를 찾는다. 없으면 null.
 * context 는 검출 단어가 들어 있던 문장(앞뒤 문맥 포함).
 */
export function demotionReasonFor(label: string, context: string): DemotionReason | null {
  const text = (context ?? '').trim();
  if (!text) return null;
  // 진짜 경험담이면 무엇이 걸리든 위험을 유지한다 (recall 을 깎지 않는다).
  if (TESTIMONIAL_CUES.test(text)) return null;

  if (QUESTION_MARK.test(text) || QUESTION_ENDING.test(text)) return 'question';
  if (REFUTATION_CUES.test(text)) return 'refutation';
  if (THIRD_PARTY_CUES.test(text)) return 'third_party';
  if (label === GUARANTEE_LABEL && !OUTCOME_TERMS.test(text)) return 'no_outcome';
  return null;
}

/**
 * 검출 1건의 위험 등급을 매긴다 (순수 함수).
 *
 * signal  : "검출 단어 + 규칙명"(위반) 또는 경고 문구(패턴 경고)를 합친 문자열.
 * context : 검출 단어가 실제로 들어 있던 문장. 주면 문맥까지 보고 판단한다.
 *           (없으면 예전처럼 signal 만으로 판단 — 저장된 리포트·단순 호출 호환)
 */
export function classifyComplianceRisk(
  signal: string,
  context?: string,
): {
  readonly risk: ComplianceRisk;
  readonly label: string | null;
  /** 위험에서 내렸다면 그 이유. 유지했으면 null. */
  readonly demoted: DemotionReason | null;
} {
  const text = signal ?? '';
  for (const type of PROHIBITED_TYPES) {
    if (!type.pattern.test(text)) continue;
    const demoted = context ? demotionReasonFor(type.label, context) : null;
    if (demoted) return { risk: 'caution', label: null, demoted };
    return { risk: 'prohibited', label: type.label, demoted: null };
  }
  return { risk: 'caution', label: null, demoted: null };
}

/**
 * 위험 등급 검출의 근거 문구.
 * ⚠️ "위반입니다"라고 쓰지 않는다 — "명시적으로 금지한 유형"까지가 한계다.
 */
export function prohibitedNote(label: string): string {
  return `${label} — 의료법이 광고에서 명시적으로 금지한 유형이에요. 이 표현이 실제로 그 유형에 해당하는지 먼저 확인해 보세요.`;
}

/**
 * 위험에서 내린 검출의 근거 문구.
 * 왜 빨간색이 아닌지 원장이 알 수 있어야 목록 전체가 믿을 만해진다.
 */
export function demotedNote(rule: string, reason: DemotionReason): string {
  return `${softenRule(rule)} 다만 위 문장은 ${DEMOTION_LABEL[reason]}이라 "위험"으로 올리지 않았어요.`;
}

/** 저장된 리포트 호환 — risk 가 없던 시절 리포트는 전부 '주의'로 읽는다. */
export function riskOf(hit: Pick<ComplianceHit, 'risk'>): ComplianceRisk {
  return hit.risk ?? 'caution';
}

/* ── 문맥 발췌 ─────────────────────────────────────────── */

/**
 * 발췌 상한 — **개인정보·본문이 통째로 새지 않게** 길이를 묶는다.
 * 넉넉히 보여주되 한 문장 남짓을 넘지 않는다.
 */
export const EXCERPT_BEFORE_MAX = 60;
export const EXCERPT_AFTER_MAX = 60;
export const EXCERPT_MATCH_MAX = 40;
/** 문맥 판정에 쓸 창 — 문장이 아주 길 때 판정이 느슨해지지 않게 앞뒤로 제한한다. */
export const CUE_WINDOW = 140;
/** 같은 단어를 몇 번까지 훑어볼지 (본문 전체를 도는 것을 막는 상한). */
export const MAX_OCCURRENCES = 20;

const SENTENCE_END = new Set(['.', '!', '?', '\n', '。', '？', '！']);

/** index 를 포함하는 문장의 [시작, 끝) — 끝은 문장부호를 포함하지 않는다. */
export function sentenceBoundsAt(text: string, index: number): readonly [number, number] {
  let start = index;
  while (start > 0 && !SENTENCE_END.has(text[start - 1])) start -= 1;
  let end = index;
  while (end < text.length && !SENTENCE_END.has(text[end])) end += 1;
  return [start, end];
}

/** 문맥 판정용 문장 — 문장부호까지 포함하고(의문부호 판정) 창 길이로 자른다. */
export function cueContextAt(text: string, start: number, end: number): string {
  const [sentStart, sentEnd] = sentenceBoundsAt(text, start);
  const from = Math.max(sentStart, start - CUE_WINDOW);
  // 문장 종결부호 1자를 포함해야 "~걸까?" 의 물음표를 볼 수 있다.
  const to = Math.min(sentEnd + 1, Math.max(end, start) + CUE_WINDOW, text.length);
  return normalizeExcerpt(text.slice(from, to));
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
};

/** 네이버 본문에 남는 HTML 엔티티를 사람이 읽는 글자로 되돌린다(표시 전용). */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (whole, hex: string) => codePoint(parseInt(hex, 16), whole))
    .replace(/&#(\d{1,7});/g, (whole, dec: string) => codePoint(parseInt(dec, 10), whole))
    .replace(/&(?:quot|apos|nbsp|lt|gt|amp);/g, (entity) => ENTITIES[entity] ?? entity);
}

function codePoint(value: number, fallback: string): string {
  if (!Number.isFinite(value) || value < 0x20 || value > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

/**
 * 개인정보로 보이는 조각은 가린다.
 * 공개 블로그 글이라도 발췌를 그대로 저장·공유하므로 최소한의 마스킹은 건다.
 */
const PII_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '(메일주소)'],
  [/\b\d{6}\s*[-–]\s*\d{7}\b/g, '(개인정보)'],
  [/\b0\d{1,2}\s*[-–.]\s*\d{3,4}\s*[-–.]\s*\d{4}\b/g, '(전화번호)'],
];

function maskPii(value: string): string {
  let out = value;
  for (const [pattern, replacement] of PII_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** 공백·제로폭 문자를 눌러 한 줄로 만든다 (네이버 본문은 ​·개행이 많다). */
export function normalizeExcerpt(value: string): string {
  return (value ?? '')
    .replace(/[​‌‍﻿ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 검출 단어가 제목에 있었는지 / 글 앞부분인지 / 본문인지. */
function whereOf(source: ComplianceSource, index: number): ComplianceExcerptWhere {
  const title = source.title ?? '';
  const titlePrefixed = title.length > 0 && source.text.startsWith(title);
  if (titlePrefixed && index < title.length) return 'title';
  const kind = source.bodyKind ?? (source.hasBody ? 'full' : 'none');
  return kind === 'summary' ? 'lead' : 'body';
}

/** 검출 위치 → 화면에 보여줄 발췌 (순수 함수). */
export function buildExcerpt(source: ComplianceSource, word: string, index: number): ComplianceExcerpt | null {
  const text = source.text ?? '';
  if (!word || index < 0 || index >= text.length) return null;

  const matchEnd = Math.min(text.length, index + word.length);
  const [sentStart, sentEnd] = sentenceBoundsAt(text, index);
  const from = Math.max(sentStart, index - EXCERPT_BEFORE_MAX);
  const to = Math.min(Math.max(sentEnd, matchEnd), matchEnd + EXCERPT_AFTER_MAX, text.length);

  const before = maskPii(normalizeExcerpt(decodeEntities(text.slice(from, index))));
  const after = maskPii(normalizeExcerpt(decodeEntities(text.slice(matchEnd, to))));
  const match = normalizeExcerpt(decodeEntities(text.slice(index, matchEnd))).slice(0, EXCERPT_MATCH_MAX);
  if (!match) return null;

  return {
    before: before.slice(-EXCERPT_BEFORE_MAX),
    match,
    after: after.slice(0, EXCERPT_AFTER_MAX),
    where: whereOf(source, index),
    clippedBefore: from > sentStart || before.length > EXCERPT_BEFORE_MAX,
    clippedAfter: to < sentEnd,
  };
}

/**
 * 같은 단어가 여러 번 나오면 **하나라도 진짜면 위험**이다.
 *
 * ⚠️ checkCompliance 는 단어별 첫 매칭만 돌려준다. 첫 매칭이 우연히 의문문이라고
 *    뒤쪽의 진짜 경험담까지 함께 내려가면 recall 이 깎인다 — 그래서 이 모듈에서
 *    같은 단어의 나머지 등장 위치도 훑어 **문맥 신호가 없는 자리**를 우선 채택한다.
 */
export function pickOccurrence(
  source: ComplianceSource,
  word: string,
  firstIndex: number,
  label: string,
): { readonly index: number; readonly demoted: DemotionReason | null } | null {
  const text = source.text ?? '';
  if (!word) return null;

  const start = firstIndex >= 0 && text.startsWith(word, firstIndex) ? firstIndex : text.indexOf(word);
  if (start < 0) return null;

  let fallback: { index: number; demoted: DemotionReason } | null = null;
  let cursor = start;
  for (let seen = 0; cursor >= 0 && seen < MAX_OCCURRENCES; seen += 1) {
    // medical-compliance 와 같은 한글 좌측 경계 — "정기적"의 "기적" 같은 부분 매칭 제외.
    const prev = cursor > 0 ? text[cursor - 1] : '';
    if (!(cursor !== start && /[가-힣]/.test(prev))) {
      const demoted = demotionReasonFor(label, cueContextAt(text, cursor, cursor + word.length));
      if (!demoted) return { index: cursor, demoted: null };
      if (!fallback) fallback = { index: cursor, demoted };
    }
    cursor = text.indexOf(word, cursor + word.length);
  }
  return fallback ?? { index: start, demoted: null };
}

export interface ComplianceSource {
  readonly title: string;
  readonly link: string;
  /** 검사 대상 텍스트 (제목 또는 제목+본문). */
  readonly text: string;
  /** 본문 전문까지 확보했는가. */
  readonly hasBody: boolean;
  /** 확보 수준 — 미지정이면 hasBody 로 유추한다(기존 호출부 호환). */
  readonly bodyKind?: PostBodyKind;
}

/** medical-compliance.checkCompliance 의 반환 형태 중 이 모듈이 쓰는 부분. */
export interface ComplianceCheckShape {
  readonly violations: ReadonlyArray<{
    readonly word: string;
    readonly rule: string;
    readonly severity: SourceSeverity | string;
    /** 검사 대상 텍스트에서의 위치. 없으면 문자열 검색으로 찾는다. */
    readonly index?: number;
  }>;
  readonly warnings: readonly string[];
}

/**
 * 검사 결과 → 진단 화면 항목 (순수 함수).
 * checkFn 은 호출부가 주입한다(테스트에서 목 주입 가능, 운영은 medical-compliance).
 */
export function buildComplianceAxis(
  sources: readonly ComplianceSource[],
  checkFn: (text: string) => ComplianceCheckShape,
): ComplianceAxis {
  const hits: ComplianceHit[] = [];
  const postsWithHits = new Set<string>();
  const postsWithProhibited = new Set<string>();

  const push = (hit: ComplianceHit): void => {
    hits.push(hit);
    postsWithHits.add(hit.postLink);
    if (hit.risk === 'prohibited') postsWithProhibited.add(hit.postLink);
  };

  for (const source of sources) {
    const result = checkFn(source.text);
    for (const violation of result.violations) {
      const severity = String(violation.severity).toUpperCase();
      const signal = `${violation.word} ${violation.rule}`;

      /**
       * 문맥까지 보고 판단한다 — 단어가 있다고 그 유형인 것은 아니다.
       * 유형에 걸린 뒤에야 위치를 훑는다(주의 등급은 위치가 등급을 바꾸지 않는다).
       */
      const typed = classifyComplianceRisk(signal);
      const picked =
        typed.label !== null
          ? pickOccurrence(source, violation.word, violation.index ?? -1, typed.label)
          : { index: violation.index ?? source.text.indexOf(violation.word), demoted: null as DemotionReason | null };

      const demoted = picked?.demoted ?? null;
      const risk: ComplianceRisk = typed.risk === 'prohibited' && !demoted ? 'prohibited' : 'caution';
      const label = risk === 'prohibited' ? typed.label : null;
      const excerpt = picked ? buildExcerpt(source, violation.word, picked.index) : null;

      push({
        postTitle: source.title || '(제목 없음)',
        postLink: source.link,
        phrase: violation.word,
        note: label
          ? prohibitedNote(label)
          : demoted
            ? demotedNote(violation.rule, demoted)
            : softenRule(violation.rule),
        level: severity === 'CRITICAL' || severity === 'HIGH' ? 'review' : 'caution',
        risk,
        ...(label ? { riskLabel: label } : {}),
        ...(excerpt ? { excerpt } : {}),
      });
    }
    for (const warning of result.warnings) {
      /**
       * 경고는 어떤 문자열이 걸렸는지 알 수 없어(패턴 메시지만 돌아온다) 발췌를 만들 수 없다.
       * 현재 경고 문구 중 금지 유형에 해당하는 것은 없지만, 문맥을 못 보는 이상
       * 위험으로 올리지 않는다 — 근거를 못 보여줄 것을 빨간색으로 세우지 않는다.
       */
      push({
        postTitle: source.title || '(제목 없음)',
        postLink: source.link,
        phrase: '(문장 패턴)',
        note: `${warning.replace(/입니다\.$/, '어요.')} 확인이 필요합니다.`,
        level: 'caution',
        risk: 'caution',
      });
    }
  }

  /**
   * 위험(명시적 금지 유형) → 그다음 review → 나머지 순.
   * 정렬만 바꿀 뿐 항목을 버리지 않는다(표시 상한 MAX_HITS 제외).
   * ⚠️ 상한에 잘려도 위험 건수는 아래 prohibitedCount 로 정확히 남는다.
   */
  const weight = (hit: ComplianceHit): number =>
    (riskOf(hit) === 'prohibited' ? 0 : 2) + (hit.level === 'review' ? 0 : 1);
  const sorted = [...hits].sort((a, b) => weight(a) - weight(b));

  const kindOf = (source: ComplianceSource): PostBodyKind =>
    source.bodyKind ?? (source.hasBody ? 'full' : 'none');
  const prohibitedCount = hits.filter((h) => riskOf(h) === 'prohibited').length;

  return {
    checked: sources.length > 0,
    postsScanned: sources.length,
    bodiesScanned: sources.filter((s) => kindOf(s) === 'full').length,
    summariesScanned: sources.filter((s) => kindOf(s) === 'summary').length,
    hits: sorted.slice(0, MAX_HITS),
    postsWithHits: postsWithHits.size,
    prohibitedCount,
    cautionCount: hits.length - prohibitedCount,
    postsWithProhibited: postsWithProhibited.size,
  };
}

export const EMPTY_COMPLIANCE_AXIS: ComplianceAxis = {
  checked: false,
  postsScanned: 0,
  bodiesScanned: 0,
  summariesScanned: 0,
  hits: [],
  postsWithHits: 0,
  prohibitedCount: 0,
  cautionCount: 0,
  postsWithProhibited: 0,
};

/**
 * 위험·주의 건수 (저장된 구 리포트 호환).
 * prohibitedCount 가 없던 시절 리포트는 표시된 hits 로 세어 폴백한다.
 */
export function complianceRiskCounts(axis: ComplianceAxis): {
  readonly prohibited: number;
  readonly caution: number;
  readonly postsWithProhibited: number;
} {
  if (typeof axis.prohibitedCount === 'number') {
    return {
      prohibited: axis.prohibitedCount,
      caution: axis.cautionCount ?? Math.max(0, axis.hits.length - axis.prohibitedCount),
      postsWithProhibited: axis.postsWithProhibited ?? 0,
    };
  }
  const prohibited = axis.hits.filter((h) => riskOf(h) === 'prohibited').length;
  return {
    prohibited,
    caution: axis.hits.length - prohibited,
    postsWithProhibited: new Set(axis.hits.filter((h) => riskOf(h) === 'prohibited').map((h) => h.postLink)).size,
  };
}
