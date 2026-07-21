import type { KeywordVolume } from './keyword-volume.ts';

/**
 * 네이버 블로그 무료진단 — 점수 산출 (순수 함수만, 외부 의존 없음).
 *
 * SEO /100 = 노출(0~60, 검색량 가중 × 순위 점수)
 *          + 발행 꾸준함(0~25, 주당 편수·최대 공백)
 *          + 키워드-수요 정합성(0~15, 검색량 있는 키워드 비중)
 * GEO /100 = 네이버 블로그 단독은 5~10점 고정 (아래 근거 참조)
 *
 * 컴플라이언스: 매출·방문자 추정 산식은 어디에도 없다 — 공개 지표(검색량·문서수·
 * 순위·발행일)만 사용한다. 타 병원 비교 없음("내 블로그 진단" 포지셔닝).
 */

/* ── 키워드 실측 ───────────────────────────────────────────── */

export interface KeywordMeasurement {
  keyword: string;
  /** 월 검색량(pc+mobile)·광고 경쟁도. 조회 불가 시 null. */
  volume: KeywordVolume | null;
  /** 네이버 블로그 문서수. 조회 불가 시 null. */
  docCount: number | null;
  /** 상위 100 내 노출 순위(1-base). 미노출·조회 불가 시 null. */
  rank: number | null;
}

/** 순위 → 노출 점수 계수. 1~3위 1.0 / 4~10위 0.7 / 11~30위 0.4 / 31~100위 0.15 / 미노출 0. */
export function rankPoints(rank: number | null): number {
  if (rank === null || !Number.isFinite(rank) || rank < 1) return 0;
  if (rank <= 3) return 1.0;
  if (rank <= 10) return 0.7;
  if (rank <= 30) return 0.4;
  if (rank <= 100) return 0.15;
  return 0;
}

/* ── 발행 꾸준함 ───────────────────────────────────────────── */

/** 꾸준함 관측 기간(일) — 최근 12주. */
export const CADENCE_WINDOW_DAYS = 84;

export type CadenceGrade = '우수' | '양호' | '불규칙' | '방치';

export interface Cadence {
  /** 관측 기간 내 발행 편수. */
  postsInWindow: number;
  /** 주당 평균 편수 (관측 기간 기준). */
  postsPerWeek: number;
  /** 발행 간 최대 공백(일, 마지막 글~현재 포함). 날짜 없으면 null. */
  maxGapDays: number | null;
  grade: CadenceGrade;
}

/** 발행일 목록(ISO/null 섞임)에서 꾸준함 지표를 계산한다. */
export function computeCadence(
  publishedDates: readonly (string | null)[],
  now: number = Date.now(),
): Cadence {
  const times = publishedDates
    .map((d) => (d ? Date.parse(d) : NaN))
    .filter((t) => Number.isFinite(t) && t <= now + 24 * 60 * 60 * 1000)
    .sort((a, b) => a - b);

  const windowStart = now - CADENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const inWindow = times.filter((t) => t >= windowStart);
  const postsPerWeek = inWindow.length / (CADENCE_WINDOW_DAYS / 7);

  let maxGapDays: number | null = null;
  if (times.length > 0) {
    let maxGapMs = now - times[times.length - 1]; // 마지막 글 ~ 현재
    for (let i = 1; i < times.length; i++) {
      maxGapMs = Math.max(maxGapMs, times[i] - times[i - 1]);
    }
    maxGapDays = Math.round(maxGapMs / (24 * 60 * 60 * 1000));
  }

  return {
    postsInWindow: inWindow.length,
    postsPerWeek: Math.round(postsPerWeek * 100) / 100,
    maxGapDays,
    grade: classifyCadence(postsPerWeek, maxGapDays),
  };
}

/** 주당 편수·최대 공백 → 등급. */
export function classifyCadence(postsPerWeek: number, maxGapDays: number | null): CadenceGrade {
  if (postsPerWeek >= 1.5 && maxGapDays !== null && maxGapDays <= 14) return '우수';
  if (postsPerWeek >= 0.7) return '양호';
  if (postsPerWeek >= 0.25) return '불규칙';
  return '방치';
}

/** 꾸준함 등급 → SEO 배점(0~25). */
export const CADENCE_POINTS: Record<CadenceGrade, number> = {
  우수: 25,
  양호: 18,
  불규칙: 10,
  방치: 3,
};

/* ── SEO 점수 ─────────────────────────────────────────────── */

export interface SeoScoreBreakdown {
  /** 노출 점수(0~60) — 검색량 가중 × 순위 점수. */
  exposure: number;
  /** 발행 꾸준함(0~25). */
  consistency: number;
  /** 키워드-수요 정합성(0~15). */
  fit: number;
  total: number;
}

/** 정합성 판정 기준 — 이 이상 월 검색량이면 "수요 있는 키워드". */
export const FIT_MIN_VOLUME = 100;
/** 검색량 정보가 전혀 없을 때의 중립 정합성 점수. */
export const FIT_NEUTRAL_POINTS = 7;

/**
 * SEO 점수를 산출한다.
 * - 노출: 각 키워드 weight = sqrt(월 검색량+1) (한 키워드 독식 방지),
 *   검색량이 전부 없으면 균등 가중. exposure = 60 × Σ(weight_i × rankPoints_i) / Σweight
 * - 정합성: 검색량 ≥ FIT_MIN_VOLUME 키워드 비중 × 15. 검색량 데이터 없으면 중립 7점.
 */
export function computeSeoScore(
  measurements: readonly KeywordMeasurement[],
  cadence: Cadence,
): SeoScoreBreakdown {
  const consistency = CADENCE_POINTS[cadence.grade];

  if (measurements.length === 0) {
    const total = Math.min(100, consistency + FIT_NEUTRAL_POINTS);
    return { exposure: 0, consistency, fit: FIT_NEUTRAL_POINTS, total };
  }

  const hasVolume = measurements.some((m) => m.volume !== null);
  let weightSum = 0;
  let weighted = 0;
  for (const m of measurements) {
    const weight = hasVolume ? Math.sqrt((m.volume?.total ?? 0) + 1) : 1;
    weightSum += weight;
    weighted += weight * rankPoints(m.rank);
  }
  const exposure = weightSum > 0 ? Math.round(60 * (weighted / weightSum)) : 0;

  let fit: number;
  if (!hasVolume) {
    fit = FIT_NEUTRAL_POINTS;
  } else {
    const demandCount = measurements.filter(
      (m) => (m.volume?.total ?? 0) >= FIT_MIN_VOLUME,
    ).length;
    fit = Math.round(15 * (demandCount / measurements.length));
  }

  const total = Math.max(0, Math.min(100, exposure + consistency + fit));
  return { exposure, consistency, fit, total };
}

/* ── GEO 점수 ─────────────────────────────────────────────── */

/**
 * blog.naver.com robots.txt 가 차단하는 주요 AI 크롤러 (2026-07 조사 시점).
 *
 * 네이버 블로그는 robots.txt 로 AI 검색·학습 크롤러를 전면 차단한다. 즉,
 * ChatGPT·Perplexity·Claude 등 AI 검색은 네이버 블로그 글을 수집·인용할 수 없다.
 * → 네이버 블로그 "단독" 운영의 GEO(AI 검색 노출) 점수는 구조적으로 5~10점을
 *   넘을 수 없다 (간접 인용 등 잔여 경로만 인정). 이것이 아래 고정 점수의 근거다.
 * 해법은 AI 크롤러를 허용하는 자체도메인 병행 발행(닥터포스트 GEO 기능)이다.
 */
export const AI_BLOCKED_CRAWLERS: readonly string[] = [
  'GPTBot', // OpenAI 학습
  'OAI-SearchBot', // ChatGPT 검색
  'PerplexityBot', // Perplexity
  'ClaudeBot', // Anthropic
  'Google-Extended', // Gemini 학습
  'CCBot', // Common Crawl (다수 AI 학습 데이터 원천)
];

/** robots.txt 차단 발췌 (근거 표시용, 2026-07 조사 시점 기준). */
export const NAVER_BLOG_ROBOTS_EXCERPT = AI_BLOCKED_CRAWLERS.map(
  (bot) => `User-agent: ${bot}\nDisallow: /`,
).join('\n\n');

/** 네이버 블로그 단독 GEO 점수 범위 — 위 robots 차단이 근거. */
export const NAVER_BLOG_GEO_MIN = 5;
export const NAVER_BLOG_GEO_MAX = 10;

export interface GeoScoreInput {
  totalPosts: number;
  cadenceGrade: CadenceGrade;
  /**
   * 자체도메인 병행 발행 여부 — 인터페이스만 열어둔다 (진단 v1 에서는 항상 미지정).
   * 병행 시 AI 크롤러 수집이 가능해져 콘텐츠 품질에 따라 가점된다.
   */
  ownDomain?: { active: boolean };
}

export interface GeoScore {
  score: number;
  /** 점수 산정 근거 요약 (UI 표시용). */
  reason: string;
}

/**
 * GEO 점수 산출.
 * 네이버 블로그 단독: 5점 기반 + 콘텐츠 축적(글 20편↑ +3) + 꾸준함(우수/양호 +2),
 * 상한 10점 — AI 크롤러 전면 차단으로 그 이상은 불가 (AI_BLOCKED_CRAWLERS 참조).
 */
export function computeGeoScore(input: GeoScoreInput): GeoScore {
  let score = NAVER_BLOG_GEO_MIN;
  if (input.totalPosts >= 20) score += 3;
  if (input.cadenceGrade === '우수' || input.cadenceGrade === '양호') score += 2;
  score = Math.min(NAVER_BLOG_GEO_MAX, score);

  if (input.ownDomain?.active) {
    // 자체도메인 병행 가점 — 인터페이스만 구현 (v1 미사용). 병행 시 크롤러 차단이
    // 풀리므로 기반 40점 + 축적/꾸준함 가점으로 재산정한다.
    let combined = 40;
    if (input.totalPosts >= 20) combined += 10;
    if (input.cadenceGrade === '우수' || input.cadenceGrade === '양호') combined += 10;
    return {
      score: Math.min(100, combined),
      reason: '자체도메인 병행 발행 — AI 크롤러 수집 가능 상태입니다.',
    };
  }

  return {
    score,
    reason:
      '네이버 블로그는 robots.txt로 주요 AI 크롤러(GPTBot·PerplexityBot 등)를 차단해 ' +
      'AI 검색에 인용될 수 없습니다. 네이버 블로그 단독 운영의 구조적 한계입니다.',
  };
}

/* ── 글 품질(제목 반복도) ─────────────────────────────────── */

export interface TitleQualityStats {
  /** 비교한 제목 쌍 수. */
  pairsChecked: number;
  /** 유사도 0.6 이상 "사실상 중복" 쌍 수. */
  duplicatePairs: number;
  /** 최대 쌍 유사도(0~1). */
  maxSimilarity: number;
  /** 대표 중복 쌍 (최대 3개, UI 인용용). */
  samples: Array<{ a: string; b: string; similarity: number }>;
}

/** 제목을 비교용 bigram 집합으로 (공백·특수문자 제거 후 2-gram). */
function titleBigrams(title: string): Set<string> {
  const norm = title.replace(/[^가-힣a-z0-9]/gi, '').toLowerCase();
  const grams = new Set<string>();
  for (let i = 0; i < norm.length - 1; i++) grams.add(norm.slice(i, i + 2));
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** 중복 판정 임계 유사도. */
export const TITLE_DUP_THRESHOLD = 0.6;

/**
 * 제목 간 반복도(템플릿화) 통계 — bigram Jaccard 유사도 기반 (순수 함수).
 * 제목이 50개면 쌍이 1,225개라 O(n²)이지만 n≤50 으로 충분히 작다.
 */
export function computeTitleQuality(titles: readonly string[]): TitleQualityStats {
  const list = titles.filter((t) => typeof t === 'string' && t.trim().length > 0).slice(0, 50);
  const grams = list.map((t) => titleBigrams(t));

  let pairsChecked = 0;
  let duplicatePairs = 0;
  let maxSimilarity = 0;
  const samples: TitleQualityStats['samples'] = [];

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      pairsChecked += 1;
      const sim = jaccard(grams[i], grams[j]);
      if (sim > maxSimilarity) maxSimilarity = sim;
      if (sim >= TITLE_DUP_THRESHOLD) {
        duplicatePairs += 1;
        if (samples.length < 3) {
          samples.push({ a: list[i], b: list[j], similarity: Math.round(sim * 100) / 100 });
        }
      }
    }
  }

  return {
    pairsChecked,
    duplicatePairs,
    maxSimilarity: Math.round(maxSimilarity * 100) / 100,
    samples,
  };
}

/* ── 규칙 기반 장단점 폴백 ────────────────────────────────── */

export interface CheckFeedback {
  strengths: string[];
  weaknesses: string[];
}

/**
 * LLM 요약 실패 시 쓰는 규칙 기반 장단점 (그레이스풀 폴백).
 * 장점 2~3개·부족한 점 2~3개 — 항상 최소 2개씩 보장한다.
 */
export function buildFallbackFeedback(input: {
  seo: SeoScoreBreakdown;
  geo: GeoScore;
  cadence: Cadence;
  complianceCount: number;
  measurements: readonly KeywordMeasurement[];
}): CheckFeedback {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const ranked = input.measurements.filter((m) => m.rank !== null && m.rank <= 30);
  if (ranked.length > 0) {
    strengths.push(`타깃 키워드 ${ranked.length}개가 네이버 상위 30위 안에 노출되고 있어요.`);
  }
  if (input.cadence.grade === '우수' || input.cadence.grade === '양호') {
    strengths.push(`발행 꾸준함이 "${input.cadence.grade}" 등급 — 주 ${input.cadence.postsPerWeek}편 페이스를 유지 중이에요.`);
  }
  if (input.complianceCount === 0) {
    strengths.push('최근 글에서 의료광고법 위험 표현이 검출되지 않았어요.');
  }
  if (strengths.length < 2) {
    strengths.push('네이버 블로그 채널을 이미 운영 중 — 개선을 시작할 기반이 있어요.');
  }
  if (strengths.length < 2) {
    strengths.push('진단으로 현재 위치를 확인한 것 자체가 첫걸음이에요.');
  }

  if (input.seo.exposure < 30) {
    weaknesses.push('검색 수요가 있는 키워드에서 상위 노출이 부족해요. 키워드 전략 재정비가 필요합니다.');
  }
  if (input.cadence.grade === '불규칙' || input.cadence.grade === '방치') {
    weaknesses.push(`발행이 "${input.cadence.grade}" 상태예요. 발행 공백은 검색 노출에 직접 불리하게 작용해요.`);
  }
  if (input.complianceCount > 0) {
    weaknesses.push(`의료광고법 위험 신호가 ${input.complianceCount}건 검출됐어요. 상세 확인이 필요합니다.`);
  }
  weaknesses.push(
    'AI 검색(GEO) 노출이 구조적으로 막혀 있어요 — 네이버 블로그는 AI 크롤러를 차단합니다.',
  );
  if (weaknesses.length < 2) {
    weaknesses.push('검색량이 큰 인접 키워드로 주제를 넓힐 여지가 있어요. 키워드별 실측표에서 확인해 보세요.');
  }

  return { strengths: strengths.slice(0, 3), weaknesses: weaknesses.slice(0, 3) };
}
