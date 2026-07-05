/**
 * AI 검색 인용 추적(GEO 트래킹) — 순수 로직 모듈.
 *
 * 역할:
 *  1) 프로필(지역·진료과·키워드) 기반 샘플 질문 생성 (규칙 기반, LLM 호출 없음)
 *  2) AI 응답 텍스트/출처 URL에서 병원명·블로그 인용 판정 (공백 변형 포함 매칭)
 *  3) 표시용 발췌 새니타이즈 (프롬프트 인젝션 방어: 태그 이스케이프 + 길이 제한)
 *  4) 발행 글의 GEO 준비도 점수 (요약·FAQ·질문형 제목·소제목 구조 — 규칙 기반)
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

// ---------------------------------------------------------------------------
// 1) 샘플 질문 생성
// ---------------------------------------------------------------------------

export interface GeoQuestionProfile {
  region: string | null;
  specialty: string | null;
  hospitalKeywords: string[] | null;
}

export const MAX_QUESTIONS_PER_USER = 3;

/**
 * 환자가 AI에게 실제로 물어볼 법한 질문을 프로필로부터 규칙 기반 생성.
 * 우선순위: ① 지역+진료과 추천 → ② 대표 키워드 잘하는 병원 → ③ 보조 키워드 상담처.
 * 재료가 부족하면 생성 가능한 것만 반환(최대 3개, 중복 제거).
 */
export function buildGeoQuestions(profile: GeoQuestionProfile): string[] {
  const region = (profile.region ?? '').trim();
  const specialty = (profile.specialty ?? '').trim();
  const keywords = (profile.hospitalKeywords ?? [])
    .map((k) => (k ?? '').trim())
    .filter((k) => k.length >= 2);

  const questions: string[] = [];

  if (region && specialty) {
    questions.push(`${region} ${specialty} 추천해줘`);
  } else if (specialty) {
    questions.push(`${specialty} 잘하는 병원 추천해줘`);
  }

  if (keywords[0]) {
    const q = region
      ? `${region}에서 ${keywords[0]} 잘하는 병원 어디야?`
      : `${keywords[0]} 잘하는 병원 어디야?`;
    questions.push(q);
  }

  if (keywords[1]) {
    questions.push(`${keywords[1]} 때문에 병원 가려는데 어디로 가야 해?`);
  } else if (region && specialty && keywords.length === 0) {
    // 키워드가 하나도 없으면 지역+진료과 변형으로 보충
    questions.push(`${region} ${specialty} 어디가 좋아?`);
  }

  // 중복 제거 + 상한
  return Array.from(new Set(questions)).slice(0, MAX_QUESTIONS_PER_USER);
}

// ---------------------------------------------------------------------------
// 2) 인용 판정
// ---------------------------------------------------------------------------

export type CitationType = 'hospital_name' | 'blog_url' | 'none';

export interface CitationTarget {
  hospitalName: string | null;
  /** 프로필의 네이버 블로그 주소에서 추출한 blogId (예: '2yoonfather'). null = 미설정 */
  naverBlogId: string | null;
}

export interface CitationInput {
  /** AI 응답 본문 텍스트 */
  text: string;
  /** url_citation 주석 등에서 수집한 출처 URL 목록 */
  sourceUrls: string[];
}

export interface CitationResult {
  cited: boolean;
  citationType: CitationType;
  /** 인용 근거 발췌 (새니타이즈·길이 제한 완료). 미인용 시 null */
  evidence: string | null;
}

/** 정규식 특수문자 이스케이프 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 병원명을 공백 변형 허용 정규식으로 변환.
 * 예: "애플피부과의원" → /애\s*플\s*피\s*부\s*과\s*의\s*원/
 * AI 응답이 "애플 피부과" 처럼 띄어 써도 매칭된다.
 */
function buildNameRegex(name: string): RegExp | null {
  const compact = name.replace(/\s+/g, '');
  if (compact.length < 2) return null;
  const pattern = compact.split('').map(escapeRegExp).join('\\s*');
  return new RegExp(pattern);
}

/**
 * 병원명 매칭 후보 목록 — 전체 명칭 + 접미사(의원/병원/클리닉) 제거 변형.
 * 접미사 제거 후 3자 미만이면 오탐 위험이 커서 변형을 만들지 않는다.
 */
export function hospitalNameVariants(hospitalName: string): string[] {
  const base = hospitalName.trim();
  if (!base) return [];
  const variants = [base];
  const stripped = base.replace(/\s*(의원|병원|클리닉)$/u, '');
  if (stripped !== base && stripped.replace(/\s+/g, '').length >= 3) {
    variants.push(stripped);
  }
  return variants;
}

const EVIDENCE_CONTEXT_CHARS = 60; // 매칭 지점 앞뒤 발췌 길이
export const EVIDENCE_MAX_LENGTH = 200;

/**
 * AI 응답에서 병원명/블로그 인용 여부 판정.
 * 우선순위: 블로그 URL 인용(blog_url) > 병원명 언급(hospital_name).
 * evidence 는 항상 새니타이즈된 발췌만 반환한다(원문 그대로 반환 금지).
 */
export function detectCitation(input: CitationInput, target: CitationTarget): CitationResult {
  const text = input.text ?? '';

  // ① 블로그 URL 인용 — 출처 URL 목록 + 본문 내 URL 둘 다 검사
  if (target.naverBlogId) {
    const blogPath = `blog.naver.com/${target.naverBlogId.toLowerCase()}`;
    const inSources = input.sourceUrls.find((u) => (u ?? '').toLowerCase().includes(blogPath));
    const inText = text.toLowerCase().includes(blogPath);
    if (inSources || inText) {
      const evidence = inSources
        ? sanitizeExcerpt(`출처 인용: ${inSources}`, EVIDENCE_MAX_LENGTH)
        : extractEvidence(text, text.toLowerCase().indexOf(blogPath), blogPath.length);
      return { cited: true, citationType: 'blog_url', evidence };
    }
  }

  // ② 병원명 언급 (공백 변형 포함)
  if (target.hospitalName) {
    for (const variant of hospitalNameVariants(target.hospitalName)) {
      const regex = buildNameRegex(variant);
      if (!regex) continue;
      const match = regex.exec(text);
      if (match && match.index >= 0) {
        return {
          cited: true,
          citationType: 'hospital_name',
          evidence: extractEvidence(text, match.index, match[0].length),
        };
      }
    }
  }

  return { cited: false, citationType: 'none', evidence: null };
}

/** 매칭 지점 앞뒤 문맥을 잘라 새니타이즈된 발췌 생성 */
function extractEvidence(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - EVIDENCE_CONTEXT_CHARS);
  const end = Math.min(text.length, index + matchLength + EVIDENCE_CONTEXT_CHARS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return sanitizeExcerpt(`${prefix}${text.slice(start, end)}${suffix}`, EVIDENCE_MAX_LENGTH);
}

// ---------------------------------------------------------------------------
// 3) 표시용 발췌 새니타이즈 (프롬프트 인젝션·XSS 방어)
// ---------------------------------------------------------------------------

/**
 * AI 응답 발췌를 저장·표시하기 전 새니타이즈.
 *  - HTML 태그 문자 이스케이프 (< > & " ')
 *  - 제어문자 제거·개행은 공백으로 접기
 *  - 최대 길이 제한 (넘으면 말줄임)
 * React 는 기본적으로 텍스트를 이스케이프하지만, DB에 저장되는 값 자체를
 * 무해화해 다른 소비처(이메일 등)에서도 안전하도록 이중 방어한다.
 */
export function sanitizeExcerpt(value: string, maxLength: number = EVIDENCE_MAX_LENGTH): string {
  const collapsed = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const escaped = collapsed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  if (escaped.length <= maxLength) return escaped;
  return `${escaped.slice(0, maxLength - 1)}…`;
}

// ---------------------------------------------------------------------------
// 4) GEO 준비도 점수 (발행 글 구조 규칙 검사)
// ---------------------------------------------------------------------------

export interface GeoReadinessPost {
  title: string;
  content: string;
}

export interface GeoReadinessCheck {
  /** 검사 항목 id */
  id: 'summary' | 'faq' | 'questionTitle' | 'subheading';
  label: string;
  /** 해당 항목을 충족한 글 수 */
  passed: number;
  total: number;
  weight: number;
}

export interface GeoReadinessScore {
  /** 0~100 종합 점수 */
  score: number;
  grade: '우수' | '보통' | '개선 필요';
  checks: GeoReadinessCheck[];
  /** 미충족 항목별 개선 팁 (충족률 낮은 순) */
  tips: string[];
  /** 검사한 글 수 */
  postCount: number;
}

// 생성 글 원본 마커([핵심 요약]) + 네이버 발행 변환본(■ 핵심 요약) 둘 다 인식
const SUMMARY_PATTERN = /\[핵심 요약\]|■\s*핵심 요약/;
const FAQ_PATTERN = /\[자주 묻는 질문\]|■\s*자주 묻는 질문|(^|\n)\s*Q1[.)]/;
const QUESTION_TITLE_PATTERN = /[?？]|까요|나요|인가요|할까|어떻게|방법|이유/;
const SUBHEADING_PATTERN = /▶/;

const CHECK_DEFS: Array<{
  id: GeoReadinessCheck['id'];
  label: string;
  weight: number;
  test: (post: GeoReadinessPost) => boolean;
  tip: string;
}> = [
  {
    id: 'summary',
    label: '핵심 요약(TL;DR) 포함',
    weight: 30,
    test: (p) => SUMMARY_PATTERN.test(p.content),
    tip: 'AI는 글 첫머리의 3줄 요약을 우선 발췌합니다. 구글 GEO 모드로 생성하면 [핵심 요약] 블록이 자동 포함됩니다.',
  },
  {
    id: 'faq',
    label: 'FAQ(자주 묻는 질문) 포함',
    weight: 30,
    test: (p) => FAQ_PATTERN.test(p.content),
    tip: 'Q&A 형식은 AI 답변에 그대로 인용되기 가장 좋은 구조입니다. FAQ 섹션이 있는 글을 늘려보세요.',
  },
  {
    id: 'questionTitle',
    label: '질문형 제목',
    weight: 20,
    test: (p) => QUESTION_TITLE_PATTERN.test(p.title),
    tip: '"~어떻게 하나요?", "~방법" 같은 질문형 제목이 AI 검색 질의와 더 잘 매칭됩니다.',
  },
  {
    id: 'subheading',
    label: '소제목 구조화',
    weight: 20,
    test: (p) => SUBHEADING_PATTERN.test(p.content),
    tip: '소제목(▶)으로 섹션을 나누면 AI가 필요한 부분만 정확히 발췌할 수 있습니다.',
  },
];

/**
 * 발행 글들의 GEO 구조 준비도를 0~100으로 점수화.
 * 항목별 (충족 글 수 / 전체 글 수) × 가중치 합산. 글이 없으면 null 을 반환한다.
 */
export function scoreGeoReadiness(posts: GeoReadinessPost[]): GeoReadinessScore | null {
  if (posts.length === 0) return null;

  const checks: GeoReadinessCheck[] = CHECK_DEFS.map((def) => ({
    id: def.id,
    label: def.label,
    passed: posts.filter((p) => def.test(p)).length,
    total: posts.length,
    weight: def.weight,
  }));

  const score = Math.round(
    checks.reduce((sum, c) => sum + (c.passed / c.total) * c.weight, 0),
  );

  const grade: GeoReadinessScore['grade'] =
    score >= 80 ? '우수' : score >= 50 ? '보통' : '개선 필요';

  // 충족률 낮은 항목부터 팁 제공 (완전 충족 항목은 제외)
  const tips = checks
    .filter((c) => c.passed < c.total)
    .sort((a, b) => a.passed / a.total - b.passed / b.total)
    .map((c) => CHECK_DEFS.find((d) => d.id === c.id)?.tip ?? '')
    .filter((t) => t.length > 0);

  return { score, grade, checks, tips, postCount: posts.length };
}

// ---------------------------------------------------------------------------
// 5) 주간 인용률 집계 (UI 추이용)
// ---------------------------------------------------------------------------

export interface CitationRow {
  checkedAt: string; // ISO
  cited: boolean;
}

export interface WeeklyCitationPoint {
  /** 주 시작일 (월요일, YYYY-MM-DD) */
  weekStart: string;
  total: number;
  cited: number;
}

/** ISO 문자열 → 그 주 월요일 날짜(YYYY-MM-DD, UTC 기준) */
export function mondayOfWeek(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay(); // 0=일
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  return monday.toISOString().slice(0, 10);
}

/** 인용 기록을 주 단위로 묶어 최근 maxWeeks개 반환 (과거 → 현재 순) */
export function aggregateWeeklyCitations(
  rows: CitationRow[],
  maxWeeks: number = 8,
): WeeklyCitationPoint[] {
  const byWeek = new Map<string, { total: number; cited: number }>();
  for (const row of rows) {
    const week = mondayOfWeek(row.checkedAt);
    if (!week) continue;
    const agg = byWeek.get(week) ?? { total: 0, cited: 0 };
    byWeek.set(week, {
      total: agg.total + 1,
      cited: agg.cited + (row.cited ? 1 : 0),
    });
  }
  return Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-maxWeeks)
    .map(([weekStart, agg]) => ({ weekStart, ...agg }));
}
